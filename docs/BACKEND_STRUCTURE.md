# AI EDA Copilot — 本地业务逻辑与数据架构文档 (BACKEND_STRUCTURE)

> 版本：1.0
> 日期：2026-03-07
> 状态：已锁定

---

## 1. 文档目的

本文档**不是**传统的后端服务架构文档。

AI EDA Copilot V1 是无后端、纯本地的 VS Code 插件，没有自建后端服务、没有数据库、没有用户认证。

本文档定义的是 V1 阶段的：

- 本地业务逻辑分层结构
- 核心数据模型（Artifact Schema）
- AI 编排流程与管线依赖
- 规则校验层结构
- 外部 API 集成边界
- 本地持久化 JSON Schema
- 局部重算依赖图

---

## 2. V1 范围与边界

### 2.1 V1 有什么

| 能力 | 实现方式 |
|------|----------|
| 数据持久化 | 本地 JSON 文件（`.ai-eda/`） |
| AI 推理 | 通过中转站调用 Claude API |
| 库存查询 | JLCPCB 官方 API + jlcsearch 备选 |
| 规则校验 | 本地规则引擎（内置规则库） |
| 业务逻辑 | Extension Host 内的 Service 层 |

### 2.2 V1 没有什么

| 能力 | 状态 |
|------|------|
| 自建后端服务 | 无 |
| 数据库（PostgreSQL / SQLite / MongoDB） | 无 |
| 用户认证 / 账号体系 | 无 |
| 云端数据同步 | 无 |
| REST API 路由 | 无 |

---

## 3. 逻辑分层

### 3.1 分层架构图

```text
┌─────────────────────────────────────────────────┐
│              Input Normalization                 │
│  自然语言解析 / 代码分析 / 表单数据 / 模板预填    │
├─────────────────────────────────────────────────┤
│              AI Orchestration                    │
│  管线编排 / 分阶段调用 / 流式输出管理             │
├─────────────────────────────────────────────────┤
│              Artifact Generation                 │
│  结构化产物生成 / Schema 校验 / 置信度标注        │
├─────────────────────────────────────────────────┤
│              Rule Validation                     │
│  设计审查 / 硬规则 / 警告规则 / JLC 兼容性        │
├─────────────────────────────────────────────────┤
│              Procurement Mapping                 │
│  料号匹配 / 库存查询 / 替代件推荐 / 链接生成      │
├─────────────────────────────────────────────────┤
│              Report Assembly                     │
│  报告组装 / 板块拼接 / 流式推送 / 版本生成        │
├─────────────────────────────────────────────────┤
│              Persistence                         │
│  本地 JSON 读写 / 版本管理 / 对话历史 / 导出      │
└─────────────────────────────────────────────────┘
```

### 3.2 各层职责

| 层级 | 职责 | 对应 Service |
|------|------|-------------|
| Input Normalization | 将不同形式的用户输入统一为标准化的 `AnalysisRequest` | `InputService` |
| AI Orchestration | 按管线顺序调用 AI，管理流式输出和阶段状态 | `AiPipelineService` |
| Artifact Generation | 将 AI 原始输出解析为强类型的 Artifact 对象 | `ArtifactParser`（内置于 Pipeline） |
| Rule Validation | 对生成的 Artifact 执行规则校验，输出审查结果 | `RuleEngineService` |
| Procurement Mapping | 查询 JLCPCB API，匹配料号，生成采购链接 | `ProcurementService` |
| Report Assembly | 将各阶段 Artifact 组装为完整报告 | `ReportAssembler`（内置于 Pipeline） |
| Persistence | 本地文件读写、版本管理、导出 | `StorageService` |

### 3.3 调用关系

```text
InputService
  │
  ▼
AiPipelineService ──────► RuleEngineService
  │                              │
  ├── stage: requirement         │ 校验每个阶段的输出
  ├── stage: bom ───────────────►│
  ├── stage: schematic ─────────►│
  ├── stage: pcb_layout ────────►│
  ├── stage: procurement         │
  │       │                      │
  │       ▼                      │
  │  ProcurementService          │
  │  （JLCPCB API 查询）          │
  │                              │
  ▼                              ▼
ReportAssembler ◄──── DesignReviewFindings
  │
  ▼
StorageService（持久化报告 + 版本管理）
```

---

## 4. 核心 Artifact Schema

