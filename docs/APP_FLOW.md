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

### 2.8 历史版本浏览流程（Phase 7）

```text
用户在 Side Panel 项目列表
  → 选择历史项目
  → 选择方案 + 版本
  → Report Tab 加载历史报告
  → 可对比不同方案
```

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

- [ ] SchematicIntent 三种展示形式可切换
- [ ] Mermaid 框图正确渲染
- [ ] 引脚连接表数据完整
- [ ] PCBLayoutPlan 分区图渲染

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
