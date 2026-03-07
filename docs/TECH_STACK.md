# AI EDA Copilot — 技术栈文档 (TECH_STACK)

> 版本：1.0
> 日期：2026-03-07
> 状态：已锁定

---

## 1. 技术选型总览

| 层级 | 技术 | 版本策略 | 选型理由 |
|------|------|----------|----------|
| 插件宿主 | VS Code Extension API | 以当前稳定版为目标开发，发布前补充最低兼容版本 | 目标平台 |
| 语言 | TypeScript | 5.x latest | 类型安全，Extension + Webview 统一语言 |
| Webview UI | React | 18.x | 组件化、生态成熟、支持流式渲染 |
| 状态管理 | Zustand | 5.x | 轻量（~1KB）、API 简洁，适合报告状态、流式缓冲和版本视图管理 |
| AI 调用 | openai (npm) | latest | 中转站为 OpenAI 兼容格式，原生支持流式输出 |
| 库存查询 | JLCPCB 官方 API | — | 实时库存/价格/规格，免费注册 |
| 库存备选 | jlcsearch API | — | 社区方案，快速验证备选 |
| 打包工具 | esbuild | latest | VS Code 官方推荐，构建速度快 |
| 包管理器 | npm | latest | 稳定通用 |
| 样式方案 | CSS Modules | — | 作用域隔离 + VS Code CSS 变量适配主题 |

---

## 2. 为什么选 VS Code Extension + React + Webview

### 2.1 为什么是 VS Code Extension

- 目标用户（硬件开发者）大量使用 VS Code 写固件代码
- 复用 VS Code 的编辑器、资源管理器、命令面板、终端，零成本获得 IDE 体验
- 插件生态成熟，分发机制完善（Marketplace / .vsix）
- 可直接读取用户 workspace 中的固件代码进行分析
- 未来可演进为独立 IDE（基于 Code-OSS），V1 不承担这个成本

### 2.2 为什么 Webview 用 React

- 微软官方 `@vscode/webview-ui-toolkit` 已归档停维，不可依赖
- 报告页面复杂度高（Tab 切换、BOM 表格展开、方案对比、流式渲染），需要完整的组件化框架
- React 18 的并发特性适合流式输出场景
- 可引用 VS Code CSS 变量（`var(--vscode-editor-background)` 等）自动适配明暗主题

### 2.3 为什么用 Zustand

- 报告页状态复杂：报告数据、Tab 状态、流式缓冲、方案对比、历史版本
- Zustand 体积极小（~1KB gzip），不会显著增加插件包大小
- API 简洁，学习成本低
- 支持 devtools 中间件（仅开发模式启用）
- 适合 Webview 中报告状态、流式缓冲和版本视图管理

---

## 3. 项目结构

### 3.1 整体结构

采用**单包 + 目录分离**策略，Extension 和 Webview 共享一份 `package.json`，源码目录清晰隔离：

```text
my_app/
├─ docs/                          # 项目文档
├─ public/                        # 静态资源
├─ src/
│  ├─ extension/                  # 插件侧（Node.js 环境）
│  │  ├─ commands/                # 命令注册
│  │  ├─ providers/               # Webview Provider / TreeView Provider
│  │  ├─ services/                # 业务服务层
│  │  │  ├─ ai/                   # AI 调用与管线编排
│  │  │  ├─ eda/                  # EDA 领域逻辑（规则引擎、设计审查）
│  │  │  ├─ procurement/          # 采购集成（JLCPCB API）
│  │  │  └─ storage/              # 项目数据持久化
│  │  ├─ utils/                   # 插件侧工具函数
│  │  └─ activate.ts              # 插件入口（extension.activate）
│  ├─ webview/                    # Webview 侧（浏览器环境）
│  │  ├─ panel/                   # 侧边栏 Webview
│  │  │  ├─ components/           # 侧边栏组件（对话框、表单）
│  │  │  ├─ store/                # 侧边栏状态
│  │  │  └─ PanelApp.tsx          # 侧边栏入口
│  │  ├─ report/                  # 报告 Webview
│  │  │  ├─ components/           # 报告组件（概览、BOM、原理图、PCB、采购）
│  │  │  ├─ store/                # 报告状态
│  │  │  └─ ReportApp.tsx         # 报告入口
│  │  ├─ components/              # 两个 Webview 共享的 UI 组件
│  │  │  ├─ ui/                   # 基础组件（按钮、输入框、表格）
│  │  │  └─ layout/               # 布局组件
│  │  └─ styles/                  # 全局样式 + CSS 变量映射
│  ├─ shared/                     # Extension 与 Webview 共享
│  │  ├─ types/                   # 共享类型定义
│  │  │  ├─ messages.types.ts     # postMessage 消息协议类型
│  │  │  ├─ report.types.ts       # 报告数据结构
│  │  │  ├─ eda.types.ts          # EDA 领域类型（BOM、原理图、PCB）
│  │  │  └─ project.types.ts      # 项目/方案类型
│  │  └─ constants/               # 共享常量
│  └─ types/                      # 全局类型补充
├─ .env                           # 环境变量（开发用）
├─ .env.example                   # 环境变量模板
├─ .gitignore
├─ CLAUDE.md
├─ README.md
├─ package.json
├─ tsconfig.json
└─ esbuild.js              # 打包配置（Extension + Webview 双入口）
```