### 4.1 命名约定

两套名字用途不同，不可混用：

| 场景 | 标识 | 值 |
|------|------|-----|
| UI Section 名（报告板块） | `ReportSection` | `overview` \| `requirements` \| `bom` \| `schematic_intent` \| `pcb_layout` \| `procurement` |
| Pipeline Stage 名（管线阶段） | `PipelineStage` | `requirement` \| `bom` \| `schematic` \| `pcb_layout` \| `procurement` \| `design_review` |

### 4.2 RequirementSpec

```typescript
interface RequirementSpec {
  // 元数据
  projectName: string;
  createdAt: string;                    // ISO 8601
  source: 'natural_language' | 'code_analysis' | 'template' | 'form';

  // 核心需求（优先展示）
  // 字段始终存在，value 为 null 表示尚未填写/推断
  mcu: RequirementField<string | null>;
  power: RequirementField<string | null>;
  communication: RequirementField<string[] | null>;
  display: RequirementField<string | null>;
  sensors: RequirementField<string[] | null>;

  // 扩展需求（折叠展示）
  costRange: RequirementField<string | null>;
  sizeLimit: RequirementField<string | null>;
  productionIntent: RequirementField<'prototype' | 'small_batch' | 'mass' | null>;
  powerConsumption: RequirementField<string | null>;
  precision: RequirementField<string | null>;

  // 原始输入
  rawInput: string;
  codeContext?: CodeAnalysisResult;

  // 开放问题
  openQuestions: OpenQuestion[];
}

// 空值约定：当 value === null 且字段尚未被 AI 推断时，
// source 统一置为 'ai_inferred'，status 置为 'pending_confirmation'，confidence 置为 0。
// 一旦 AI 给出推断值，按实际置信度更新各字段。
interface RequirementField<T> {
  value: T;
  source: 'user_provided' | 'ai_inferred';          // 来源维度
  status: 'confirmed' | 'pending_confirmation';      // 状态维度
  confidence: number;                                 // 0.0 ~ 1.0
  note?: string;
}

interface OpenQuestion {
  question: string;
  context: string;
  priority: 'critical' | 'important' | 'optional';
  resolved: boolean;
  answer?: string;
}

interface CodeAnalysisResult {
  language: 'c' | 'cpp' | 'python';
  detectedGpios: GpioUsage[];
  detectedLibraries: string[];
  detectedPeripherals: string[];
  ambiguousReferences: AmbiguousRef[];
}

interface GpioUsage {
  pin: string;
  direction: 'input' | 'output' | 'unknown';
  usage: string;
}

interface AmbiguousRef {
  reference: string;
  possibleMeanings: string[];
  question: string;
}
```

### 4.3 BOMItem

```typescript
interface BOMItem {
  // 核心必填字段（对齐嘉立创 BOM 规范）
  designator: string;                  // 位号，不可重复；多位号分隔符仅允许英文逗号或空格
  comment: string;                     // 型号/规格
  footprint: string;                   // 封装，不可为空
  quantity: number;                    // >= 1，若 designator 为聚合表示则必须与位号数量一致

  // JLC 集成
  jlcPartNumber?: string;
  jlcProductUrl?: string;
  jlcStock?: number;
  jlcPrice?: number;

  // 扩展详情
  description?: string;
  category: string;
  manufacturer?: string;
  mpn?: string;
  subsystem: string;

  // AI 标注
  source: 'user_provided' | 'ai_inferred';
  status: 'confirmed' | 'pending_confirmation' | 'rejected';
  confidence: number;
  reasoning?: string;

  // 替代件
  alternatives: AlternativePart[];

  // 规则校验结果
  validationFindings: ValidationFinding[];
}

interface AlternativePart {
  comment: string;
  footprint: string;
  jlcPartNumber?: string;
  jlcProductUrl?: string;
  reason: string;
  rank: number;
}

interface ValidationFinding {
  ruleId: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  suggestion?: string;
}
```

### 4.4 SchematicIntent

> `SchematicIntent` 是结构化底层数据模型。Webview 展示层从它派生出三种用户可读形式：**文字描述**（从 `connections` + `pinTable` 生成）、**模块级框图**（从 `modules` 的 `mermaidBlock` 渲染）、**引脚连接表**（直接映射 `pinTable`）。展示逻辑不应写回此 Schema。

