import { test } from "node:test";
import assert from "node:assert/strict";
import { executeFoundryJob } from "../server/job-execution.mjs";

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const result = { title: "隔离原型", description: "fixture", code: "<html>returned model artifact</html>", prd: "fixture" };
const trace = { output: "original model text", usage: { inputTokens: 123, outputTokens: 8, requestCount: 1, cost: null } };
function fixture(options = {}) {
  const controller = new AbortController(); const rows = new Map(); let publishing = false, calls = 0;
  const job = { id: "job", projectId: "project", provider: "openai", status: "queued", title: "测试", prompt: "验证隔离取消生命周期", kind: "custom", events: [], result: null, createdAt: "2026-01-01" };
  rows.set("project:project", { id: "project", versions: [{ id: "original", code: "<html>old</html>" }] });
  const store = { async get(id, type) { if (options.beforeGet) await options.beforeGet(id, type); return structuredClone(rows.get(type + ":" + id)); }, async put(type, value) { if (options.beforePut) await options.beforePut(type, value); rows.set(type + ":" + value.id, structuredClone(value)); } };
  const event = async (job, message) => { job.events.push({ message }); await store.put("job", job); };
  const execution = () => executeFoundryJob({ job, controller, store, event, mode: "factory", docs: [], config: {}, beginFinalizing: () => { publishing = true; }, model: async (...args) => { calls++; return options.model ? options.model(...args) : result; }, traceFor: () => trace });
  const cancel = async () => { if (publishing) return { status: 409, code: "RUN_FINALIZING" }; job.cancelRequestedAt = "fixture-time"; job.cancellationPending = true; controller.abort(); await event(job, "cancel pending"); return { status: 202 }; };
  return { job, rows, execution, cancel, calls: () => calls };
}
test("造物取消后已返回trace/usage仍存档，不发布版本或成功result", async () => {
  const entered = deferred(), release = deferred(); const f = fixture({ model: async () => { entered.resolve(); await release.promise; return result; } }); const running = f.execution(); await entered.promise;
  assert.equal((await f.cancel()).status, 202); release.resolve(); await running;
  assert.equal(f.job.status, "cancelled"); assert.equal(f.job.cancellationPending, false); assert.equal(f.job.result, null); assert.deepEqual(f.job.returnedResult, result); assert.deepEqual(f.job.modelTrace, trace); assert.equal(f.job.usage.inputTokens, 123); assert.equal(f.job.versionId, undefined); assert.equal(f.rows.get("project:project").versions.length, 1); assert.equal(f.calls(), 1);
});
test("造物returned后异步准备窗口取消，最终保存不覆盖取消终态且旧版本不变", async () => {
  const entered = deferred(), release = deferred(); let reads = 0; const f = fixture({ beforeGet: async (_, type) => { if (type === "project" && ++reads === 2) { entered.resolve(); await release.promise; } } }); const running = f.execution(); await entered.promise;
  assert.equal((await f.cancel()).status, 202); release.resolve(); await running;
  assert.equal(f.rows.get("job:job").status, "cancelled"); assert.equal(f.job.usage.inputTokens, 123); assert.equal(f.rows.get("project:project").versions.length, 1); assert.equal(f.job.result, null);
});
test("造物开始发布后拒绝cancel，精确versionId保存；锁管理可以等待最后持久化", async () => {
  const entered = deferred(), release = deferred(); const f = fixture({ beforePut: async type => { if (type === "project") { entered.resolve(); await release.promise; } } }); const running = f.execution(); await entered.promise;
  assert.deepEqual(await f.cancel(), { status: 409, code: "RUN_FINALIZING" }); release.resolve(); await running;
  assert.equal(f.job.status, "completed"); assert.ok(f.job.versionId); assert.equal(f.rows.get("project:project").versions.find(v => v.id === f.job.versionId).code, result.code); assert.equal(f.job.cancelRequestedAt, undefined);
});
test("造物provider取消错误的已有trace仍保留；没有回执时用量保持未知", async () => {
  const entered = deferred(), release = deferred(); const f = fixture({ model: async () => { entered.resolve(); await release.promise; throw Object.assign(new Error("cancelled provider"), { raw: trace, usage: trace.usage }); } }); const running = f.execution(); await entered.promise; await f.cancel(); release.resolve(); await running; assert.equal(f.job.status, "cancelled"); assert.deepEqual(f.job.modelTrace, trace); assert.equal(f.job.usage.inputTokens, 123);
  const g = fixture({ model: async () => { throw new Error("no model receipt"); } }); g.job.cancellationPending = true; const pending = g.execution(); g.cancel(); await pending; assert.equal(g.job.status, "cancelled"); assert.equal(g.job.usage, undefined); assert.equal(g.rows.get("project:project").versions.length, 1);
});