### 3.2 为什么单包而非 Monorepo

- V1 阶段开发者少，Monorepo 管理成本偏高
- Extension 和 Webview 共享类型定义，单包直接 import 更简单
- esbuild 配置双入口即可分别打包两侧代码
- 未来如需拆分，目录结构已天然隔离，迁移成本低

---

## 4. Side Panel 实现方案

### 4.1 技术选型

使用 VS Code 的 **WebviewViewProvider** 在侧边栏注册 Webview 面板。

不使用 TreeView。因为 V1 需要在侧边栏中支持对话模式、表单模式、模板切换和流式摘要，TreeView 交互能力不足，因此统一采用 WebviewViewProvider。

### 4.2 架构

```text
┌──────────────────────────────────┐
│         VS Code 侧边栏            │
│  ┌────────────────────────────┐  │
│  │     Webview (React)        │  │
│  │  ┌──────────┬───────────┐  │  │
│  │  │ 对话模式  │ 表单模式   │  │  │
│  │  │ (默认)   │ (可切换)   │  │  │
│  │  └──────────┴───────────┘  │  │
│  │  ┌──────────────────────┐  │  │
│  │  │ 快速操作按钮          │  │  │
│  │  │ [分析] [BOM] [PCB]   │  │  │
│  │  └──────────────────────┘  │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

### 4.3 注册方式

```typescript
// extension/providers/SidePanelProvider.ts
vscode.window.registerWebviewViewProvider(
  'aiEdaCopilot.sidePanel',
  sidePanelProvider,
  { webviewOptions: { retainContextWhenHidden: true } }
);
```

- `retainContextWhenHidden: true`：切换 Tab 后保留对话状态，不重新加载

---

## 5. Webview Report 实现方案

### 5.1 技术选型

使用 **WebviewPanel** 在编辑器区域创建新 Tab。

### 5.2 架构

```text
┌──────────────────────────────────────────┐
│         VS Code 编辑器 Tab                │
│  ┌────────────────────────────────────┐  │
│  │ [概览] [需求] [BOM] [原理图] [PCB] [采购] │  │
│  ├────────────────────────────────────┤  │
│  │                                    │  │
│  │          报告内容区域               │  │
│  │  （流式渲染，整体只读，             │  │
│  │   Requirements 区受控可编辑）       │  │
│  │                                    │  │
│  ├────────────────────────────────────┤  │
│  │ [导出 CSV] [导出 Markdown] [导出 JSON] │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

### 5.3 创建方式

```typescript
// extension/providers/ReportPanelProvider.ts
const panel = vscode.window.createWebviewPanel(
  'aiEdaCopilot.report',
  `报告: ${projectName}`,
  vscode.ViewColumn.One,
  {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [extensionUri]
  }
);
```

---

## 6. 双 Webview 通信架构

### 6.1 通信拓扑

侧边栏 Webview 和报告 Webview 无法直接通信，必须通过 Extension Host 中转：

```text
┌─────────────┐     postMessage     ┌──────────────────┐     postMessage     ┌─────────────┐
│  Side Panel  │ ◄─────────────────► │  Extension Host  │ ◄─────────────────► │ Report Tab  │
│  (Webview)   │                     │    (Node.js)     │                     │  (Webview)  │
└─────────────┘                     └──────────────────┘                     └─────────────┘
                                           │
                                           │ Node.js 直接调用
                                           ▼
                                    ┌──────────────┐
                                    │  AI 中转站    │
                                    │  JLCPCB API  │
                                    │  本地文件系统  │
                                    └──────────────┘
```