```typescript
interface SchematicIntent {
  modules: SchematicModule[];
  connections: ConnectionSpec[];
  networks: NetworkCategory[];
  pinTable: PinConnection[];
}

interface SchematicModule {
  id: string;
  name: string;
  description: string;
  components: string[];
  mermaidBlock?: string;
}

interface ConnectionSpec {
  from: PinRef;
  to: PinRef;
  netName: string;
  networkType: 'power' | 'communication' | 'control' | 'analog';
  notes?: string;
}

interface PinRef {
  designator: string;
  pin: string;
}

interface NetworkCategory {
  type: 'power' | 'communication' | 'control' | 'analog';
  nets: string[];
  description: string;
}

interface PinConnection {
  designator: string;
  pin: string;
  netName: string;
  direction: 'input' | 'output' | 'bidirectional' | 'power';
  description: string;
}
```

### 4.5 PCBLayoutPlan

```typescript
interface PCBLayoutPlan {
  // 板子尺寸：若用户未提供，AI 仅给出"建议尺寸"，不可视为制造尺寸。
  // AI 推断时 status 默认为 'pending_confirmation'。
  boardSize: {
    width: number;                     // mm
    height: number;
    source: 'user_provided' | 'ai_inferred';
    status: 'confirmed' | 'pending_confirmation';
    confidence: number;
  };
  layerCount: {
    value: number;
    source: 'user_provided' | 'ai_inferred';
    status: 'confirmed' | 'pending_confirmation';
    confidence: number;
    reasoning: string;
  };
  zones: LayoutZone[];
  placements: ComponentPlacement[];
  routingGuidelines: RoutingGuideline[];
  constraints: LayoutConstraint[];
}

interface LayoutZone {
  id: string;
  name: string;
  purpose: string;
  relativePosition: string;
  components: string[];
  color?: string;
}

interface ComponentPlacement {
  designator: string;
  zone: string;
  placementNotes: string;
  priority: 'critical' | 'important' | 'flexible';
}

interface RoutingGuideline {
  netName: string;
  guideline: string;
  category: 'power' | 'signal' | 'differential' | 'analog';
  severity: 'mandatory' | 'recommended';
}

interface LayoutConstraint {
  type: 'keep_out' | 'placement' | 'routing' | 'thermal' | 'clearance';
  description: string;
  affectedComponents: string[];
  reference?: string;
}
```

### 4.6 ProcurementItem

```typescript
interface ProcurementItem {
  designator: string;
  comment: string;
  footprint: string;

  jlcCompatibility: 'compatible' | 'partial' | 'incompatible' | 'unknown';
  matchType: 'exact' | 'footprint_compatible' | 'functionally_similar' | 'unknown';
  jlcPartNumber?: string;
  jlcProductUrl?: string;
  jlcStock?: number;
  jlcPrice?: number;
  jlcStockQueryTime?: string;

  smtReadiness: 'ready' | 'missing_footprint' | 'missing_part' | 'manual_only';
  smtIssues: string[];

  alternatives: ProcurementAlternative[];
  recommendation: string;
}

interface ProcurementAlternative {
  jlcPartNumber: string;
  jlcProductUrl: string;
  comment: string;
  footprint: string;
  reason: string;
  rank: number;
}
```

### 4.7 DesignReviewFinding

```typescript
interface DesignReviewFinding {
  id: string;
  category: 'power_ripple' | 'signal_integrity' | 'thermal' | 'footprint_match'
           | 'clearance' | 'layout' | 'general';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  affectedComponents: string[];
  suggestion: string;
  stage: 'bom' | 'schematic' | 'pcb_layout' | 'cross_stage';  // 问题所属阶段，支持 UI 按阶段筛选
  ruleSource: 'jlc_design_rule' | 'general_pcb_standard' | 'ai_analysis';
  confidence: number;
}
```

---

## 5. 字段规则总结

### 5.1 各 Artifact 字段分类

