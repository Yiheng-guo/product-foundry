import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../server/store.mjs";

test("真实造物HTTP取消路由202收尾，未返回用量不填零、不新增版本，结束后项目锁可继续用", async t => {
  const dir = await mkdtemp(join(tmpdir(), "foundry-cancel-http-")); const store = await createStore(dir); const old = { id: "cancel-project", title: "旧版", kind: "custom", versions: [{ id: "v1", code: "<html>old-version</html>" }] }; await store.put("project", old); store.close();
  let invocations = 0, hold = true, release; const held = new Promise(r => { release = r; });
  const model = createServer(async (req, res) => { for await (const chunk of req) {} invocations++; if (hold) await held; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ title: "隔离返回", description: "本地HTTP夹具", commentary: "仅测试", code: "<html>" + "local-fixture".repeat(20) + "</html>", prd: "隔离HTTP返回内容用于测试，不是实际模型研究与生成结果。" }) } }], usage: { prompt_tokens: 17, completion_tokens: 4 } })); }); await new Promise(r => model.listen(0, "127.0.0.1", r));
  const probe = createServer(); await new Promise(r => probe.listen(0, "127.0.0.1", r)); const port = probe.address().port; await new Promise(r => probe.close(r));
  const child = spawn(process.execPath, ["server/index.mjs"], { cwd: new URL("..", import.meta.url), env: { ...process.env, VERCEL: "", STORAGE_DRIVER: "", OFFICE_DATA_DIR: dir, WORKSPACE_PASSWORD: "", PORT: String(port), OPENAI_API_KEY: "fixture-only-key", OPENAI_MODEL: "fixture", OPENAI_BASE_URL: "http://127.0.0.1:" + model.address().port + "/v1" }, stdio: "pipe" });
  t.after(async () => { release(); child.kill("SIGTERM"); await new Promise(r => child.once("exit", r)); model.closeAllConnections(); await new Promise(r => model.close(r)); await rm(dir, { recursive: true, force: true }); });
  const base = "http://127.0.0.1:" + port;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + "/api/health")).ok) break; } catch {} await new Promise(r => setTimeout(r, 20)); }
  const create = async () => { const res = await fetch(base + "/api/projects/cancel-project/revise", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "取消测试", kind: "custom", provider: "openai", prompt: "本地HTTP夹具取消，不调用真实模型" }) }); return { status: res.status, job: await res.json() }; };
  const wait = async id => { for (let i = 0; i < 150; i++) { const job = await (await fetch(base + "/api/jobs/" + id)).json(); if (["cancelled", "completed", "failed"].includes(job.status) && !job.cancellationPending) return job; await new Promise(r => setTimeout(r, 10)); } throw new Error("did not settle"); };
  const start = await create(); assert.equal(start.status, 202); for (let i = 0; i < 100 && !invocations; i++) await new Promise(r => setTimeout(r, 10)); assert.equal(invocations, 1);
  const response = await fetch(base + "/api/jobs/" + start.job.id + "/cancel", { method: "POST" }); assert.equal(response.status, 202); const ack = await response.json(); assert.ok(ack.cancelRequestedAt);
  release(); const cancelled = await wait(start.job.id); assert.equal(cancelled.status, "cancelled"); assert.equal(cancelled.result, null); assert.equal(cancelled.versionId, undefined); assert.notEqual(cancelled.usage?.inputTokens, 0); assert.notEqual(cancelled.usage?.requestCount, 0);
  assert.deepEqual(await (await fetch(base + "/api/projects/cancel-project")).json(), old);
  assert.equal((await fetch(base + "/api/jobs/" + start.job.id + "/cancel", { method: "POST" })).status, 200);
  hold = false; const next = await create(); assert.equal(next.status, 202); const completed = await wait(next.job.id); assert.equal(completed.status, "completed"); assert.equal(completed.usage.inputTokens, 17); assert.ok(completed.versionId); assert.equal(invocations, 2);
});
