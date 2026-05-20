# AI EDA Copilot — 实施计划 (IMPLEMENTATION_PLAN)

> 版本：1.0
> 日期：2026-03-07
> 状态：草案
> 前置文档：PRD.md · TECH_STACK.md · BACKEND_STRUCTURE.md

---

## 0. 文档目的

本文档将 PRD 功能需求、TECH_STACK 技术选型、BACKEND_STRUCTURE 数据架构，拆解为**可按顺序执行的实施阶段**。

每个 Phase 包含：

- 目标与交付物
- 涉及文件与模块
- 依赖关系
- 验收标准

Phase 默认按顺序推进；除非某 Phase 被明确标注为可并行或可插入，否则不得跳跃。Phase 内部的 Task 可酌情并行。

---

## 1. 阶段总览

| Phase | 名称 | 核心交付 | 预估复杂度 |
|-------|------|----------|-----------|
| 0 | 工程初始化 | 可编译、可安装的空壳插件 | 低 |
| 1 | 插件骨架 | Side Panel + Report Webview + 双 Webview 通信 | 中 |
| 2 | 输入层 | 对话、表单、模板、AnalysisRequest 标准化 | 中 |
| 3 | AI 主管线 MVP | Claude API 接入、RequirementSpec 生成、Overview、流式输出 | 高 |
| 4 | BOM + 采购 MVP | BOMItem 生成、CSV 导出、JLCPCB 料号匹配 | 高 |
| 5 | 原理图 + PCB | SchematicIntent、引脚表、Mermaid 框图、PCB 布局规划 | 高 |
| 6 | 规则引擎 + 设计审查 | Hard/Warning 规则、JLC 兼容性校验、DesignReview、stale 状态 | 中 |
| 7 | 本地存储 + 历史 | .ai-eda/ 持久化、版本管理、历史浏览、导出 | 中 |
| 8 | 代码分析输入 | Workspace 扫描、GPIO/库/外设提取、代码上下文注入管线 | 中 |

```text
Phase 0 ──► Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4 ──┬──► Phase 5 ──► Phase 6
                                                            │                    │
                                                            └── Phase 7 ◄────────┘
                                                                    │
                                                               Phase 8
```

> Phase 4 与 Phase 5 可部分并行（BOM 完成后 Procurement 与 Schematic 可并行开发）。
> Phase 7 可在 Phase 4 之后随时开始。Phase 8 独立性最高，可灵活插入。

---

## 2. Phase 0 — 工程初始化

### 2.1 目标

从零建立可编译、可安装、可在 VS Code 中激活的空壳插件。

### 2.2 交付物

- `package.json`（扩展清单 + 依赖 + 脚本）
- `tsconfig.json`（Extension + Webview 双配置）
- esbuild 构建脚本（Node.js extension 入口 + browser Webview 入口）
- `src/extension/activate.ts`（最小激活函数，注册空命令）
- `.vscodeignore`、`.gitignore` 更新
- `.env.example`（API 配置模板）

### 2.3 涉及文件

```text
my_app/
├─ package.json
├─ tsconfig.json
├─ tsconfig.webview.json
├─ esbuild.config.mjs
├─ .vscodeignore
├─ .gitignore
├─ .env.example
└─ src/
   ├─ extension/
   │  └─ activate.ts
   └─ shared/
      └─ types/
         └─ index.ts
```

### 2.4 验收标准

- [ ] `npm run build` 无错误
- [ ] 生成 `.vsix` 文件
- [ ] 安装后 VS Code 输出面板显示 "AI EDA Copilot activated"
- [ ] 注册的空命令可从命令面板调用（无实际功能）

### 2.5 关键决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 构建工具 | esbuild | 速度快，VS Code 官方推荐 |
| 双入口 | extension（Node.js）+ webview（browser） | Extension Host 与 Webview 运行环境不同 |
| 类型共享 | `src/shared/types/` | Extension 和 Webview 共用类型定义 |

---

## 3. Phase 1 — 插件骨架

### 3.1 目标

搭建双 Webview 架构（Side Panel + Report Tab），建立完整的消息通信链路。

### 3.2 交付物

- Side Panel Webview Provider（侧边栏注册 + React 渲染）
- Report Webview Panel（新 Tab 中打开 + React 渲染）
- 消息协议类型定义（PanelToExtension / ExtensionToPanel / ExtensionToReport / ReportToExtension）
- 命令注册：`aiEda.openReport`、`aiEda.showPanel`
- Webview React 基础框架（空壳 App 组件 + 样式基础）
- CSS 变量桥接 VS Code 主题

### 3.3 涉及文件