| Artifact | 必填字段 | AI 可推断字段 | 必须人工确认字段 |
|----------|----------|-------------|----------------|
| RequirementSpec | `projectName`, `rawInput` | `mcu`, `power`, `communication`, `display`, `sensors`, 所有扩展需求 | `openQuestions` 中 `critical` 级别的问题 |
| BOMItem | `designator`, `comment`, `footprint`, `quantity` | `category`, `manufacturer`, `mpn`, `alternatives`, `subsystem` | `jlcPartNumber`（当置信度 < 0.8） |
| SchematicIntent | `modules`, `connections` | `networks`, `pinTable`, `mermaidBlock` | 电源网络连接、高速信号连接 |
| PCBLayoutPlan | `zones` | `boardSize`, `layerCount`, `placements`, `routingGuidelines` | `constraints` 中 `critical` 级别的约束 |
| ProcurementItem | `designator`, `comment`, `footprint` | `jlcPartNumber`, `alternatives`, `recommendation` | 无精确匹配时的替代件选择 |
| DesignReviewFinding | `category`, `severity`, `title` | `description`, `suggestion` | `critical` 级别的审查发现 |

### 5.2 置信度规则

| 置信度范围 | 含义 | 处理方式 |
|-----------|------|----------|
| 0.9 ~ 1.0 | 高置信度 | `source: 'ai_inferred'`, `status: 'confirmed'` |
| 0.7 ~ 0.89 | 中置信度 | `source: 'ai_inferred'`, `status: 'pending_confirmation'` |
| 0.0 ~ 0.69 | 低置信度 | `source: 'ai_inferred'`, `status: 'pending_confirmation'`，并生成 `OpenQuestion` |

---

## 6. Pipeline 依赖图

### 6.1 完整管线依赖

```text
                    ┌─────────────────┐
                    │ RequirementSpec │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │    BOMItem[]    │
                    └──┬──────────┬──┘
                       │          │
          ┌────────────▼──┐  ┌───▼──────────────┐
          │SchematicIntent│  │ ProcurementItem[] │
          └────────┬──────┘  │  （可与 schematic  │
                   │         │   并行执行）       │
          ┌────────▼────────┐└──────────────────┘
          │  PCBLayoutPlan  │
          └────────┬────────┘
                   │
          ┌────────▼──────────────┐
          │ DesignReviewFinding[] │
          │ （校验所有上游产物）     │
          └───────────────────────┘
```

### 6.2 依赖关系明细

| 阶段 | 输入依赖 | 输出 |
|------|----------|------|
| requirement | 用户原始输入 | `RequirementSpec` |
| bom | `RequirementSpec` | `BOMItem[]` |
| schematic | `RequirementSpec` + `BOMItem[]` | `SchematicIntent` |
| pcb_layout | `RequirementSpec` + `BOMItem[]` + `SchematicIntent` | `PCBLayoutPlan` |
| procurement | `BOMItem[]` | `ProcurementItem[]` |
| design_review | 全部上游 Artifact | `DesignReviewFinding[]` |

### 6.3 并行优化

`procurement` 仅依赖 `BOMItem[]`，可与 `schematic` 阶段并行执行：

```text
bom 完成后:
  ├── schematic   （串行，依赖 bom）
  └── procurement （并行，仅依赖 bom）
```

---

## 7. 局部重算规则

### 7.1 重算触发

用户修改 Requirements 后手动点击 Regenerate，可选择：

| 操作 | 触发方式 |
|------|----------|
| 整份报告重新生成 | 默认选项 |
| 仅重算指定模块 | 用户手动选择 |

### 7.2 重算级联失效

```text
修改 RequirementSpec
  → 失效: BOM, Schematic, PCBLayout, Procurement, DesignReview
  → 需要: 全部重算

仅重算 BOM
  → 失效: Schematic, PCBLayout, Procurement, DesignReview
  → 保留: RequirementSpec

仅重算 Schematic
  → 失效: PCBLayout, DesignReview
  → 保留: RequirementSpec, BOM, Procurement

仅重算 PCBLayout
  → 失效: DesignReview
  → 保留: RequirementSpec, BOM, Schematic, Procurement

仅重算 Procurement
  → 失效: 无（末端节点）
  → 保留: 其他全部

仅重算 DesignReview
  → 失效: 无（末端节点）
  → 保留: 其他全部
```

> **V1 保守策略说明**：V1 为简化实现，修改 RequirementSpec 时采用保守失效策略（全部下游失效）。实际上，仅修改非全局字段（如 `costRange`、`productionIntent`、`reportLanguage`）时，`SchematicIntent` 等可能不必失效。后续版本可根据字段粒度优化失效传播。

### 7.3 失效状态管理

