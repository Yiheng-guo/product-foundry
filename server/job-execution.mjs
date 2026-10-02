import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { buildPrompt } from "./prompts.mjs";
import { runModel, modelTrace } from "./provider.mjs";
import { workerSchema, fragmentSchema } from "./schemas.mjs";
import { demoWorker, demoFactory } from "./templates.mjs";

// A single canonical job object is shared with cancellation. Injected IO lets
// tests exercise actual commit boundaries without starting a model or server.
export async function executeFoundryJob({ job, controller, store, event, mode, docs, config, beginFinalizing, flushEvents = async () => {}, model = runModel, traceFor = modelTrace }) {
  const signal = controller.signal; let publishing = false;
  try {
    signal.throwIfAborted();
    job.status = "running";
    await event(job, "任务已创建，正在整理输入");
    await event(job, `已载入 ${docs.length} 份资料；${job.provider === "demo" ? "使用演示模板，未调用 AI" : "正在校验最终模型输入预算"}`);
    const previous = job.projectId ? await store.get(job.projectId, "project") : null;
    signal.throwIfAborted();
    if (job.projectId && !previous?.versions) throw new Error("项目不存在。");
    if (job.expectedVersionId && previous?.versions.at(-1)?.id !== job.expectedVersionId) throw Object.assign(new Error("旧原型版本已变化，请重新预览绑定版本后再提交。"), { code: "PROTOTYPE_VERSION_CHANGED", modelInvocation: "not-invoked" });
    if (job.expectedHtmlSha256 && createHash("sha256").update(previous?.versions.at(-1)?.code || "").digest("hex") !== job.expectedHtmlSha256) throw Object.assign(new Error("旧原型 HTML 已变化，请重新核对生成目标。"), { code: "PROTOTYPE_VERSION_CHANGED", modelInvocation: "not-invoked" });
    const finalPrompt = job.provider === "demo" ? null : buildPrompt(mode, job, docs, previous?.versions.at(-1));
    if (finalPrompt) job.inputBudget = { actualChars: finalPrompt.length, maxChars: Number(process.env.FOUNDRY_MODEL_PROMPT_MAX_CHARS || 120000), unit: "utf16-code-units", scope: "foundry-built-prompt-excludes-provider-envelope", decision: "within-budget", modelInvocation: "adapter-call-not-yet-confirmed" };
    signal.throwIfAborted();
    const result = job.provider === "demo" ? mode === "worker" ? demoWorker(job, docs) : demoFactory(job) : await model(job.provider, finalPrompt, mode === "worker" ? workerSchema : fragmentSchema, config, signal);
    // Receipt capture always precedes cancellation or validation. A received
    // model result is evidence of consumption, not a published deliverable.
    job.returnedResult = result;
    const trace = traceFor(result);
    if (trace) { job.usage = trace.usage; job.modelTrace = trace; }
    job.modelReceipt = { receivedAt: new Date().toISOString(), type: "result" };
    signal.throwIfAborted();
    if (mode === "factory" && !/<html[\s>]/i.test(result.code)) throw new Error("模型没有返回完整 HTML 应用，请重试。");
    // Async preparation stays cancellable. Re-check after reading the current
    // project, immediately before the synchronous publication reservation.
    const current = job.projectId ? await store.get(job.projectId, "project") : null;
    signal.throwIfAborted();
    if (job.projectId && current?.versions.at(-1)?.id !== previous?.versions.at(-1)?.id) throw Object.assign(new Error("生成期间原型版本已变化，结果仅保留在任务记录中。"), { code: "PROTOTYPE_VERSION_CHANGED" });
    beginFinalizing(job.id); publishing = true;
    job.result = result;
    if (mode === "factory") {
      const project = current || { id: randomUUID(), title: result.title, description: result.description, kind: job.kind, createdAt: job.createdAt, versions: [] };
      const version = { ...result, id: randomUUID(), createdAt: new Date().toISOString(), prompt: job.prompt, provider: job.provider };
      project.versions.push(version); job.versionId = version.id;
      project.updatedAt = new Date().toISOString(); project.title = result.title; project.description = result.description;
      await store.put("project", project); job.projectId = project.id;
    }
    job.status = "completed"; job.completedAt = new Date().toISOString();
    await event(job, "交付物已校验并保存");
  } catch (error) {
    if (error.modelInvocation === "not-invoked") {
      job.errorCode = error.code; job.inputValidation = { code: error.code, modelInvocation: "not-invoked", reason: error.message };
      if (error.code === "MODEL_PROMPT_TOO_LARGE") job.inputBudget = { actualChars: error.actualChars, maxChars: error.maxChars, unit: error.unit, previousHtmlChars: error.previousHtmlChars, scope: "foundry-built-prompt-excludes-provider-envelope", modelInvocation: "not-invoked" };
      job.usage = { inputTokens: null, outputTokens: null, cachedTokens: null, cost: null, currency: null, requestCount: 0, note: "输入预检在模型调用前拒绝了任务；没有模型 Token 或现金账单记录。" };
    }
    if (error.raw) { job.modelTrace = error.raw; job.usage = error.usage || error.raw.usage; }
    const cancelled = signal.aborted && !publishing;
    job.status = cancelled ? "cancelled" : "failed";
    job.errorCode ||= error.code || null;
    job.error = cancelled ? "任务已取消，已收到的模型输出和用量保留；未返回用量仍为未知。" : error instanceof z.ZodError ? "模型返回格式不符合要求，请重试。" : error.message;
    if (cancelled) { job.result = null; delete job.versionId; }
    job.completedAt = new Date().toISOString();
    await event(job, cancelled ? "取消结束，已有模型记录已保存" : "任务未完成，已保留输入与可用模型记录");
  } finally {
    await flushEvents(job.id);
    job.cancellationPending = false;
    await store.put("job", job);
  }
}