```text
src/
├─ extension/
│  ├─ activate.ts                    // 更新：注册 Provider + 命令
│  ├─ commands/
│  │  └─ index.ts                    // 命令注册中心
│  └─ providers/
│     ├─ SidePanelProvider.ts        // ViewProvider 实现
│     └─ ReportPanelManager.ts       // WebviewPanel 管理
├─ webview/
│  ├─ panel/                         // Side Panel React App
│  │  ├─ index.tsx
│  │  ├─ App.tsx
│  │  └─ vscode.ts                   // acquireVsCodeApi 封装
│  └─ report/                        // Report Tab React App
│     ├─ index.tsx
│     ├─ App.tsx
│     └─ vscode.ts
├─ shared/
│  └─ types/
│     ├─ messages.ts                 // 全部消息协议类型
│     └─ index.ts
└─ styles/
   └─ variables.css                  // VS Code CSS 变量桥接
```

### 3.4 消息通信链路

```text
Side Panel (React)
  │  postMessage(PanelToExtension)
  ▼
Extension Host (Node.js)
  │  onDidReceiveMessage → 业务处理
  │  postMessage(ExtensionToPanel) → Side Panel
  │  postMessage(ExtensionToReport) → Report Tab
  ▼
Report Tab (React)
  │  onMessage(ExtensionToReport) → 渲染
  │  postMessage(ReportToExtension) → Extension Host
  ▼
Extension Host
```

### 3.5 验收标准

- [ ] 侧边栏出现 AI EDA Copilot 图标，点击显示 Side Panel
- [ ] 命令面板执行 `AI EDA: Open Report` 可打开空白 Report Tab
- [ ] Side Panel 发送消息 → Extension Host 接收 → 转发 → Report Tab 接收并显示
- [ ] 切换 VS Code 主题时 Webview 样式跟随变化

---

## 4. Phase 2 — 输入层

### 4.1 目标

实现用户输入的三种方式（对话、表单、模板），并统一输出标准化的 `AnalysisRequest`。

### 4.2 交付物

- 对话输入组件（ChatInput）
- 表单输入组件（FormInput）
- 模板选择组件（TemplateSelector）
- 对话/表单切换逻辑
- `InputService`：将三种输入标准化为 `AnalysisRequest`
- 5 个 V1 模板数据（ESP32 传感器、STM32 控制板、OLED 小板、电池供电、电源模块）

### 4.3 涉及文件

```text
src/
├─ webview/
│  └─ panel/
│     ├─ components/
│     │  ├─ ChatInput.tsx             // 对话输入
│     │  ├─ FormInput.tsx             // 表单输入
│     │  ├─ TemplateSelector.tsx      // 模板选择
│     │  └─ InputModeToggle.tsx       // 模式切换
│     └─ store/
│        └─ inputStore.ts            // Zustand 输入状态
├─ extension/
│  └─ services/
│     └─ InputService.ts             // 输入标准化
├─ shared/
│  ├─ types/
│  │  ├─ input.ts                    // AnalysisRequest 等类型
│  │  └─ templates.ts                // 模板类型
│  └─ constants/
│     └─ templates.ts                // 5 个预设模板数据
```

### 4.4 AnalysisRequest 核心类型

```typescript
interface AnalysisRequest {
  inputType: 'natural_language' | 'form' | 'template' | 'code_analysis';
  rawText?: string;
  formData?: FormInputData;
  templateId?: string;
  codeContext?: CodeAnalysisResult;
  timestamp: string;
}
```

### 4.5 验收标准

- [ ] 对话框输入文本 → 发送到 Extension Host → 解析为 AnalysisRequest
- [ ] 切换到表单模式 → 填写字段 → 发送到 Extension Host → 解析为 AnalysisRequest
- [ ] 选择模板 → 预填字段 → 用户可修改 → 发送
- [ ] 两种模式数据互通（对话模式写的内容切换到表单模式可见）
- [ ] 空输入 / 无意义输入有友好提示

---

## 5. Phase 3 — AI 主管线 MVP

### 5.1 目标

接通 Claude API，实现第一个完整管线阶段（RequirementSpec），生成 Overview，在 Report Tab 中流式展示。

### 5.2 交付物

- `AiAdapter`：OpenAI SDK + 用户配置的 Base URL / API Key
- `AiPipelineService`：管线编排器（Phase 3 仅 requirement 阶段）
- Prompt 模板：需求分析 system prompt
- RequirementSpec 解析器
- Overview 生成逻辑（从 RequirementSpec 派生）
- Report Tab 渲染：Overview + Requirements 两个板块
- 流式输出管理（100ms 批量缓冲 → Webview 推送）
- API Key 配置 UI（Settings 页 / 首次使用引导）
- 错误处理 + 重试（10 次 / 15s 间隔）