```typescript
type ArtifactStatus = 'valid' | 'stale' | 'generating' | 'error';

interface ArtifactState {
  requirement: ArtifactStatus;
  bom: ArtifactStatus;
  schematic: ArtifactStatus;
  pcbLayout: ArtifactStatus;
  procurement: ArtifactStatus;
  designReview: ArtifactStatus;
}
```

UI 中 `stale` 状态的板块应显示"内容已过期，请重新生成"提示。

---

## 8. 规则引擎结构

### 8.1 引擎架构

```text
┌──────────────────────────────┐
│       RuleEngineService      │
├──────────────────────────────┤
│  ┌────────────────────────┐  │
│  │  Hard Rules            │  │  ← 必须通过，否则标记 critical
│  ├────────────────────────┤  │
│  │  Warning Rules         │  │  ← 建议遵守，标记 warning
│  ├────────────────────────┤  │
│  │  JLC Compatibility     │  │  ← 嘉立创特定校验
│  ├────────────────────────┤  │
│  │  Design Review Rules   │  │  ← 深层设计审查（AI + 规则）
│  └────────────────────────┘  │
└──────────────────────────────┘
```

### 8.2 规则分类

#### 硬规则（Hard Rules）— severity: `critical`

| 规则 ID | 描述 |
|---------|------|
| `HR-001` | 封装字段不可为空 |
| `HR-002` | 位号不可重复 |
| `HR-003` | 电源引脚必须有去耦电容 |
| `HR-004` | MCU 复位引脚必须有正确的复位电路 |
| `HR-005` | 晶振负载电容必须匹配 |
| `HR-006` | 电源走线宽度不低于安全阈值 |

#### 警告规则（Warning Rules）— severity: `warning`

| 规则 ID | 描述 |
|---------|------|
| `WR-001` | 去耦电容应就近放置于电源引脚 |
| `WR-002` | 高速信号走线建议等长匹配 |
| `WR-003` | 天线区域应保持净空 |
| `WR-004` | 大功率器件建议增加散热过孔 |
| `WR-005` | 差分对建议保持间距一致 |
| `WR-006` | 板边不建议放置精密模拟器件 |

#### JLC 兼容性规则 — severity: `warning` / `info`

| 规则 ID | 描述 |
|---------|------|
| `JR-001` | 封装是否在嘉立创封装库中 |
| `JR-002` | 器件是否有嘉立创料号 |
| `JR-003` | 器件库存是否充足 |
| `JR-004` | 安全间距是否满足嘉立创工艺能力 |
| `JR-005` | 最小线宽/线距是否满足嘉立创工艺 |

#### 设计审查规则 — severity: 动态（AI + 规则双引擎）

| 审查类别 | 描述 |
|----------|------|
| 电源纹波 | LDO/DC-DC 输出纹波评估、去耦方案充分性 |
| 信号完整性 | 反射、串扰、阻抗不连续性 |
| 热设计 | 散热路径合理性、功耗密度评估 |
| 封装匹配 | 数据手册封装与 BOM 封装一致性 |
| 功能完整性 | 缺少必要的保护电路（ESD、TVS、反接保护） |

### 8.3 规则引擎接口

```typescript
interface RuleEngineService {
  validateBom(bom: BOMItem[], reqSpec: RequirementSpec): ValidationResult;
  validateSchematic(schematic: SchematicIntent, bom: BOMItem[]): ValidationResult;
  validatePcbLayout(layout: PCBLayoutPlan, schematic: SchematicIntent): ValidationResult;
  validateProcurement(items: ProcurementItem[]): ValidationResult;

  runDesignReview(
    reqSpec: RequirementSpec,
    bom: BOMItem[],
    schematic: SchematicIntent,
    layout: PCBLayoutPlan
  ): Promise<DesignReviewFinding[]>;

  listRules(): Rule[];
  getRulesByCategory(category: string): Rule[];
}

interface ValidationResult {
  isValid: boolean;
  findings: ValidationFinding[];
  criticalCount: number;
  warningCount: number;
  infoCount: number;
}

interface Rule {
  id: string;                          // 如 'HR-001', 'WR-003', 'JR-002'
  category: 'hard' | 'warning' | 'jlc_compatibility' | 'design_review';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  appliesTo: ('bom' | 'schematic' | 'pcb_layout' | 'procurement')[];
  enabled: boolean;                    // V1 全部默认 true，预留开关
}
```

