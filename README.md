# 造物 · Product Foundry

面向 **AI 产品经理** 的产品工厂：把需求变成可交互的浏览器原型，保留每次版本，下载完整源码继续开发。

[打开线上工作空间](https://product-foundry-psi.vercel.app) · [开源调研与二开说明](docs/OPEN_SOURCE_RESEARCH.md)

> 这是独立项目，拥有自己的运行服务、数据库和 Vercel 部署。办公 Worker 在独立仓库 [AI PM Worker](https://github.com/Yiheng-guo/ai-pm-worker)，本项目不依赖它。

## 从想法到交付

1. 描述用户、场景和要解决的问题，或选择产品路线图、模型评测台、反馈池、实验追踪器模板。
2. 可附加 Markdown、TXT、CSV、JSON、DOCX、文字版 PDF 需求资料。
3. 模型生成完整 HTML/CSS/JavaScript 应用和 PRD。
4. 在隔离预览中体验交互，切换源码和产品说明。
5. 用自然语言继续修改，保留历史版本。
6. 下载 ZIP：包含 `index.html`、`PRD.md`、`README.md` 和版本清单。

**交付范围是浏览器前端原型**。没有声称自动完成业务后端、用户系统、支付或多人协作。预览中的业务数据不持久化；导出后的应用可使用浏览器本地存储。生成代码不会在服务器运行，不会自动安装模型建议的依赖。

本机 Personal Agent 集成版本会保存生成依据并明确选择原型范围。造物在调用模型前检查完整构造的提示（包括资料、规则与已有 HTML），超限拒绝而不静默裁剪；默认上限 120,000 UTF16 单位，可通过 `FOUNDRY_MODEL_PROMPT_MAX_CHARS` 调整。这是字符预算，不是模型 Token 或账单。预算通过也不能据此宣称模型实际启动，执行状态与用量来自调用记录。

## 本机运行

Node.js 24（最低 22.13）。

```bash
git clone https://github.com/Yiheng-guo/product-foundry.git
cd product-foundry
npm ci
npm run build
npm start
```

打开 **http://127.0.0.1:4320**。开发模式 `npm run dev`，地址 **http://127.0.0.1:4321**。

在设置中选择本机已登录的 Codex，或填写支持 JSON 输出的 OpenAI Chat Completions 兼容 API。演示模式使用明确标记的内置看板模板，不会按任意自由需求生成应用。API Key 本机默认只保存在进程内存；可以使用 `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL` 环境变量。

## Vercel 部署

```bash
vercel link
vercel blob create-store product-foundry-private --access private --yes
vercel env add WORKSPACE_PASSWORD production --sensitive
vercel --prod
```

使用单独的 private Blob 存储。`WORKSPACE_PASSWORD` 是长随机访问口令，也用于加密私有存储中的模型密钥；换口令后需重填模型密钥。不能在 Git 中保存这些值。

线上版本只能连接 API 模型，不能使用你电脑上的 Codex 登录。未配置 API 时运行演示模式。当前 Vercel 账号的 AI Gateway 需要先绑定信用卡，项目未替用户启用该服务。

## 复用与架构

- **E2B Fragments**：改造结构化 fragment schema，为 `code + prd + description + commentary`。保留原始文件、许可和提交记录。
- **LangChain OpenWork**：任务行为提示改为有界的产品交付，不执行任意 Shell。
- 新增中文产品工作室、版本记录、ZIP 交付、浏览器隔离预览、访问保护和本地/私有云存储。

这是模块级二开，不是完整 Fragments 沙盒或 OpenWork 运行时的 fork。见 [NOTICE](NOTICE) 和 [调研记录](docs/OPEN_SOURCE_RESEARCH.md)。

技术栈：React / TypeScript / Vite / Express / Zod / SQLite / Vercel private Blob / JSZip。

## 验证与限制

```bash
npm test
npm run build
```

测试覆盖账号口令保护、跨站请求、文件输入、任务状态、持久化、失败处理、历史版本保留及 ZIP 内容。生成应用还需验证实际交互与业务逻辑。

API 最长生成 4 分钟，Codex 本机最长 10 分钟。大需求建议拆成多次迭代。刷新不丢失已保存的项目版本；Vercel 平台终止或故障可能中断生成。单用户原型工作空间，列表上限 500 条。不适合作为未加扩展的企业级多租户平台。

源代码 Apache-2.0；上游 MIT/Apache 许可保留于 `third_party/`。

## 公开展示与私有工作空间

未登录可浏览工作台、模板和预置虚构示例，并下载示例。公开数据来自独立静态 fixture，不读取用户存储。私人资料、个人生成记录、模型配置、上传与生成操作仍需工作空间口令。点击“登录工作空间”进入私人工作区；取消登录可返回公开体验。
