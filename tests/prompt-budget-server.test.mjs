import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../server/store.mjs";

test("最终预算拒绝在本地API夹具模型调用前发生，失败记录requestCount0且旧HTML完整保留", async t => {
  const dir = await mkdtemp(join(tmpdir(), "foundry-budget-server-"));
  const store = await createStore(dir); const oldCode = "<html>" + "x".repeat(115000) + "HTML_END_MARKER</html>";
  const original = { id: "large-project", title: "大原型", kind: "custom", versions: [{ id: "v1", code: oldCode, prd: "保存完整旧版本" }] }; await store.put("project", original); store.close();
  let invocations = 0; let holdResponses = false; let releaseModel; const held = new Promise(resolve => { releaseModel = resolve; });
  const model = createServer(async (req, res) => { for await (const chunk of req) {} invocations++; if (holdResponses) await held; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ title: "隔离模型夹具", description: "无真实调用", commentary: "API测试夹具", code: "<html>" + "fixture".repeat(20) + "</html>", prd: "隔离HTTP夹具的需求说明，不是实际模型评测结果。" }) } }], usage: { prompt_tokens: 3, completion_tokens: 4 } })); });
  await new Promise(resolve => model.listen(0, "127.0.0.1", resolve));
  const probe = createServer(); await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, ["server/index.mjs"], { cwd: new URL("..", import.meta.url), env: { ...process.env, VERCEL: "", STORAGE_DRIVER: "", OFFICE_DATA_DIR: dir, WORKSPACE_PASSWORD: "", PORT: String(port), OPENAI_API_KEY: "isolated-fixture-key", OPENAI_MODEL: "local-fixture", OPENAI_BASE_URL: "http://127.0.0.1:" + model.address().port + "/v1", FOUNDRY_MODEL_PROMPT_MAX_CHARS: "120000" }, stdio: "pipe" });
  t.after(async () => { releaseModel(); child.kill("SIGTERM"); await new Promise(resolve => child.once("exit", resolve)); await new Promise(resolve => model.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  const base = "http://127.0.0.1:" + port;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + "/api/health")).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 20)); }
  const create = async (path, prompt) => { const response = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "预算测试", kind: "custom", provider: "openai", documentIds: [], prompt }) }); return response.json(); };
  const wait = async id => { for (let i = 0; i < 100; i++) { const job = await (await fetch(base + "/api/jobs/" + id)).json(); if (!["queued", "running"].includes(job.status)) return job; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error("job did not settle"); };
  const started = await create("/api/projects/large-project/revise", "中".repeat(6000)); const failed = await wait(started.id);
  assert.equal(failed.status, "failed"); assert.equal(failed.errorCode, "MODEL_PROMPT_TOO_LARGE"); assert.equal(failed.inputBudget.modelInvocation, "not-invoked"); assert.equal(failed.inputBudget.unit, "utf16-code-units"); assert.equal(failed.usage.requestCount, 0); assert.equal(failed.usage.inputTokens, null); assert.equal(failed.usage.cost, null); assert.equal(invocations, 0);
  const preserved = await (await fetch(base + "/api/projects/large-project")).json(); assert.deepEqual(preserved, original);
  const staleResponse = await fetch(base + "/api/projects/large-project/revise", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "过期版本", kind: "custom", provider: "openai", prompt: "按旧版本修改原型", expectedVersionId: "old-other-version" }) });
  const stale = await wait((await staleResponse.json()).id); assert.equal(stale.status, "failed"); assert.equal(stale.errorCode, "PROTOTYPE_VERSION_CHANGED"); assert.equal(stale.usage.requestCount, 0); assert.equal(invocations, 0);
  const valid = await create("/api/jobs", "创建一个很小的中文交互夹具原型"); const validResult = await wait(valid.id); assert.equal(validResult.status, "completed", validResult.error); assert.equal(invocations, 1);
  assert.equal(validResult.inputBudget.decision, "within-budget"); assert.equal(validResult.inputBudget.modelInvocation, "adapter-call-not-yet-confirmed");
  assert.ok(validResult.versionId); const generated = await (await fetch(base + "/api/projects/" + validResult.projectId)).json(); assert.equal(generated.versions.find(v => v.id === validResult.versionId).code, validResult.result.code);
  holdResponses = true;
  const firstRevision = await create("/api/projects/large-project/revise", "修改这一明确绑定的旧原型");
  const simultaneous = await fetch(base + "/api/projects/large-project/revise", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "并发旧版本", kind: "custom", provider: "openai", prompt: "并发修订不能覆盖同项目" }) });
  assert.equal(simultaneous.status, 409); releaseModel(); assert.equal((await wait(firstRevision.id)).status, "completed");
  const revised = await (await fetch(base + "/api/projects/large-project")).json(); assert.equal(revised.versions.length, 2); assert.equal(revised.versions[0].code, oldCode); assert.equal(invocations, 2);
});
