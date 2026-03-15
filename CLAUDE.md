# CLAUDE.md

## 1. Purpose

This file is the operating manual for AI agents working in this repository.
It must be read at the start of every session.

Use this file as the default source of truth for:

* product direction
* architecture intent
* repository conventions
* UI and interaction rules
* EDA workflow behavior
* allowed and forbidden actions

Priority order when instructions conflict:

1. explicit user request in the current session
2. this `CLAUDE.md`
3. existing project patterns in the codebase
4. general best practices

---

## 2. Project Summary

This project is a **VS Code extension-first AI EDA product**.
Current working name: **AI EDA Copilot**.

Core goal:

* help users describe electronics projects in natural language
* turn that input into structured engineering artifacts
* support BOM, schematic intent, PCB layout planning, and procurement guidance
* validate the AI EDA workflow before any standalone IDE fork

V1 focus:

* general electronics small projects / maker / prototype-class work
* VS Code side panel input
* detailed Webview report output
* structured, reviewable, regenerable results

---

## 3. Product Vision

### 3.1 Current strategy

Current stage strategy is **VS Code Extension-first**.

This means:

* V1 is implemented as a **VS Code extension**
* reuse VS Code editor, explorer, tabs, commands, and workspace UX
* do not prioritize a standalone IDE shell in V1
* do not prioritize forking the entire Code - OSS codebase in V1

### 3.2 Product layers

The product has two capability layers:

#### AI IDE layer

A VS Code-integrated workflow with:

* project/file context awareness
* side-panel interaction
* structured result views
* future potential to evolve into a standalone desktop IDE

#### AI EDA layer

A natural-language-driven electronics assistant that can:

* understand hardware intent
* decompose requirements into subsystems
* propose components and alternatives
* produce BOM candidates
* express schematic intent
* guide PCB layout planning
* support JLCPCB / 嘉立创 procurement workflows

The system should feel like:

* an IDE extension first
* an AI copilot second
* an EDA workflow engine third

Not a generic chatbot.

---

## 4. Technical Direction

Default stack and direction unless explicitly changed by the user:

### Core stack

* TypeScript
* React
* VS Code Extension API
* Webview UI for detailed reports
* Monaco/VS Code editor experience reused through VS Code itself
* Node.js / TypeScript orchestration where needed

### Preferred module areas

* extension entry / commands / providers
* side-panel interaction layer
* Webview report layer
* AI orchestration layer
* EDA domain layer
* procurement mapping layer
* shared types

### EDA output principle

EDA outputs must be modeled as structured artifacts, not only free text.
Examples:

* `RequirementSpec`
* `BOMItem[]`
* `SchematicIntent`
* `PCBLayoutPlan`
* `ProcurementPlan`
* `DesignReviewResult`

---

## 5. Non-Negotiable Development Rules

### 5.1 General

* Plan first.
* Documentation first, code second.
* Prefer clarity over cleverness.
* Prefer modularity over monolithic files.
* Keep changes small and intentional.
* Reuse existing patterns before creating new abstractions.

### 5.2 Before writing code

Always determine:

* the feature goal
* the affected layer
* the entry point
* the minimum files required
* the smallest useful implementation

### 5.3 After modifying code

Always explain:

* what changed
* why it changed
* which files were touched
* why those files were sufficient

### 5.4 Bug handling

For bugs, always check:

1. what the bug is
2. whether it can be reproduced
3. likely causes
4. the best inspection entry point
5. the smallest valid fix

### 5.5 Architecture discipline

* UI components must not contain heavy business logic.
* Domain logic must not live inside presentation files.
* Integration logic must be isolated.
* Shared types must be centralized.
* Constants must be centralized.

---

## 6. Repository Conventions

Expected top-level structure:

```text
my_app/
├─ docs/
├─ public/
├─ src/
├─ .env
├─ .env.example
├─ .gitignore
├─ README.md
├─ CLAUDE.md
├─ package.json
└─ tsconfig.json
```

Source directory structure (implemented):

