# AI EDA Copilot — 用户流程文档 (APP_FLOW)

> 版本：1.0
> 日期：2026-03-08
> 状态：草案

---

## 1. 文档目的

定义用户与系统交互的关键流程，以及每个流程的验收测试用例。

---

## 2. 核心用户流程

### 2.1 首次使用流程

```text
用户安装插件
  → 侧边栏出现 AI EDA Copilot 图标
  → 点击图标打开 Side Panel
  → 看到对话输入 + 模板选择器（空状态）
  → 输入需求描述或选择模板
  → 弹出 API Key 配置引导
  → 输入 API Key → 加密存储
  → AI 开始分析 → Panel 流式文本
  → 分析完成 → 自动打开 Report Tab
  → Overview + Requirements 结构化展示
```

### 2.2 自然语言输入流程

```text
用户在 Chat 模式输入描述
  → 点击发送 / Enter
  → submit_requirement 消息 → Extension Host
  → InputService.fromNaturalLanguage() → AnalysisRequest
  → AiPipelineService.runRequirementStage()
  → Panel 看到流式 AI 思考过程
  → Report Tab 展示结构化 RequirementSpec + Overview
```

### 2.3 表单输入流程

```text
用户切换到 Form 模式
  → 填写核心字段（MCU / 电源 / 通信 / 显示 / 传感器）
  → 可选展开扩展字段
  → 点击 Analyze
  → submit_requirement (mode=form) → Extension Host
  → InputService.fromForm() → AnalysisRequest
  → AI 分析 → 结果同自然语言流程
```

### 2.4 模板选择流程

```text
用户在空状态页面看到模板网格
  → 点击模板卡片（如 ESP32 传感器）
  → 预填表单字段 + 切换到 Form 模式
  → 用户可修改预填数据
  → 点击 Analyze → 后续同表单流程
```

### 2.5 需求编辑 + 重新生成流程

```text
用户在 Report Tab Requirements 板块
  → 点击字段值进入编辑模式
  → 修改值 → 失焦或 Enter 提交
  → requirement_edit 消息 → Extension Host
  → 相关下游 Artifact 标记 stale（Phase 6 实现）
  → 用户点击 Regenerate → 局部或全部重算
```

### 2.6 报告导出流程

```text
用户在 Report Tab 底部
  → 点击 Export Markdown / JSON / CSV
  → export_request 消息 → Extension Host
  → 生成文件 → 保存到 exports/ 目录（Phase 7 实现）
```

### 2.7 BOM + 采购流程（Phase 4）

```text
RequirementSpec 确认
  → AI 生成 BOMItem[]
  → BOM 表格渲染（5 默认列 + 行展开）
  → JlcAdapter 匹配料号 + 查询库存
  → Procurement 板块展示兼容性状态
  → 用户可点击立创商城链接查看详情
  → CSV 导出 → 可直接导入嘉立创 SMT 下单页
```

### 2.8 原理图 + PCB 布局流程（Phase 5）

```text
BOM + 采购匹配完成
  → 自动串联 runSchematicStage()
  → Panel 流式文本（AI 思考原理图连接）
  → AI 输出 SchematicIntent JSON → 解析
  → schematic_data 消息 → Report Tab
  → Schematic Tab 渲染三种视图：
    ├── 文字描述：模块卡片 + 网络分类 + 连接列表
    ├── 模块框图：Mermaid flowchart 源码展示
    └── 引脚连接表：全引脚列表 + 方向过滤器
  → 用户可在三种视图间切换

原理图完成
  → 自动串联 runPcbLayoutStage()
  → Panel 流式文本（AI 规划 PCB 布局）
  → AI 输出 PCBLayoutPlan JSON → 解析
  → pcb_layout_data 消息 → Report Tab
  → PCB Layout Tab 渲染：
    ├── 板级参数卡片：尺寸 + 层数 + source/status 标注
    ├── 功能分区图：CSS Grid 3×3 色彩分区 + 元件标签
    ├── 分区详情：名称 + 位置 + 用途
    ├── 布局约束卡片：类型色彩编码 + 影响元件列表
    ├── 走线指南：网络名 + 类别 + 严重度
    └── 元件布局表：designator / zone / priority / notes
  → 全管线完成提示
```