### 5.3 涉及文件

```text
src/
├─ extension/
│  ├─ services/
│  │  ├─ AiPipelineService.ts        // 管线编排器
│  │  └─ InputService.ts             // 已有，更新
│  ├─ adapters/
│  │  └─ AiAdapter.ts                // AI API 适配器
│  └─ prompts/
│     └─ requirementPrompt.ts        // 需求分析 prompt
├─ webview/
│  └─ report/
│     ├─ components/
│     │  ├─ ReportShell.tsx           // 报告外壳 + Tab 导航
│     │  ├─ OverviewSection.tsx       // 概览板块
│     │  ├─ RequirementsSection.tsx   // 需求板块（可编辑）
│     │  └─ StreamingIndicator.tsx    // 流式状态指示器
│     └─ store/
│        └─ reportStore.ts           // Zustand 报告状态
├─ shared/
│  └─ types/
│     ├─ artifacts.ts                // RequirementSpec 等类型
│     └─ pipeline.ts                 // PipelineStage, ArtifactState 等
```

### 5.4 流式输出链路

```text
AiAdapter.stream()
  │  AsyncIterable<AiStreamChunk>
  ▼
AiPipelineService
  │  100ms 批量缓冲
  │  解析 JSON 碎片 → RequirementSpec 增量
  ▼
Extension Host
  │  postMessage(ExtensionToReport: streamUpdate)
  ▼
Report Tab (React)
  │  reportStore 更新 → 重渲染
  ▼
用户看到报告边生成边展示
```

### 5.5 验收标准

- [ ] 配置 API Key + Base URL 后，输入需求描述 → 生成 RequirementSpec
- [ ] Report Tab 展示 Overview + Requirements 两个板块
- [ ] 流式输出：用户可见逐步填充效果
- [ ] Requirements 区可编辑（受控编辑，仅内存态更新，暂不落盘持久化——持久化在 Phase 7 实现）
- [ ] API 调用失败时显示错误 + 重试按钮
- [ ] 所有 AI 推断字段标注 source / status / confidence

---

## 6. Phase 4 — BOM + 采购 MVP

### 6.1 目标

基于 RequirementSpec 生成 BOM 清单，对接 JLCPCB API 匹配料号，支持 CSV 导出。

### 6.2 交付物

- BOM 生成 prompt + 解析器
- BOM 表格组件（默认表格 + 行展开详情）
- `JlcAdapter`：JLCPCB 官方 API + jlcsearch fallback
- `ProcurementService`：料号匹配 + 库存查询 + 替代件
- Procurement 板块 UI
- BOM CSV 导出（对齐嘉立创 SMT 模板，作为采购 MVP 先行跑通；Phase 7 再补全统一导出系统）
- 立创商城详情页链接生成

### 6.3 涉及文件

```text
src/
├─ extension/
│  ├─ services/
│  │  ├─ AiPipelineService.ts        // 更新：增加 bom + procurement 阶段
│  │  └─ ProcurementService.ts       // 采购服务
│  ├─ adapters/
│  │  └─ JlcAdapter.ts               // JLCPCB API 适配器
│  ├─ prompts/
│  │  └─ bomPrompt.ts                // BOM 生成 prompt
│  └─ export/
│     └─ bomCsvExporter.ts           // CSV 导出
├─ webview/
│  └─ report/
│     └─ components/
│        ├─ BomSection.tsx            // BOM 表格板块
│        ├─ BomRowDetail.tsx          // BOM 行展开详情
│        ├─ ProcurementSection.tsx    // 采购板块
│        └─ ExportButton.tsx          // 导出按钮
├─ shared/
│  └─ types/
│     ├─ artifacts.ts                // 更新：BOMItem, ProcurementItem
│     └─ jlc.ts                      // JlcPart, JlcStockInfo
```

### 6.4 JLCPCB API 调用策略

```text
1. 首选: JLCPCB 官方 API → 精确料号 + 库存 + 价格
2. 降级: jlcsearch API → 社区数据，标注"备选来源"
3. 兜底: 标记"库存未知"，不阻断报告
```

### 6.5 验收标准

- [ ] RequirementSpec → BOM 清单生成成功
- [ ] BOM 表格显示 5 个默认列 + 可展开详情
- [ ] 每个器件有立创商城详情页链接（可点击跳转）
- [ ] JLCPCB API 匹配料号 + 查询库存
- [ ] API 不可用时自动降级到 jlcsearch
- [ ] CSV 导出文件可直接导入嘉立创 SMT 下单页
- [ ] Procurement 板块显示兼容性状态 + 替代件建议

---

## 7. Phase 5 — 原理图 + PCB

### 7.1 目标