---

## 9. 本地持久化 Schema

### 9.1 完整文件结构

```text
{workspace}/
└─ .ai-eda/
   ├─ index.json
   └─ {项目名}/
      ├─ config.json
      ├─ schemes/
      │  └─ {scheme-id}/
      │     ├─ report-v1.json
      │     ├─ report-v2.json
      │     └─ ...
      ├─ conversations/
      │  └─ {conversation-id}.json
      └─ exports/
         └─ {项目名}_{时间戳}_{类型}.{ext}
```

### 9.2 index.json

```typescript
interface ProjectIndex {
  version: 1;
  projects: ProjectIndexEntry[];
}

interface ProjectIndexEntry {
  projectId: string;
  projectName: string;
  createdAt: string;
  lastOpenedAt: string;
  path: string;
}
```

### 9.3 config.json

```typescript
interface ProjectConfig {
  version: 1;
  projectId: string;
  projectName: string;
  createdAt: string;
  lastOpenedAt: string;
  currentSchemeId: string;
  currentVersion: number;
  reportLanguage: 'zh' | 'en';
  schemes: SchemeMeta[];
}

interface SchemeMeta {
  schemeId: string;
  schemeName: string;
  createdAt: string;
  lastModifiedAt: string;
  versionCount: number;
}
```

### 9.4 report-v{n}.json

```typescript
interface ReportFile {
  version: 1;
  reportVersion: number;
  createdAt: string;
  generationDurationMs: number;

  // 轻量概览快照（供历史列表页快速渲染，无需遍历完整报告）
  overviewSnapshot: {
    projectSummary: string;
    readiness: string;
    bomItemCount: number;
    riskCount: number;
    openQuestionCount: number;
    criticalFindingCount: number;
  };

  // 各阶段 Artifact
  requirementSpec: RequirementSpec;
  bom: BOMItem[];
  schematicIntent: SchematicIntent;
  pcbLayoutPlan: PCBLayoutPlan;
  procurement: ProcurementItem[];
  designReview: DesignReviewFinding[];

  artifactState: ArtifactState;
  modelConfig: PipelineModelConfig;
  disclaimer: string;
}
```

### 9.5 conversation.json

```typescript
interface ConversationFile {
  version: 1;
  conversationId: string;
  projectId: string;
  associatedSchemeId?: string;
  associatedReportVersion?: number;
  createdAt: string;
  messages: ConversationMessage[];
}

interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  metadata?: {
    stage?: PipelineStage;
    isQuestion?: boolean;
  };
}
```

---

## 10. 外部 API 适配层

### 10.1 适配器架构

所有外部 API 调用通过 Adapter 封装，业务逻辑层不直接调用外部接口：

```text
┌───────────────────┐
│  Service 层       │
├───────────────────┤
│  Adapter 层       │
├───────┬───────────┤
│ AiAdapter │ JlcAdapter │
│           │            │
▼           ▼            │
AI 中转站    JLCPCB API   │
            jlcsearch ◄──┘ (fallback)
```

### 10.2 AiAdapter

```typescript
interface AiAdapter {
  complete(params: AiCompletionParams): Promise<AiCompletionResult>;
  stream(params: AiCompletionParams): AsyncIterable<AiStreamChunk>;
  healthCheck(): Promise<boolean>;
}

interface AiCompletionParams {
  model: string;
  messages: AiMessage[];
  temperature?: number;
  maxTokens?: number;
}

interface AiStreamChunk {
  content: string;
  finishReason?: 'stop' | 'length' | 'error';
}
```

当前实现基于 `openai` SDK + 用户配置的 Base URL。若中转站协议变更，仅需替换 `AiAdapter` 实现。

### 10.3 JlcAdapter

```typescript
interface JlcAdapter {
  getPartByNumber(partNumber: string): Promise<JlcPart | null>;
  searchParts(query: string, category?: string): Promise<JlcPart[]>;
  checkStock(partNumbers: string[]): Promise<Map<string, JlcStockInfo>>;
  getProductUrl(partNumber: string): string;
}

interface JlcPart {
  partNumber: string;
  comment: string;
  footprint: string;
  manufacturer: string;
  mpn: string;
  category: string;
  stock: number;
  price: number;
  productUrl: string;
}

interface JlcStockInfo {
  partNumber: string;
  stock: number;
  price: number;
  queryTime: string;
}
```