> **用户无需手动触发**：schematic 和 pcb_layout 阶段在 BOM 完成后自动串联执行。
> **AI 推断标注**：boardSize / layerCount 若为 AI 推断，显示 "AI 推断" + "待确认" 标记，提醒用户不可直接用于制造。

### 2.9 历史版本浏览流程（Phase 7）

```text
用户在 Side Panel 项目列表
  → 选择历史项目
  → 选择方案 + 版本
  → Report Tab 加载历史报告
  → 可对比不同方案
```

### 2.10 新需求验收流程（开发侧）

```text
开发者完成一个 Phase / Feature
  → 检查 Worktree 分支是否干净（无遗留 TODO / FIXME）
  → 运行编译检查（npm run compile）
  → 执行手动验收清单（见 §3.3 对应 Phase）
  → 补充 / 更新 progress.txt
  → 检查文档同步（类型 ↔ BACKEND_STRUCTURE / prompt ↔ 文档）
  → 提交 PR / 合并到主分支
  → .vsix 打包验证
```

**验收通过标准：**

| 维度 | 要求 |
|------|------|
| 编译 | `tsc` 零错误，`esbuild` 三入口成功 |
| 打包 | `.vsix` 文件大小合理，无遗漏资源 |
| 功能 | 对应 Phase 手动验收清单全部通过 |
| 文档 | progress.txt 已更新，受影响文档已同步 |
| 代码 | 无 `console.log` 残留（调试用 outputChannel），无硬编码密钥 |

---

## 3. 关键用户流程测试用例

### 3.1 端到端主流程

| 测试编号 | 流程 | 操作 | 预期结果 |
|----------|------|------|----------|
| E2E-001 | 首次使用 | 安装 → 输入描述 → 配置 API Key → 分析 | Report Tab 展示 Overview + Requirements |
| E2E-002 | 自然语言输入 | Chat 模式输入 → 分析 | Panel 流式文本 + Report 结构化数据 |
| E2E-003 | 表单输入 | Form 模式填写 → Analyze | 同 E2E-002 |
| E2E-004 | 模板输入 | 选择模板 → 修改 → Analyze | 预填数据正确 + 分析结果合理 |
| E2E-005 | 需求编辑 | Report Requirements → 编辑字段 → 提交 | requirement_edit 消息发送成功 |

### 3.2 错误处理流程

| 测试编号 | 场景 | 操作 | 预期结果 |
|----------|------|------|----------|
| ERR-001 | 无 API Key | 提交需求 | 弹出配置引导，取消后显示 AUTH_ERROR |
| ERR-002 | 错误 API Key | 提交需求 | 显示 AUTH_ERROR，不重试 |
| ERR-003 | 网络断开 | 提交需求 | 自动重试 + 显示重试进度 |
| ERR-004 | 速率限制 | 连续提交 | 429 触发重试，显示等待倒计时 |
| ERR-005 | 并发提交 | 快速连续提交 | 第二次提交被拒绝，提示"已有任务运行中" |
| ERR-006 | JSON 解析失败 | AI 输出非法 JSON | 尝试修复，失败后显示 PARSE_ERROR |

### 3.4 需求开发验收用例

每个 Phase / Feature 合并前，开发者必须逐项检查：