```text
src/
├─ extension/                  # 插件侧（Node.js 环境）
│  ├─ commands/                # 命令注册
│  ├─ providers/               # Webview Provider
│  ├─ services/                # 业务服务层（Phase 2+ 逐步增加）
│  ├─ adapters/                # 外部 API 适配器（Phase 3+）
│  ├─ prompts/                 # AI Prompt 模板（Phase 3+）
│  ├─ rules/                   # 规则引擎（Phase 6）
│  └─ activate.ts              # 插件入口
├─ webview/                    # Webview 侧（浏览器环境）
│  ├─ panel/                   # 侧边栏 Webview
│  ├─ report/                  # 报告 Webview
│  ├─ shared/                  # 两个 Webview 共享
│  └─ styles/                  # 全局样式 + CSS 变量
└─ shared/                     # Extension 与 Webview 共享
   ├─ types/                   # 共享类型定义
   └─ constants/               # 共享常量
```

---

## 7. Naming Conventions

### Files

* React components: `PascalCase.tsx`
* utility modules: `camelCase.ts`
* markdown docs: `UPPER_SNAKE_CASE.md` for planning docs, plus explicit names like `README.md`, `CLAUDE.md`
* types: `something.types.ts` or grouped in `src/types/`

### Code naming

* variables: `camelCase`
* functions: `camelCase`
* React components: `PascalCase`
* types/interfaces: `PascalCase`
* true constants: `UPPER_SNAKE_CASE`
* booleans: `is...`, `has...`, `can...`, `should...`
* event handlers: `handle...`

---

## 8. Component Design Rules

### 8.1 Principles

Components must be:

* small
* composable
* single-purpose
* easy to inspect
* easy to replace

### 8.2 Preferred split

* `ui`: reusable primitives
* `layout`: shell, panels, headers
* `editor`: editor-related views if needed
* `eda`: EDA-specific views
* `webview`: full-report presentation

### 8.3 Forbidden patterns

* giant components unless unavoidable
* mixing layout, data fetching, domain logic, and rendering in one file
* raw API/integration calls scattered across view components
* duplicate near-identical variants instead of parameterization

---

## 9. State Management Rules

* local state for local UI behavior
* shared state only for truly shared state
* domain state separated from presentation state
* derived state computed, not duplicated

Suggested shared domains:

* active analysis session
* report state
* requirement editing state
* regeneration state
* history/report state

Do not put everything into one global store.

---

## 10. AI Workflow Rules

### 10.1 V1 scope

V1 should prioritize **general electronics small projects / maker / prototype-class projects**, including:

* ESP32
* STM32
* Arduino ecosystem boards
* common sensors
* OLED / small display modules
* basic power modules
* Wi-Fi / Bluetooth connected prototypes
* simple controller boards and validation boards

Expansion beyond V1 may gradually include:

* consumer electronics / product prototypes
* power / analog / industrial control
* more constrained manufacturing-oriented systems

### 10.2 V1 interaction model

Use:

* a **VS Code side panel** for input and quick actions
* side-panel summaries for first-pass results
* a **dedicated Webview** for the full report

Quick actions should include things like:

* Analyze Project
* Generate BOM
* Generate PCB Plan
* Match JLC Parts

### 10.3 Input rules

Support both:

* free-form natural language
* semi-structured input

Optimize first for:

* **free-form natural language**

The minimum required input may be as light as:

* one meaningful project description sentence

All other fields may initially be AI-inferred, but must be labeled.

### 10.4 Templates

Support quick-start templates.
Initial priorities:

* ESP32 sensor projects
* STM32 controller boards
* OLED / display small boards
* battery-powered small boards

Templates should:

* pre-fill core requirement fields
* improve requirement setup speed

### 10.5 Attachment strategy

V1 may support limited attachments as reference context, including:

* images
* PDFs
* BOM tables/spreadsheets
* lightweight project reference files

Treat attachments in V1 as:

* supporting context
* analysis aids
* evidence sources

Architecture should remain ready for future multimodal expansion.

### 10.6 Default pipeline order

1. `RequirementSpec`
2. `BOMItem[]`
3. `Schematic Intent`
4. `PCB Layout Plan`
5. `Procurement`