生成 SchematicIntent（文字描述 + Mermaid 框图 + 引脚连接表）和 PCBLayoutPlan（分区图 + 布局建议）。

### 7.2 交付物

- Schematic 生成 prompt + 解析器
- PCB Layout 生成 prompt + 解析器
- SchematicIntent 三种展示形式组件
- Mermaid 渲染组件
- PCB 分区可视化组件
- PCBLayoutPlan 布局建议文字组件

### 7.3 涉及文件

```text
src/
├─ shared/
│  └─ types/
│     ├─ schematic.types.ts           // 新增：SchematicIntent 及子类型
│     ├─ pcb.types.ts                 // 新增：PCBLayoutPlan 及子类型
│     ├─ index.ts                     // 更新：re-export 新类型
│     └─ messages.types.ts            // 更新：schematic_data / pcb_layout_data 消息类型
├─ extension/
│  ├─ services/
│  │  └─ AiPipelineService.ts         // 更新：runSchematicStage + runPcbLayoutStage + 解析器 + 自动串联
│  └─ prompts/
│     ├─ schematicPrompt.ts           // 新增：原理图意图生成 prompt
│     └─ pcbLayoutPrompt.ts           // 新增：PCB 布局规划 prompt
├─ webview/
│  └─ report/
│     ├─ store/
│     │  └─ reportStore.ts            // 更新：schematicIntent / pcbLayoutPlan 状态
│     ├─ ReportApp.tsx                // 更新：导入新组件 + 消息处理 + tab 渲染
│     └─ components/
│        ├─ SchematicSection.tsx + .css  // 新增：原理图意图板块（三视图切换）
│        ├─ SchematicTextView.tsx        // 新增：文字描述子组件
│        ├─ PinConnectionTable.tsx       // 新增：引脚连接表子组件
│        ├─ MermaidRenderer.tsx          // 新增：Mermaid 源码展示（MVP，预留 CDN 渲染接口）
│        ├─ PcbLayoutSection.tsx + .css  // 新增：PCB 布局板块
│        └─ PcbZoneMap.tsx              // 新增：CSS Grid 3×3 分区可视化
```

> **与原计划差异说明**：
> - 原计划 `SchematicDiagram.tsx` 合并入 `MermaidRenderer.tsx`，作为通用 Mermaid 渲染器
> - 原计划类型放 `artifacts.ts`，实际拆为独立的 `schematic.types.ts` + `pcb.types.ts`，保持单一职责
> - 新增 `messages.types.ts` / `reportStore.ts` / `ReportApp.tsx` / `index.ts` 的修改，原计划未列出

### 7.4 验收标准

- [ ] SchematicIntent 生成成功，三种展示形式可切换
- [ ] Mermaid 框图正确渲染模块级连接
- [ ] 引脚连接表显示 designator / pin / netName / direction
- [ ] PCBLayoutPlan 生成成功，显示分区块图
- [ ] 布局建议文字清晰标注约束级别（mandatory / recommended）
- [ ] 网络分类正确（power / communication / control / analog）

---

## 8. Phase 6 — 规则引擎 + 设计审查

### 8.1 目标

实现规则校验引擎，对 BOM/Schematic/PCBLayout 执行硬规则 + 警告规则 + JLC 兼容性校验，生成 DesignReviewFinding。

### 8.2 交付物

- `Rule` 接口正式定义（已在 BACKEND_STRUCTURE.md §8.3 预定义，此阶段落实到 `src/shared/types/`）
- `RuleEngineService`：规则注册 + 校验执行
- 硬规则实现（HR-001 ~ HR-006）
- 警告规则实现（WR-001 ~ WR-006）
- JLC 兼容性规则实现（JR-001 ~ JR-005）
- DesignReview prompt + AI 深度审查
- 设计审查结果 UI 板块
- ArtifactState stale 状态管理
- Regenerate 按钮 + 局部重算逻辑

### 8.3 涉及文件

```text
src/
├─ extension/
│  ├─ services/
│  │  ├─ RuleEngineService.ts         // 规则引擎
│  │  └─ AiPipelineService.ts         // 更新：增加 design_review 阶段 + stale 管理
│  ├─ rules/
│  │  ├─ hardRules.ts                 // HR-001 ~ HR-006
│  │  ├─ warningRules.ts              // WR-001 ~ WR-006
│  │  ├─ jlcRules.ts                  // JR-001 ~ JR-005
│  │  └─ ruleRegistry.ts             // 规则注册表
│  └─ prompts/
│     └─ designReviewPrompt.ts
├─ webview/
│  └─ report/
│     └─ components/
│        ├─ DesignReviewSection.tsx    // 设计审查板块
│        ├─ FindingCard.tsx            // 单条审查发现
│        ├─ StaleIndicator.tsx         // 过期状态提示
│        └─ RegenerateButton.tsx       // 重新生成按钮
├─ shared/
│  └─ types/
│     └─ artifacts.ts                 // 更新：DesignReviewFinding, Rule
```