### 6.2 消息协议（严格 TypeScript 类型）

```typescript
// shared/types/messages.types.ts

/** 消息方向 */
type MessageSource = 'panel' | 'report' | 'extension';

/** 基础消息结构 */
interface BaseMessage<T extends string, P = void> {
  type: T;
  source: MessageSource;
  payload: P;
  timestamp: number;
}

/** 侧边栏 → Extension */
type PanelToExtension =
  | BaseMessage<'submit_requirement', { text: string; mode: 'chat' | 'form' }>
  | BaseMessage<'analyze_workspace', { folderPath: string }>
  | BaseMessage<'select_template', { templateId: string }>
  | BaseMessage<'open_report', { projectId: string; schemeId: string }>
  | BaseMessage<'switch_mode', { mode: 'chat' | 'form' }>
  | BaseMessage<'regenerate', { projectId: string; schemeId: string; feedback: string }>;

/** Extension → 侧边栏 */
type ExtensionToPanel =
  | BaseMessage<'ai_chat_response', { content: string; isStreaming: boolean }>
  | BaseMessage<'ai_question', { question: string; options?: string[] }>
  | BaseMessage<'generation_status', { stage: PipelineStage; progress: number }>
  | BaseMessage<'error', { code: string; message: string }>;

/** Extension → 报告页 */
type ExtensionToReport =
  | BaseMessage<'report_data', { report: Report; isStreaming: boolean }>
  | BaseMessage<'report_stream_chunk', { section: ReportSection; content: string }>
  | BaseMessage<'report_stream_end', { report: Report }>
  | BaseMessage<'comparison_data', { schemes: Scheme[] }>;

/** 报告页 → Extension */
type ReportToExtension =
  | BaseMessage<'export_request', { format: 'csv' | 'markdown' | 'json'; section?: ReportSection }>
  | BaseMessage<'open_external_link', { url: string }>
  | BaseMessage<'version_request', { projectId: string; version: number }>;

/** AI 管线阶段 */
type PipelineStage =
  | 'requirement'
  | 'bom'
  | 'schematic'
  | 'pcb_layout'
  | 'procurement';

/** 报告板块 */
type ReportSection =
  | 'overview'
  | 'requirements'
  | 'bom'
  | 'schematic_intent'
  | 'pcb_layout'
  | 'procurement';
```

---

## 7. Command / Provider / Service 分层

### 7.1 分层架构

```text
┌─────────────────────────────────────────────┐
│                  Commands 层                 │
│  用户触发的 VS Code 命令（命令面板/快捷键）    │
├─────────────────────────────────────────────┤
│                 Providers 层                 │
│  Webview 生命周期管理 + 消息路由              │
├─────────────────────────────────────────────┤
│                 Services 层                  │
│  业务逻辑（AI 管线、EDA 规则、采购、存储）     │
├─────────────────────────────────────────────┤
│                  Shared 层                   │
│  类型定义 + 常量                              │
└─────────────────────────────────────────────┘
```

### 7.2 各层职责

| 层级 | 目录 | 职责 | 示例 |
|------|------|------|------|
| Commands | `extension/commands/` | 注册 VS Code 命令，调用 Service | `analyzeProject`, `generateBom`, `openReport` |
| Providers | `extension/providers/` | 管理 Webview 生命周期，路由 postMessage | `SidePanelProvider`, `ReportPanelProvider` |
| Services | `extension/services/` | 核心业务逻辑，不依赖 VS Code UI API | `AiPipelineService`, `EdaRuleEngine`, `ProcurementService`, `StorageService` |
| Shared | `shared/` | Extension 与 Webview 共享的类型和常量 | 消息协议类型、报告数据结构、EDA 领域类型 |

### 7.3 依赖方向

```text
Commands → Services → Shared
Providers → Services → Shared
Webview → Shared
```

- Commands 和 Providers 可调用 Services
- Services 之间可互相调用
- Services 不依赖 Commands 或 Providers
- 所有层共享 Shared 中的类型定义

---

## 8. AI 调用链路

### 8.1 中转站架构