### 10.7 AI completion strategy

Default strategy is **semi-autonomous completion**:

* AI generates a first-pass candidate
* AI may infer common defaults
* inferred content must be labeled
* user must be able to review and modify

Always distinguish:

* `User Provided`
* `AI Inferred`
* `Needs Confirmation`
* confidence level where relevant

If information is missing:

* non-critical missing information: generate a provisional first pass and mark it clearly
* critical missing information: pause and ask clarifying questions

If the request is too vague:

* provide multiple candidate directions for the user to choose from

### 10.8 Full Report structure

Full Report default order:

1. `Overview`
2. `Requirements`
3. `BOM`
4. `Schematic Intent`
5. `PCB Layout Plan`
6. `Procurement`

The primary next-step action after summary generation is:

* **`Open Full Report`**

### 10.9 Overview rules

`Overview` should prioritize:

* one-sentence project summary
* functional module breakdown
* key component suggestions
* missing information / open questions
* risks
* next-step actions

A dedicated **Missing Info / Open Questions** block must exist.
A visible **Project Status / Readiness** block must exist near the top.

### 10.10 Requirements rules

`Requirements` is the primary editable source of truth in V1.

Show first:

* MCU / main controller
* power
* communication
* display
* sensors

Show second, preferably folded:

* cost range
* size limits
* production intent
* power consumption target
* precision requirements

Editing should support both:

* structured form editing
* text-view editing

### 10.11 BOM rules

BOM should:

* default to a concise table
* allow row expansion for details

Default visible columns:

* `Designator`
* `Comment`
* `Footprint`
* `Quantity`
* `JLC Part Number`

Expanded details may include:

* category
* manufacturer
* MPN
* alternatives
* confidence
* confirmation status

Alternative parts are a first-class concept.
Distinguish:

* recommended primary choice
* alternative candidates

### 10.12 Schematic Intent rules

User-facing presentation should be readable and module-oriented.
Internal modeling should prepare for structured representations such as:

* `SchematicNode`
* `ConnectionSpec`
* network categories

At minimum, distinguish:

* power networks
* communication networks
* control signals
* analog signals

Do **not** treat final schematic project file generation as a V1 completed capability.

### 10.13 PCB Layout Plan rules

V1 must include a **visual block layout diagram**, not only text.

Include:

* block-level placement guidance
* key placement constraints and notes

Examples:

* USB near board edge
* antenna keep-out area
* decoupling capacitors close to power pins
* clock/noise isolation hints
* functional zoning for power, MCU, interface, RF, and peripherals

Do **not** treat final PCB file generation or routing output as a V1 completed capability.

### 10.14 Procurement rules

Procurement should support:

* candidate supplier part matching
* alternative part suggestions
* recommendation priority
* JLC / 嘉立创 compatibility emphasis

Highlight first:

* JLC compatibility status
* missing footprint / package data
* assembly-readiness concerns
* whether a JLC part number is available

V1 procurement scope stops at:

* compatibility checks
* candidate mapping
* procurement guidance

Later roadmap may expand to order-preparation bundles.
Do **not** claim direct automatic ordering unless implemented and validated.

### 10.15 Export, persistence, and history

Support export of:

* Markdown
* JSON
* CSV

At minimum, BOM export must support CSV.

Preferred export naming:

* project name + timestamp + artifact type

Support:

* full-report persistence
* history/reports access
* saved analysis continuation

History / reports should be organized primarily by:

* **project name**

Persistence targets may include both:

* workspace-visible Markdown/JSON files
* plugin-local cache/state

### 10.16 Regeneration rules

After requirement editing:

* do not auto-regenerate downstream artifacts by default
* let the user click **`Regenerate`**

Support partial regeneration, including:

* `Requirements -> BOM`
* `BOM`
* `Schematic Intent`
* `PCB Layout Plan`
* `Procurement`

### 10.17 Tone

Use a mixed tone:

* friendly and helpful overall
* cautious and explicit for engineering conclusions

### 10.18 Mandatory execution order

For any feature request, bug fix, refactor, or new capability:

1. plan first
2. document first, code second
3. identify the entry point
4. limit scope to the minimum necessary files
5. implement changes
6. explain exactly what changed and why

## 11. JLCPCB / 嘉立创 Integration Principles

Keep procurement logic layered:

* generic component domain model
* supplier-specific part mapping
* procurement/order-preparation layer

### 11.1 BOM baseline

BOM workflow should center on fields emphasized by JLC BOM conventions:

* `comment`
* `designator`
* `footprint`
* optional `jlcPartNumber`

### 11.2 BOM constraints

* `comment` should prefer a clear model string
* `designator` must match coordinate/design data consistently
* `footprint` must not be empty
* `jlcPartNumber` is optional but high-value when available

### 11.3 Delivery boundary

Do not present direct automated ordering as implemented unless it actually is.

---

## 12. Design System Tokens

Use a clean IDE-like visual system.

### 12.1 Visual style

* dark-first UI by default
* low-noise surfaces
* strong information hierarchy
* restrained color usage
* accent color used intentionally for selection, focus, and primary actions

### 12.2 Tokens

#### Radius

* `radius-sm`: 6px
* `radius-md`: 8px
* `radius-lg`: 12px

#### Spacing

* `space-1`: 4px
* `space-2`: 8px
* `space-3`: 12px
* `space-4`: 16px
* `space-5`: 20px
* `space-6`: 24px

#### Typography

* UI font: modern sans-serif
* code font: monospace
* keep dense IDE surfaces readable

### 12.3 UX priorities

* keyboard-first interaction where possible
* strong focus states
* dense but readable layouts
* avoid excessive animation
* prioritize speed and clarity over flourish

--- What Is Allowed

The AI may:

* propose better structure when current structure is weak
* create missing shared types
* extract utilities when duplication appears
* refactor large files into smaller modules
* introduce domain models for EDA artifacts
* improve naming for clarity
* add comments where logic is non-obvious
* suggest staged implementation plans
* add quick-start templates for supported project classes
* add persistence and history flows aligned with the current V1 strategy

## 14. What Is Forbidden

The AI must not:

* silently rewrite the entire architecture
* add heavy dependencies without clear justification
* mix EDA domain logic into random UI files
* fabricate supplier compatibility as if verified
* claim BOM accuracy without uncertainty labeling
* create fake integrations that look real but are not implemented
* overengineer early-stage features
* ignore the current repository conventions
* introduce inconsistent naming styles
* present final schematic-file generation as completed if it is not implemented
* present final PCB-file generation as completed if it is not implemented
* claim direct automatic JLC ordering unless it is actually implemented and validated

## 15. Mandatory Development Discipline

### 15.1 Worktree 工作流

涉及中等以上功能开发时，优先使用独立 git worktree。

规则：

* 一个 worktree 对应一个明确任务 / phase / feature
* worktree 命名：`wt-{phase|feature}-{简短描述}`，如 `wt-phase3-ai-pipeline`
* 分支命名：`feat/{phase|feature}/{简短描述}`，如 `feat/phase3/ai-pipeline`
* Phase 0 可在主分支直接初始化；Phase 1 以后建议每个 phase 或 feature 使用独立 worktree

在 worktree 中开发时，必须遵循以下顺序：

1. 先更新计划（IMPLEMENTATION_PLAN 或相关文档）
2. 再改代码
3. 最后补测试和变更说明

合并前必须：

* 跑通所有测试
* 更新 progress.txt
* 更新受影响的文档
* 写清楚变更说明

### 15.2 测试纪律

* 所有新增逻辑默认要求带测试
* 若不写测试，必须说明原因和补测计划
* 测试计划随代码一起提交或在 progress.txt 中记录
* 不允许因"后面再补"而永久跳过测试

### 15.3 代码可维护性纪律（防止屎山化）

每次修改代码前，必须确认：

* 理解当前文件的职责边界（不理解就先读，不要猜）
* 修改范围与任务目标一致（不做无关重构）
* 新增代码不超过单文件 300 行（超过则拆分）
* AI 生成的代码必须经过人工审查后才合并