### 8.4 级联失效规则

```text
修改 RequirementSpec → 全部下游失效
仅重算 BOM         → Schematic, PCBLayout, Procurement, DesignReview 失效
仅重算 Schematic    → PCBLayout, DesignReview 失效
仅重算 PCBLayout    → DesignReview 失效
仅重算 Procurement  → 无级联（末端节点）
仅重算 DesignReview → 无级联（末端节点）
```

### 8.5 验收标准

- [ ] 硬规则校验：封装为空 → critical 报错
- [ ] 警告规则校验：去耦电容未就近 → warning
- [ ] JLC 规则：无料号 → info 提示
- [ ] AI 设计审查生成 DesignReviewFinding 列表
- [ ] 修改 Requirements 后相关板块显示 stale 标记
- [ ] 点击 Regenerate 可选全部重算或指定模块重算
- [ ] 重算后 stale 标记消失，新内容替换旧内容

---

## 9. Phase 7 — 本地存储 + 历史

### 9.1 目标

实现 `.ai-eda/` 本地持久化，支持多项目、多方案、版本管理和历史浏览。

### 9.2 交付物

- `StorageService`：JSON 文件读写 + 版本管理
- 项目索引管理（index.json）
- 方案管理（config.json + schemes/）
- 报告版本存储（report-v{n}.json，最多 10 个）
- 对话历史存储（conversations/）
- 历史浏览 UI（Side Panel 项目列表 + 版本列表）
- 统一导出系统（Markdown / JSON / CSV），整合 Phase 4 已有的 BOM CSV 导出
- 多方案并排对比视图

### 9.3 涉及文件

```text
src/
├─ extension/
│  └─ services/
│     └─ StorageService.ts            // 持久化服务
├─ webview/
│  ├─ panel/
│  │  └─ components/
│  │     ├─ ProjectList.tsx            // 项目列表
│  │     ├─ VersionList.tsx            // 版本列表
│  │     └─ SchemeSelector.tsx         // 方案选择
│  └─ report/
│     └─ components/
│        └─ SchemeCompareView.tsx      // 方案对比视图
├─ shared/
│  └─ types/
│     └─ storage.ts                   // ProjectIndex, ProjectConfig, ReportFile 等
```

### 9.4 文件结构

```text
{workspace}/
└─ .ai-eda/
   ├─ index.json
   └─ {项目名}/
      ├─ config.json
      ├─ schemes/
      │  └─ {scheme-id}/
      │     ├─ report-v1.json
      │     └─ report-v2.json
      ├─ conversations/
      │  └─ {conversation-id}.json
      └─ exports/
         └─ {项目名}_{时间戳}_{类型}.{ext}
```

### 9.5 验收标准

- [x] 生成报告后自动保存到 `.ai-eda/{项目名}/`（按会话存储，全管线完成快照版本）
- [x] 重新打开 VS Code 后可加载历史报告
- [x] 版本列表显示最近 10 个版本，超出自动淘汰最旧
- [x] 用户可手动删除版本 / 另存到任意路径
- [ ] 多方案并排对比显示 BOM 差异（后续单独立项，不在本轮）
- [x] 对话历史保留并可回看
- [x] 导出 Markdown / JSON / CSV 文件名符合命名规则

---

## 10. Phase 8 — 代码分析输入

### 10.1 目标

支持用户选择 Workspace 中的固件代码文件夹，AI 解析代码提取硬件相关信息，注入分析管线。

> **V1 边界**：仅做轻量扫描与关键上下文提取（GPIO 使用、库引用、外设配置），不构建完整编译器级静态分析器。

### 10.2 交付物

- Workspace 文件夹选择 UI
- 代码扫描器（C / C++ / Python 文件遍历）
- GPIO 使用提取
- 第三方库检测
- 外设配置识别
- 模糊引用检测 + 向用户提问
- `CodeAnalysisResult` → `AnalysisRequest` 转换
- 代码上下文注入到 RequirementSpec prompt

### 10.3 涉及文件

```text
src/
├─ extension/
│  ├─ services/
│  │  ├─ CodeAnalysisService.ts       // 代码分析服务
│  │  └─ InputService.ts             // 更新：支持 code_analysis 类型
│  └─ analyzers/
│     ├─ cAnalyzer.ts                 // C/C++ 代码分析
│     └─ pythonAnalyzer.ts            // Python 代码分析
├─ webview/
│  └─ panel/
│     └─ components/
│        ├─ CodeFolderPicker.tsx       // 文件夹选择
│        └─ CodeAnalysisPreview.tsx    // 分析结果预览
├─ shared/
│  └─ types/
│     └─ input.ts                     // 更新：CodeAnalysisResult
```