```text
┌──────────┐     OpenAI 兼容格式     ┌──────────────┐     Anthropic 格式     ┌──────────┐
│ Extension │ ──────────────────────► │  中转站       │ ──────────────────────► │ Claude   │
│  Host    │ ◄────── SSE stream ──── │ (new-api)    │ ◄────── SSE stream ──── │  API     │
└──────────┘                         └──────────────┘                         └──────────┘
```

### 8.2 SDK 配置

```typescript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: userApiKey,         // 从 SecretStorage 读取
  baseURL: userBaseUrl,       // 用户配置的中转站 URL
});
```

### 8.3 分阶段模型配置

不同管线阶段可配置不同模型：

```typescript
interface PipelineModelConfig {
  requirement: string;    // 需求分析阶段的模型
  bom: string;            // BOM 生成阶段的模型
  schematic: string;      // 原理图意图阶段的模型
  pcbLayout: string;      // PCB 布局阶段的模型
  procurement: string;    // 采购映射阶段的模型
  designReview: string;   // 设计审查阶段的模型
  chat: string;           // 普通对话的模型
}
```

用户可在插件设置中为每个阶段选择模型，默认全部使用同一个模型。

### 8.4 中转站协议假设

> 当前实现假设中转站稳定提供 OpenAI-compatible `chat/completions` 接口（含 `stream: true` 支持）。若中转站协议不兼容或发生变更，需要单独适配 client 层。插件应将 AI 调用封装在独立的 adapter 中，避免协议细节泄漏到业务逻辑层。

### 8.5 调用流程

```typescript
// extension/services/ai/AiPipelineService.ts
async function runPipeline(requirement: string, config: PipelineModelConfig) {
  // 阶段 1: 需求分析
  const reqSpec = await callAi('requirement', config.requirement, requirementPrompt);
  // 阶段 2: BOM 生成
  const bom = await callAi('bom', config.bom, bomPrompt(reqSpec));
  // 阶段 3: 原理图意图
  const schematic = await callAi('schematic', config.schematic, schematicPrompt(reqSpec, bom));
  // 阶段 4: PCB 布局
  const pcbLayout = await callAi('pcbLayout', config.pcbLayout, pcbPrompt(reqSpec, bom, schematic));
  // 阶段 5: 采购映射
  const procurement = await callAi('procurement', config.procurement, procurementPrompt(bom));
  // 阶段 6: 设计审查
  const review = await callAi('designReview', config.designReview, reviewPrompt(reqSpec, bom, schematic, pcbLayout));
}
```

---

## 9. SecretStorage API Key 管理

### 9.1 存储方式

使用 VS Code 的 `SecretStorage` API 加密存储 API Key：

```typescript
// API Key（敏感，走 SecretStorage 加密）
await context.secrets.store('aiEdaCopilot.apiKey', apiKey);
const apiKey = await context.secrets.get('aiEdaCopilot.apiKey');
await context.secrets.delete('aiEdaCopilot.apiKey');

// Base URL（非敏感，走 settings.json）
// 通过 vscode.workspace.getConfiguration('aiEdaCopilot').get('baseUrl') 读取

```

### 9.2 用户配置项

通过 VS Code Settings UI 提供配置入口（敏感字段走 SecretStorage，非敏感字段走 settings.json）：

| 配置项 | 存储位置 | 说明 |
|--------|----------|------|
| API Key | SecretStorage（加密） | 中转站 API Key |
| Base URL | settings.json | 中转站地址，用户自由配置 |
| 模型选择 | settings.json | 各管线阶段使用的模型 |
| 报告语言 | settings.json | 中文 / 英文 |
| UI 语言 | settings.json | 中文 / 英文 |

---

## 10. 数据持久化方案

### 10.1 存储结构

项目数据存储在 VS Code workspace 本地文件夹：

```text
{workspace}/
└─ .ai-eda/
   └─ {项目名}/
      ├─ config.json              # 项目配置（见下方字段定义）
      ├─ schemes/                 # 设计方案
      │  ├─ scheme-a/
      │  │  ├─ report-v1.json     # 报告版本 1
      │  │  ├─ report-v2.json     # 报告版本 2
      │  │  └─ ...                # 最多保留 10 个版本
      │  └─ scheme-b/
      │     └─ ...
      ├─ conversations/           # 对话历史
      │  └─ {timestamp}.json      # 与报告版本关联
      └─ exports/                 # 用户导出的文件
         ├─ {项目名}_{时间戳}_bom.csv
         ├─ {项目名}_{时间戳}_report.md
         └─ {项目名}_{时间戳}_report.json
```