| 用例编号 | 验收维度 | 检查项 | 通过标准 |
|----------|----------|--------|----------|
| DEV-001 | 编译完整性 | `npm run compile` 零错误 | tsc + esbuild 三入口全部成功 |
| DEV-002 | 打包完整性 | `npx @vscode/vsce package --no-dependencies` | .vsix 生成，大小合理 |
| DEV-003 | 文档同步 | progress.txt + 受影响文档已更新 | 无遗漏变更记录 |
| DEV-004 | 代码卫生 | 无调试残留 / 无硬编码密钥 / 无未使用 import | 代码审查清单全部通过 |
| DEV-005 | 功能验收 | 对应 Phase 手动验收清单（§3.3） | 全部勾选通过 |

### 3.3 手动验收检查清单

每个 Phase 完成后必须通过的手动验收：

#### Phase 1 验收

- [ ] 侧边栏出现 AI EDA Copilot 图标
- [ ] 点击图标显示 Side Panel
- [ ] 命令面板执行 `AI EDA: Open Report` 打开 Report Tab
- [ ] Side Panel → Extension Host → Report Tab 消息通信正常
- [ ] 切换 VS Code 主题时 Webview 样式跟随

#### Phase 2 验收

- [ ] Chat / Form 模式切换正常
- [ ] 对话输入 → 回显消息
- [ ] 表单填写 → 核心 + 扩展字段可用
- [ ] 模板选择 → 预填表单 + 切换到 Form 模式
- [ ] 空输入提交被拒绝

#### Phase 3 验收

- [ ] 首次无 API Key → 弹出配置引导 → 输入后管线继续
- [ ] 自然语言/表单/模板输入 → Panel 流式文本 → Report 结构化渲染
- [ ] Overview tab 展示摘要/模块/风险/开放问题
- [ ] Requirements tab 展示字段 + source/status/confidence 标注 + 可编辑
- [ ] 错误 API Key → 显示 AUTH_ERROR，不重试
- [ ] 其余 4 tab 显示占位文字
- [ ] `aiEda.configureApiKey` 命令可配置/清除 API Key

#### Phase 4 验收

- [ ] BOM 表格 5 默认列 + 行展开详情
- [ ] JLC 料号匹配（有匹配 / 无匹配 / 降级）
- [ ] CSV 导出文件可导入嘉立创 SMT 页
- [ ] Procurement 板块显示兼容性状态

#### Phase 5 验收

- [ ] BOM 完成后自动串联 schematic → pcb_layout，无需手动触发
- [ ] SchematicIntent 三种展示形式可切换（文字描述 / 模块框图 / 引脚连接表）
- [ ] 摘要统计正确（模块数 / 连接数 / 引脚数 / 网络数）
- [ ] 文字描述视图：模块卡片 + 网络分类色彩标签 + 连接列表 from→to 格式
- [ ] Mermaid 框图：显示 flowchart 源码（MVP），内容非空
- [ ] 引脚连接表：方向过滤器（all/input/output/bidirectional/power）+ 计数正确
- [ ] PCBLayoutPlan 板参数卡片：尺寸 / 层数 + source / status 标注
- [ ] AI 推断参数显示 "AI 推断" + "待确认" 标记
- [ ] 分区图 CSS Grid 色彩渲染 + 元件标签
- [ ] 约束卡片按类型色彩编码（keep_out / placement / routing / thermal / clearance）
- [ ] 走线指南按 category + severity 标注
- [ ] 元件布局表 designator / zone / priority / notes 四列完整

#### Phase 6 验收

- [ ] 硬规则校验触发 critical
- [ ] 警告规则触发 warning
- [ ] JLC 规则触发 info
- [ ] 修改 Requirements 后显示 stale 标记
- [ ] Regenerate 可选全部/局部重算

#### Phase 7 验收

- [ ] 报告自动保存到 `.ai-eda/`
- [ ] 重新打开 VS Code 可加载历史
- [ ] 版本列表最多 10 个
- [ ] 导出 Markdown / JSON / CSV

#### Phase 8 验收

- [ ] 选择代码文件夹 → 检测 GPIO/库/外设
- [ ] 模糊引用向用户提问
- [ ] 代码上下文注入管线