### 10.4 验收标准

- [ ] 选择包含 ESP32 Arduino 代码的文件夹 → 检测出 GPIO / 库 / 外设
- [ ] 检测到模糊引用时向用户提问确认
- [ ] 代码分析结果可预览，用户确认后注入管线
- [ ] 纯代码输入也能生成完整 RequirementSpec
- [ ] 支持 C、C++、Python 三种语言

---

## 11. 跨阶段关注事项

### 11.1 贯穿全程的质量要求

| 要求 | 说明 |
|------|------|
| TypeScript strict | 全程开启严格模式，禁止 `any` 泄漏 |
| 消息类型安全 | Extension ↔ Webview 通信全部走强类型消息协议 |
| 错误边界 | 每个 Report Section 独立 ErrorBoundary |
| 国际化 | UI 文本从 Phase 1 开始走 i18n key，不硬编码 |
| 无障碍 | 键盘导航 + ARIA 标签从 Phase 1 开始 |

### 11.2 每个 Phase 的标准动作

1. 更新相关文档（如有 Schema 变更）
2. 实现功能
3. 手动验证验收标准
4. 更新 progress.txt

### 11.3 风险缓冲

| 风险 | 预案 |
|------|------|
| Claude API 流式解析 JSON 碎片困难 | 预留 fallback：先用非流式调用跑通，再优化为流式 |
| JLCPCB API 接口变更 | JlcAdapter 隔离层 + jlcsearch fallback |
| Mermaid 渲染在 Webview 中不稳定 | 预留 SVG 静态图 fallback |
| 报告生成超 3 分钟 | 管线分段生成 + 流式输出缓解等待 |
| 代码分析误检率高 | Phase 8 可选，不阻断核心链路 |

---

## 12. 文档依赖矩阵

| 文档 | Phase 0 | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 5 | Phase 6 | Phase 7 | Phase 8 |
|------|:-------:|:-------:|:-------:|:-------:|:-------:|:-------:|:-------:|:-------:|:-------:|
| PRD.md | ○ | ○ | ● | ● | ● | ● | ● | ● | ● |
| TECH_STACK.md | ● | ● | ○ | ● | ● | ○ | ○ | ○ | ○ |
| BACKEND_STRUCTURE.md | ○ | ○ | ○ | ● | ● | ● | ● | ● | ● |
| FRONTEND_GUIDELINES.md | ○ | ● | ● | ● | ● | ● | ● | ● | ○ |
| APP_FLOW.md | ○ | ● | ● | ● | ● | ● | ○ | ● | ● |

● = 核心依赖　○ = 参考依赖

---

## 13. Worktree 协作规则

### 13.1 使用时机

| Phase | 开发方式 |
|-------|---------|
| Phase 0 | 可在主分支直接初始化 |
| Phase 1+ | 建议每个 Phase 或 feature 使用独立 worktree |
| Hotfix | 独立 worktree，命名 `wt-hotfix-{描述}` |

### 13.2 命名规范

| 类型 | Worktree 名 | 分支名 |
|------|------------|--------|
| Phase 开发 | `wt-phase{N}-{描述}` | `feat/phase{N}/{描述}` |
| Feature 开发 | `wt-feat-{描述}` | `feat/{描述}` |
| Bugfix | `wt-hotfix-{描述}` | `fix/{描述}` |

### 13.3 Worktree 内开发流程

1. 创建 worktree + 分支
2. 更新 IMPLEMENTATION_PLAN 或相关文档中的计划
3. 编写/修改代码
4. 补充测试
5. 更新 progress.txt
6. 写变更说明
7. 合并前 checklist：
   - [ ] `npm run compile` 通过
   - [ ] `npx @vscode/vsce package --no-dependencies` 通过
   - [ ] 相关测试通过
   - [ ] progress.txt 已更新
   - [ ] 受影响文档已同步

### 13.4 并行 Worktree 注意事项

- 不同 worktree 修改同一文件时需协调
- `shared/types/` 变更影响全局，需优先合并
- 合并顺序：类型层 → 服务层 → UI 层

### 13.5 需求开发的 Worktree 执行模板

适用于新增一个独立需求、功能增强或中等复杂度交互改造。

#### 标准步骤

1. **明确需求范围**
   - 说明目标、非目标、影响 Phase
   - 判断属于输入层、AI 管线、报告展示、规则引擎还是采购层