### 10.2 config.json 字段定义

```typescript
interface ProjectConfig {
  projectName: string;          // 项目名称
  createdAt: string;            // 创建时间（ISO 8601）
  lastOpenedAt: string;         // 最后打开时间
  currentSchemeId: string;      // 当前活动方案 ID
  currentVersion: number;       // 当前查看的报告版本号
  reportLanguage: 'zh' | 'en';  // 报告语言
  schemes: SchemeMeta[];        // 方案列表元数据
}
```

### 10.3 版本管理策略

- 每次报告生成自动创建新版本
- 保留最近 **10 个版本**
- 超出 10 个后自动删除最旧版本
- 用户可手动删除任意版本
- 用户可另存版本到本地任意路径

### 10.4 StorageService 接口

```typescript
interface StorageService {
  // 项目管理
  listProjects(): Promise<ProjectMeta[]>;
  createProject(name: string): Promise<ProjectMeta>;
  deleteProject(projectId: string): Promise<void>;

  // 方案管理
  listSchemes(projectId: string): Promise<SchemeMeta[]>;
  createScheme(projectId: string, name: string): Promise<SchemeMeta>;

  // 报告版本
  saveReport(projectId: string, schemeId: string, report: Report): Promise<void>;
  getReport(projectId: string, schemeId: string, version: number): Promise<Report>;
  listVersions(projectId: string, schemeId: string): Promise<VersionMeta[]>;
  deleteVersion(projectId: string, schemeId: string, version: number): Promise<void>;
  exportReport(projectId: string, schemeId: string, version: number, targetPath: string): Promise<void>;

  // 对话历史
  saveConversation(projectId: string, conversation: Conversation): Promise<void>;
  getConversation(projectId: string, conversationId: string): Promise<Conversation>;

  // 活动状态管理
  setCurrentScheme(projectId: string, schemeId: string): Promise<void>;
  setCurrentVersion(projectId: string, schemeId: string, version: number): Promise<void>;
  touchProject(projectId: string): Promise<void>;  // 更新 lastOpenedAt

  // 导出
  exportBomCsv(projectId: string, schemeId: string, version: number): Promise<string>;
  exportReportMarkdown(projectId: string, schemeId: string, version: number): Promise<string>;
  exportReportJson(projectId: string, schemeId: string, version: number): Promise<string>;
}
```

---

## 11. 流式输出方案

### 11.1 完整链路

```text
中转站 (SSE stream)
  │
  ▼
Extension Host (openai SDK stream 迭代)
  │
  │  100ms 批处理缓冲
  │  累积 token → 拼接为文本块
  │
  ▼
postMessage({ type: 'report_stream_chunk', ... })
  │
  ▼
Webview React 状态更新 → 增量渲染
```

### 11.2 批处理策略

```typescript
// extension/services/ai/streamBuffer.ts

const BATCH_INTERVAL_MS = 100;

class StreamBuffer {
  private buffer: string = '';
  private timer: NodeJS.Timeout | null = null;
  private onFlush: (chunk: string) => void;

  constructor(onFlush: (chunk: string) => void) {
    this.onFlush = onFlush;
  }

  push(token: string) {
    this.buffer += token;
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), BATCH_INTERVAL_MS);
    }
  }

  flush() {
    if (this.buffer) {
      this.onFlush(this.buffer);
      this.buffer = '';
    }
    this.timer = null;
  }

  end() {
    this.flush();
  }
}
```

### 11.3 为什么是 100ms

- 50ms 以下：postMessage 频率过高，Webview 渲染压力大
- 200ms 以上：用户感知到明显的"卡顿感"
- 100ms：平衡流畅度和性能，人眼感知连续

---

## 12. 错误重试策略

### 12.1 自动重试配置

| 参数 | 值 |
|------|-----|
| 最大重试次数 | 10 次 |
| 重试间隔 | 15 秒 |
| 用户手动重试 | 支持（任何时候可点击重试按钮） |

### 12.2 重试逻辑

