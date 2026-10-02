import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt } from "../server/prompts.mjs";

test("最终模型输入保留完整旧HTML和资料，不再90k/65k静默裁切", () => {
  const code = "<html>" + "x".repeat(95000) + "LAST_HTML_MARKER</html>";
  const prompt = buildPrompt("factory", { title: "需求选择测试", prompt: "完整修改原应用" }, [], { code });
  assert.ok(prompt.includes(code)); assert.ok(prompt.includes("LAST_HTML_MARKER"));
  const text = "z".repeat(66000) + "LAST_DOCUMENT_MARKER";
  const documentPrompt = buildPrompt("factory", { title: "资料测试", prompt: "读完附带资料" }, [{ name: "资料", text }]);
  assert.ok(documentPrompt.includes(text)); assert.ok(documentPrompt.includes("LAST_DOCUMENT_MARKER"));
});

test("预算覆盖标题、基础指令、完整旧HTML和追加需求，UTF16字符不冒充Token", () => {
  for (const fill of ["x", "中", "😀"]) {
    let invoked = 0;
    const call = () => { const prompt = buildPrompt("factory", { title: "预算验证", prompt: fill.repeat(2000) }, [], { code: "<html>" + fill.repeat(3000) + "</html>" }, { maxChars: 3000 }); invoked++; return prompt; };
    assert.throws(call, error => error.status === 413 && error.code === "MODEL_PROMPT_TOO_LARGE" && error.actualChars > error.maxChars && error.unit === "utf16-code-units" && error.modelInvocation === "not-invoked");
    assert.equal(invoked, 0);
  }
});