2. **创建独立 worktree**
   - worktree 名：`wt-feat-{desc}` 或 `wt-phase{N}-{desc}`
   - 分支名：`feat/{desc}` 或 `feat/phase{N}/{desc}`

3. **先更新文档**
   - 涉及用户行为变化：更新 `APP_FLOW.md`
   - 涉及实施拆解/测试策略：更新 `IMPLEMENTATION_PLAN.md`
   - 涉及前端交互规范：更新 `FRONTEND_GUIDELINES.md`
   - 涉及类型/数据结构：更新 `BACKEND_STRUCTURE.md`
   - 涉及产品范围变化：更新 `PRD.md`

4. **定义最小可交付切片**
   - 明确入口文件
   - 明确最少改动文件
   - 明确本次不做的内容

5. **实现功能**
   - 先接口/类型，再 service，再 UI
   - 避免在一个 worktree 中同时做多个无关 feature

6. **补测试**
   - 单元测试：核心函数 / service / parser / store
   - UI Smoke：关键交互路径
   - 手动验收：对照 `APP_FLOW.md` 的流程和 Phase checklist

7. **自检并合并**
   - `npm run compile` 通过
   - `npx @vscode/vsce package --no-dependencies` 通过
   - 相关测试通过
   - `progress.txt` 已更新
   - 受影响文档已同步

### 13.6 代码可维护性纪律（防止 AI 编程屎山化）

AI 辅助编程极易产生"能跑但没人理解"的代码。以下规则强制保障可维护性：

#### 代码理解性要求

- 每个新增文件必须有文件级注释说明**职责边界**（做什么、不做什么）
- 每个 Service / Adapter 必须有明确的**输入输出契约**（参数类型 + 返回类型 + 错误类型）
- 关键业务逻辑（管线编排、状态机、规则引擎）必须有**数据流注释**（从哪来、到哪去）
- 禁止"魔法代码"：所有 `as any`、类型断言、动态字段访问必须附带注释说明原因

#### 修改安全网

- 修改已有文件前，必须先理解该文件的**职责边界**和**上下游依赖**
- 禁止"为了修一个 bug 而改了半个项目"——每次改动必须说明**为什么只改这些文件就够了**
- 新增功能必须明确：**如果要删除这个功能，需要改哪些文件？**（可逆性评估）

#### AI 生成代码审查清单

每次 AI 生成代码后，人工或 AI 必须检查：

- [ ] 函数/方法的命名是否自解释？
- [ ] 数据流是否可追踪？（从 UI 事件 → 消息 → Service → Adapter → 响应 → UI 更新）
- [ ] 错误路径是否有明确处理？（不允许静默 catch 吞错误）
- [ ] 是否引入了不必要的复杂度？（KISS 原则检查）
- [ ] 是否与现有代码风格一致？（命名、结构、注释语言）
- [ ] 删除此功能时影响范围是否可控？

#### 文档即理解

- 代码运行机制的"大图"必须存在于文档中（BACKEND_STRUCTURE / IMPLEMENTATION_PLAN）
- 修改运行机制时必须同步更新文档
- 如果一段代码需要超过 30 秒才能理解其意图，说明缺少注释或抽象不当

---

## 14. 测试用例设计方法

每个新增需求至少从以下 4 层设计测试：

### 14.1 单元测试

适用对象：纯函数、parser / formatter、service 层逻辑、Zustand store action

用例最少覆盖：

| 类别 | 说明 |
|------|------|
| 正常路径 | 标准输入 → 预期输出 |
| 空输入 / 缺省输入 | `null`、`undefined`、空字符串、空数组 |
| 非法输入 | 类型错误、格式错误、超长字符串 |
| 边界值 | 最小值、最大值、临界条件 |
| 错误分支 | 异常抛出、错误码返回 |

### 14.2 消息协议测试

适用对象：Panel → Extension、Extension → Report、Report → Extension

检查点：

- `type` 字段正确
- `payload` 结构完整
- 必填字段不缺失
- 错误消息能被 UI 正确消费

### 14.3 UI Smoke / 交互测试

适用对象：输入组件、切换组件、编辑/提交组件、流式展示组件

检查点：

- 点击、Enter、失焦触发是否正确
- loading / empty / ready / error / stale 五种状态是否可渲染
- 用户操作后是否发送正确消息

### 14.4 手动验收

以 `APP_FLOW.md` 中对应流程为准，至少验证：

- 主路径成功
- 失败路径可见
- 用户提示明确
- 不破坏相邻流程

### 14.5 测试用例模板