```typescript
interface RetryConfig {
  maxRetries: number;       // 10
  retryIntervalMs: number;  // 15000
  retryableErrors: string[];
}

// 可重试的错误类型
const RETRYABLE_ERRORS = [
  'NETWORK_ERROR',          // 网络断开
  'TIMEOUT',                // 请求超时
  'RATE_LIMIT',             // 速率限制 (429)
  'SERVER_ERROR',           // 服务端错误 (5xx)
];

// 不可重试的错误类型
const NON_RETRYABLE_ERRORS = [
  'AUTH_ERROR',             // API Key 无效 (401)
  'INVALID_REQUEST',        // 请求格式错误 (400)
  'QUOTA_EXCEEDED',         // 额度用尽
];
```

### 12.3 重试时的用户反馈

- 显示当前重试次数和剩余次数
- 显示下次重试倒计时
- 用户可随时取消自动重试
- 用户可随时手动触发重试（不受自动重试计数限制）

---

## 13. 日志系统

### 13.1 输出目标

使用 VS Code **Output Channel**：

```typescript
const outputChannel = vscode.window.createOutputChannel('AI EDA Copilot');
```

用户可在 VS Code 底部"输出"面板中查看日志。

### 13.2 日志级别

| 级别 | 用途 | 默认启用 |
|------|------|----------|
| DEBUG | 开发调试信息、postMessage 内容、API 请求详情 | 仅开发模式 |
| INFO | 管线阶段进度、用户操作记录 | 是 |
| WARN | 非致命异常、降级提示、重试触发 | 是 |
| ERROR | 致命错误、API 调用失败、文件系统异常 | 是 |

### 13.3 日志格式

```text
[2026-03-07 14:30:00.123] [INFO] [AiPipeline] 开始 BOM 生成阶段，使用模型: claude-sonnet-4-20250514
[2026-03-07 14:30:05.456] [WARN] [Procurement] JLCPCB API 返回 429，触发重试 (1/10)
[2026-03-07 14:30:20.789] [ERROR] [AiPipeline] 流式输出中断: NETWORK_ERROR
```

### 13.4 性能注意事项

- 热路径（流式 token 处理）中避免 `JSON.stringify` 日志
- DEBUG 级别日志使用惰性求值，生产模式零开销
- Output Channel 写入为异步，不阻塞主线程

---

## 14. 安全约束

| 约束项 | 措施 |
|--------|------|
| API Key 存储 | SecretStorage 加密，不写入 settings.json |
| API Key 传输 | 仅通过 HTTPS 发送到中转站 |
| Webview 沙箱 | Webview 无法直接访问文件系统或网络，一切通过 Extension Host |
| 用户数据 | 完全本地存储，不上传到任何服务器 |
| AI 请求内容 | 仅发送必要的分析文本，不发送整个 workspace |

---

## 15. 包体积控制

目标：插件包 ≤ 100 MB

| 组成部分 | 预估体积 | 备注 |
|----------|----------|------|
| Extension JS bundle | ~2 MB | esbuild tree-shaking + minify |
| Webview JS bundle（含 React + Zustand） | ~500 KB | esbuild 打包 |
| openai SDK | ~1 MB | 仅运行时依赖 |
| CSS / 静态资源 | ~200 KB | CSS Modules 编译后 |
| **合计** | **~4 MB** | 远低于 100 MB 限制 |

---

## 16. 完整依赖清单

### 16.1 运行时依赖 (dependencies)

| 包名 | 用途 |
|------|------|
| `openai` | AI 中转站调用（OpenAI 兼容格式），流式输出 |
| `react` | Webview UI 框架 |
| `react-dom` | React DOM 渲染 |
| `zustand` | Webview 状态管理 |

### 16.2 开发依赖 (devDependencies)

| 包名 | 用途 |
|------|------|
| `typescript` | 类型系统 |
| `esbuild` | Extension + Webview 双入口打包 |
| `@types/vscode` | VS Code Extension API 类型 |
| `@types/react` | React 类型 |
| `@types/react-dom` | React DOM 类型 |
| `@vscode/vsce` | .vsix 打包与发布工具 |
| `css-modules-typescript-loader` | CSS Modules 类型生成（可选） |

### 16.3 不引入的依赖

| 包名 | 原因 |
|------|------|
| `@vscode/webview-ui-toolkit` | 已归档停维 |
| `tailwindcss` | 增加构建复杂度和体积，CSS Modules 足够 |
| `@anthropic-ai/sdk` | 中转站为 OpenAI 兼容格式，不需要 |
| `webpack` | esbuild 更快更简单 |
| `styled-components / emotion` | CSS-in-JS 运行时开销不必要 |