### 10.4 Fallback 策略

```text
1. 首选: JLCPCB 官方 API (api.jlcpcb.com)
2. 降级: jlcsearch API (社区备选)
3. 兜底: 标记为"库存未知"，不阻断报告生成
```

降级时报告中标注"库存数据来源：备选接口，可能不完全准确"。

---

## 11. 未来演进方向

> 以下内容仅为方向性规划，不构成 V1 实现承诺。

### 11.1 后端服务化

- 引入 Node.js / Go 后端服务
- 提供 REST API 或 GraphQL 接口
- 实现服务端 AI 调用（平台提供 API Key）

### 11.2 数据库引入

- 候选：PostgreSQL（结构化数据）+ Redis（缓存）
- 本地 JSON 文件可作为离线 fallback 保留

### 11.3 用户账号体系

- 用户注册/登录
- 项目云端同步
- 付费订阅管理

### 11.4 云端同步

- 本地优先、云端同步架构
- 冲突解决策略
- 离线可用性保证

---

## 12. 测试对象与可测边界

### 12.1 核心 Artifact 测试

| 测试对象 | 测试类型 | 必须覆盖 |
|----------|----------|----------|
| RequirementSpec parser | Schema 测试 | 完整 JSON 解析、缺失字段兜底、尾逗号修复、fenced block 提取 |
| BOMItem 完整性 | 字段校验 | designator 非空/不重复、footprint 非空、quantity >= 1 |
| SchematicIntent 连接 | 逻辑校验 | PinRef 引用有效性、网络分类正确性 |
| PCBLayoutPlan 约束 | 逻辑校验 | zone 引用组件存在于 BOM、constraint 类型合法 |
| ProcurementItem 映射 | 匹配校验 | jlcCompatibility 枚举合法、matchType 与料号对应 |
| DesignReviewFinding | 分类校验 | severity 枚举合法、affectedComponents 引用有效 |

### 12.2 Pipeline 依赖图测试

| 测试用例 | 输入 | 期望行为 |
|----------|------|----------|
| 正常顺序执行 | RequirementSpec → BOM → ... | 每阶段接收上游产物 |
| 修改 RequirementSpec | 触发重算 | 全部下游标记 stale |
| 仅重算 BOM | 触发重算 | Schematic/PCBLayout/Procurement/DesignReview stale |
| 仅重算 Procurement | 触发重算 | 无级联（末端节点） |

### 12.3 规则引擎测试要求

每条规则至少 1 个正例（触发）+ 1 个反例（通过）：

| 规则类别 | 示例测试用例 |
|----------|-------------|
| HR-001 封装非空 | 空封装 → critical / 有封装 → pass |
| HR-002 位号唯一 | 重复位号 → critical / 唯一位号 → pass |
| WR-001 去耦电容就近 | 电容远离电源引脚 → warning / 就近放置 → pass |
| JR-002 嘉立创料号 | 无料号 → info / 有料号 → pass |

### 12.4 Adapter 层测试要求

| Adapter | 必须覆盖的场景 |
|---------|---------------|
| AiAdapter | 正常流式返回、中途断流重试、AUTH_ERROR 不重试、RATE_LIMIT 重试、配置变更重建客户端 |
| JlcAdapter | 精确匹配、无匹配降级、全失败兜底、库存查询超时 |

### 12.5 StorageService 测试要求

| 测试用例 | 期望行为 |
|----------|----------|
| 首次创建项目 | index.json 创建、目录结构正确 |
| 保存报告版本 | report-v{n}.json 写入正确 |
| 版本淘汰（>10） | 最旧版本自动删除 |
| 删除项目 | 目录和 index 条目同步清理 |
| 导出 CSV | 文件名规范、字段完整 |

### 12.6 可测边界定义

```text
必须被测试的核心逻辑：
├── Artifact Schema 解析与校验
├── Pipeline 阶段依赖与级联失效
├── 规则引擎每条规则
├── Adapter 层错误分类与重试
├── StorageService 版本管理
└── 消息协议 Extension ↔ Webview 格式一致性

不需要单元测试的部分（手动验收即可）：
├── Webview 视觉样式
├── VS Code 主题适配
└── 用户交互流畅度
```