| 编号 | 层级 | 场景 | 前置条件 | 操作 | 预期结果 |
|------|------|------|----------|------|----------|
| TC-001 | unit | 正常输入 | mock 数据已准备 | 调用函数 | 返回结构正确 |
| TC-002 | unit | 空输入 | 无 | 调用函数 | 返回默认值或抛出预期错误 |
| TC-003 | ui | 点击提交 | 页面已加载 | 点击 Analyze | 发送正确消息 |
| TC-004 | e2e/manual | 主流程成功 | API Key 有效 | 输入需求并分析 | Report 正常展示 |
| TC-005 | error | 接口失败 | mock 401/429/网络错误 | 提交需求 | 显示对应错误并按策略处理 |

### 14.6 测试编号命名规范

| 前缀 | 含义 | 示例 |
|------|------|------|
| `UNIT-{Module}-{NNN}` | 单元测试 | `UNIT-Input-001` |
| `MSG-{Direction}-{NNN}` | 消息协议测试 | `MSG-Report-001` |
| `UI-{Component}-{NNN}` | UI 交互测试 | `UI-Panel-001` |
| `E2E-{Flow}-{NNN}` | 端到端测试 | `E2E-Requirement-001` |
| `ERR-{Module}-{NNN}` | 错误路径测试 | `ERR-AI-001` |

---

## 15. 各 Phase 测试要求

### 14.1 Phase 0 — 工程初始化

| 项目 | 要求 |
|------|------|
| 开发方式 | 主分支直接初始化 |
| 测试要求 | 构建成功（`npm run compile`）、插件能激活、空命令可执行 |

### 14.2 Phase 1 — 插件骨架

| 项目 | 要求 |
|------|------|
| 开发方式 | 建议独立 worktree |
| 手动验收 | 侧边栏显示、Report Tab 打开、消息双向通信 |
| 自动测试 | 消息协议类型级校验 |

### 14.3 Phase 2 — 输入层

| 项目 | 要求 |
|------|------|
| 开发方式 | 独立 worktree |
| 手动验收 | 三种输入模式切换、表单/对话/模板提交 |
| 自动测试 | InputService 单元测试（三种标准化路径） |
| UI Smoke | 模式切换、空输入拒绝 |

### 14.4 Phase 3 — AI 主管线 MVP

| 项目 | 要求 |
|------|------|
| 开发方式 | 独立 worktree |
| 手动验收 | API Key 配置引导、流式输出、结构化渲染、错误处理 |
| 自动测试 | StreamBuffer 单元测试、JSON 解析/修复测试（含对象 `{}` 和数组 `[]` 两种格式）、deriveOverview 测试 |
| Service 层 | AiAdapter mock 测试、AiPipelineService 阶段测试 |
| 消息协议 | 验证 ExtensionToPanel / ExtensionToReport 消息格式 |

### 14.5 Phase 4 — BOM + 采购

| 项目 | 要求 |
|------|------|
| 开发方式 | 独立 worktree |
| 手动验收 | BOM 表格渲染、CSV 导出、JLC 料号匹配 |
| 自动测试 | BOM prompt 解析测试、CSV 导出格式测试 |
| Service 层 | JlcAdapter mock 测试、ProcurementService 匹配逻辑测试 |

### 14.6 Phase 5 — 原理图 + PCB

| 项目 | 要求 |
|------|------|
| 开发方式 | 独立 worktree |
| 手动验收 | SchematicIntent 三种展示、Mermaid 框图、PCB 分区图 |
| 自动测试 | Prompt 解析测试、PinConnection 映射测试 |
| UI Smoke | Mermaid 渲染兼容性 |

### 14.7 Phase 6 — 规则引擎 + 设计审查

| 项目 | 要求 |
|------|------|
| 开发方式 | 独立 worktree |
| 手动验收 | 规则校验结果展示、stale 状态标记、Regenerate 局部重算 |
| 自动测试 | 每条规则（HR/WR/JR）至少 1 个正例 + 1 个反例 |
| Service 层 | RuleEngineService 单元测试、级联失效逻辑测试 |

### 14.8 Phase 7 — 本地存储 + 历史

| 项目 | 要求 |
|------|------|
| 开发方式 | 独立 worktree |
| 手动验收 | 保存/加载报告、版本列表、多方案对比 |
| 自动测试 | StorageService 读写测试、版本淘汰测试（>10 自动删除） |
| 集成测试 | 文件系统操作集成测试 |

### 14.9 Phase 8 — 代码分析输入

| 项目 | 要求 |
|------|------|
| 开发方式 | 独立 worktree |
| 手动验收 | 选择文件夹 → 检测 GPIO/库/外设 → 注入管线 |
| 自动测试 | C/C++/Python 分析器各 2+ 个测试用例 |
| Service 层 | CodeAnalysisService 单元测试 |