---

## 附录 A：esbuild 双入口打包策略

```typescript
// esbuild.js

// Extension 入口（Node.js 环境）
esbuild.build({
  entryPoints: ['src/extension/activate.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  external: ['vscode'],
  minify: true,
});

// Webview 入口（浏览器环境）
esbuild.build({
  entryPoints: [
    'src/webview/panel/PanelApp.tsx',
    'src/webview/report/ReportApp.tsx',
  ],
  bundle: true,
  outdir: 'dist/webview',
  platform: 'browser',
  format: 'esm',
  minify: true,
  loader: { '.css': 'local-css' },
});
```

## 附录 B：VS Code CSS 变量主题适配

```css
/* webview/styles/theme.module.css */
.container {
  background-color: var(--vscode-editor-background);
  color: var(--vscode-editor-foreground);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
}

.button-primary {
  background-color: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border-radius: 6px;
}

.table-header {
  background-color: var(--vscode-editorGroupHeader-tabsBackground);
  border-bottom: 1px solid var(--vscode-editorGroupHeader-tabsBorder);
}
```

---

## 17. 测试策略

### 17.1 测试技术选型

| 层级 | 测试框架 | 说明 |
|------|----------|------|
| 单元测试 | Vitest | 快速、TypeScript 原生支持、兼容 Jest API |
| Extension Host 测试 | @vscode/test-electron | VS Code 官方 Extension 测试框架 |
| Webview 组件测试 | @testing-library/react | React 组件行为测试 |
| 消息协议测试 | Vitest + 自定义 mock | 类型级 + 运行时 schema 校验 |

### 17.2 各层测试方案

#### Extension 层

| 测试对象 | 方案 | 说明 |
|----------|------|------|
| InputService | 单元测试 | 三种标准化路径输入输出验证 |
| AiPipelineService | mock AiAdapter | 管线阶段调度、重试逻辑、JSON 解析 |
| AiAdapter | mock OpenAI SDK | stream/complete 调用、错误分类 |
| StreamBuffer | 单元测试 | 批量缓冲时序、flush 行为 |
| StorageService | 文件系统集成测试 | 读写、版本淘汰、路径处理 |
| JlcAdapter | mock HTTP 响应 | API 调用、降级逻辑、错误处理 |
| RuleEngineService | 单元测试 | 每条规则正例 + 反例 |

#### Webview 层

| 测试对象 | 方案 | 说明 |
|----------|------|------|
| Zustand Store | 单元测试 | action 触发后状态变化验证 |
| Report 组件 | @testing-library/react | loading / empty / ready / error / stale 状态 |
| Panel 组件 | @testing-library/react | 输入提交、模式切换、模板选择 |

#### 共享层

| 测试对象 | 方案 | 说明 |
|----------|------|------|
| 消息协议 | 类型级编译检查 + 运行时 schema | 确保 Extension ↔ Webview 消息格式一致 |
| Artifact Schema | JSON Schema 校验 | 确保 AI 输出对齐类型定义 |

### 17.3 流式输出测试

```typescript
// 测试策略：构造 mock AsyncGenerator，验证 StreamBuffer 行为
async function* mockStream(chunks: string[]) {
  for (const chunk of chunks) {
    yield { content: chunk, finishReason: null };
  }
}
// 验证：flush 时序、批量合并、dispose 清理
```

### 17.4 Adapter Mock 策略

```text
AiAdapter mock:
  ├── 正常流式返回 → 验证完整文本收集
  ├── 中途断流 → 验证重试触发
  ├── 401 错误 → 验证不重试 + 错误分类
  └── 429 错误 → 验证重试 + 间隔

JlcAdapter mock:
  ├── 精确匹配 → 验证料号返回
  ├── 无匹配 → 验证降级到 jlcsearch
  └── 全部失败 → 验证兜底标记"库存未知"
```

### 17.5 Worktree 对工程结构的影响

- 工程结构需要支持多 worktree 并行开发，不依赖写死绝对路径
- 构建脚本使用相对路径（`esbuild.js` 中已使用 `__dirname` 相对引用）
- 测试配置使用相对路径，不硬编码 workspace 绝对路径
- `.env` 文件不入版本控制，每个 worktree 可独立配置
- `dist/` 输出目录每个 worktree 独立，不冲突