AI 代码审查清单（每次提交前过一遍）：

* [ ] 是否引入了未使用的 import / 变量？
* [ ] 是否有重复逻辑可以复用已有函数？
* [ ] 错误处理是否完整（不吞异常、不空 catch）？
* [ ] 类型标注是否准确（不滥用 `any`，必要时说明原因）？
* [ ] 命名是否符合项目约定（§7）？

### 15.4 文档-代码同步纪律

* 每个 Phase 完成后必须更新 progress.txt
* 类型定义修改后必须检查是否与 BACKEND_STRUCTURE.md 对齐
* 新增服务/组件后必须更新 CLAUDE.md §6 的目录结构
* prompt 策略变更后必须更新相关文档

---

## 16. Implementation Strategy

Default strategy for new work:

1. clarify the feature goal
2. identify the smallest valuable slice
3. write or update the relevant document first
4. identify the true entry point
5. define data structures early
6. implement only the necessary files
7. refine UX after functionality exists

For complex features, prefer this sequence:

* Step A: planning note / doc update
* Step B: interface skeleton
* Step C: mocked data flow
* Step D: real state wiring
* Step E: backend/tool/integration hookup
* Step F: polish and cleanup

For bugs, the AI must use this sequence:

1. describe the bug
2. determine whether it can be reproduced
3. list the most likely causes
4. identify the best inspection entry point
5. apply the smallest fix
6. explain what changed and why

---

## 16. Current Priorities

Near-term priority order:

1. establish stable repository conventions
2. implement the VS Code extension shell
3. build the side-panel input experience
4. build the detailed Webview result view
5. define EDA artifact schemas
6. support natural-language-to-EDA analysis flow
7. add procurement mapping and supplier integration
8. add template-based quick starts
9. add report/history persistence

---

## 17. How AI Should Respond In This Repo

When helping in this project, the AI should usually provide:

* a brief explanation of the approach
* the exact files to create or edit
* the smallest implementation that works
* clear assumptions
* noted risks or unknowns

Before any code change, include:

* plan
* entry point
* files to touch
* why those files are sufficient

After any modification, always include:

* what changed
* why it changed
* whether the issue or feature can be reproduced / verified
* likely bug causes if debugging was involved

When ambiguity exists, the AI should:

* make conservative assumptions
* say those assumptions explicitly
* avoid pretending uncertain details are settled

When proposing code changes, prefer:

* incremental patches
* maintainable structure
* reusable abstractions only when justified

---

## 18. Definition of Good Output

Good output in this repository is:

* practical
* incremental
* readable
* typed when appropriate
* aligned with the current structure
* honest about uncertainty
* easy to extend later

Bad output is:

* flashy but unmaintainable
* vague architecture talk without implementation value
* giant code dumps with no structure
* fake precision in hardware or procurement details

---

## 19. Immediate Next-Step Guidance

If no other instruction is given, the AI should help the user in this order:

1. finalize repository conventions
2. scaffold the VS Code extension architecture
3. scaffold the side-panel input flow
4. scaffold the detailed Webview result view
5. define EDA artifact data models
6. design the natural-language analysis pipeline
7. add supplier/procurement adapters
8. add project templates / quick starts
9. add result persistence and history UX

---

## 20. Session Reminder

At the beginning of each session, **first read `progress.txt`** to locate the current development progress and pending tasks.

Then assume:

* this repository is currently building a **VS Code extension-first AI EDA product**
* the current plugin/product working name is **AI EDA Copilot**
* V1 should validate the AI EDA workflow before any standalone IDE fork
* V1 should focus on general electronics small projects first
* V1 should use a side panel for input and a Webview for full reports
* V1 should not claim final schematic-file or PCB-file generation as core completed capabilities
* V1 procurement should stop at compatibility checks, candidate mapping, and guidance
* the long-term differentiator is AI-native EDA workflow support
* outputs should move toward structured engineering artifacts
* implementation should stay modular, disciplined, and incremental
* planning is mandatory
* documentation comes before code
* every code change must be followed by an explanation of what changed and why
* every bug investigation must first consider reproducibility and likely causes
