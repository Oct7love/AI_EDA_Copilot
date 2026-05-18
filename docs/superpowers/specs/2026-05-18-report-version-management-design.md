# Phase 7 — 报告版本管理 设计文档

- 日期：2026-05-18
- 状态：已确认设计，待写实现计划
- 范围对应：`IMPLEMENTATION_PLAN.md` §9（Phase 7 — 本地存储 + 历史）中的「报告版本管理」子集

## 1. 目标与边界

### 1.1 目标

在现有会话存储（`SessionStorageService` / `SessionManager`，`.ai-eda/sessions/{id}.json`）之上，为每个 session 增加**报告版本历史**：

- 全管线完成时自动快照一份报告版本
- 每个 session 最多保留 10 个版本，超出淘汰最旧
- Report 顶部版本栏可切换 / 删除 / 另存某一版本
- 重新打开 VS Code 后历史版本仍可加载

### 1.2 明确不在本轮范围（YAGNI）

- 多方案（scheme）并排对比视图 —— 后续单独立项
- 代码分析输入（原 `IMPLEMENTATION_PLAN.md` §10 Phase 8）—— 后续单独立项
- 不把现有 `sessions/` 单文件结构重构为 项目/方案/版本 三层目录结构（保持单文件 `SessionData` 模型，改动最小）

## 2. 关键设计决策（已与用户确认）

| 决策点 | 选择 |
|--------|------|
| 版本触发时机 | 全管线完成自动快照；局部 regenerate 只更新当前草稿，不新增版本 |
| 版本数据存储 | 嵌入 `SessionData.versions[]`，最多 10 项淘汰最旧 |
| 版本列表 UI | Report 顶部版本栏（紧邻现有 Regenerate All / StaleIndicator 区） |
| 选择旧版本行为 | 恢复为当前工作态（写回 pipeline 缓存 + 报告视图），不立即新增版本 |

## 3. 触发机制（已核实，精确定义）

### 3.1 现状（核实结论）

- `AiPipelineService.onPipelineComplete` 仅在 `runDesignReviewStage` 末尾（全管线最后阶段，`AiPipelineService.ts:379`）触发。
- `activate.ts:63` 将 `onPipelineComplete` 接到 `sessionManager.autoSave()`。
- `activate.ts:255`：`regenerateFrom(stage)` 完成后**也**调用 `sessionManager.autoSave()`。
- `regenerateFrom('designReview')` 内部调用 `runDesignReviewStage` → 同样触发 `onPipelineComplete`。
- `saveCurrentSession()` 还被 `newSession()` / `switchSession()` 用于切换前自动保存当前会话。

结论：单靠 `onPipelineComplete` 无法区分「初始全管线完成」与「局部 regenerate（含 regenerateFrom('designReview') 与 cascade）」。

### 3.2 解决方案

1. `AiPipelineService` 新增私有瞬时标志 `private isRegenerating = false;`
2. `regenerateFrom(stage)`：在 `try` 起始处设 `this.isRegenerating = true;`，`finally` 中复位 `this.isRegenerating = false;`（与现有 `isRunning` 同位置管理）。
3. `runDesignReviewStage` 末尾：将 `this.onPipelineComplete?.();` 改为 `if (!this.isRegenerating) this.onPipelineComplete?.();`
4. 结果：`onPipelineComplete` 成为纯粹的「初始全管线完成」信号。

### 3.3 保存方法职责划分（SessionManager）

| 方法 | 触发来源 | 是否新增版本 | 行为 |
|------|----------|--------------|------|
| `snapshotVersion()`（新增） | `onPipelineComplete`（initial 全管线完成） | 是 | `appendVersion` 快照当前 artifacts → trim 到 10 → 写盘 |
| `autoSave()`（现有，行为不变） | `regenerateFrom().then()`（activate.ts:255） | 否 | 仅更新顶层 `artifacts` 草稿并写盘 |
| `saveCurrentSession()`（现有，行为不变） | `newSession()` / `switchSession()` / 手动保存 | 否 | 仅持久化 session（含顶层 artifacts 草稿） |

顶层 `SessionData.artifacts` 语义不变：始终镜像「当前工作态」（最新版本或被恢复/局部重生成后的草稿），保证现有加载逻辑（`switchSession` 的产物推送、`deriveOverview` 派生）零改动。

## 4. 数据模型

### 4.1 类型变更（`src/shared/types/session.types.ts`）

```ts
/** 单个报告版本快照 */
export interface ReportVersion {
  id: string;            // generateId() 复用 SessionManager 现有生成器
  createdAt: string;     // ISO 时间戳
  label: string;         // 展示用，如 "v3 · 2026-05-18 23:10"
  artifacts: SessionArtifacts;  // 复用现有类型，整套产物快照
}

// SessionData 新增字段：
export interface SessionData {
  // ...现有字段不变...
  versions: ReportVersion[];   // 越新越靠后，长度 <= MAX_VERSIONS(10)
}
```

`SessionIndexEntry` 不变（索引保持轻量，不含版本信息）。

### 4.2 向后兼容（旧 session 文件迁移）

旧 `{id}.json` 无 `versions` 字段。在 `SessionStorageService.loadSession()` 读取后做一次规整（migration-on-read）：

- 若 `data.versions` 为 `undefined`：
  - 若 `data.artifacts` 中存在任意非空产物 → 播种为单个 `ReportVersion`（`label: "v1 · <createdAt 或 updatedAt>"`，`artifacts` 取 `data.artifacts`），`versions = [seed]`
  - 否则 `versions = []`
- 迁移仅在内存中补齐，下次正常写盘时落盘新结构（不单独发起写操作，避免读路径产生副作用）

## 5. 纯逻辑模块（新建 `src/extension/services/versionStore.ts`）

沿用项目既有「纯函数下沉 + 独立单测」模式（参照 `artifactParsers.ts` / `overviewDeriver.ts`），保证可测试性，使 `SessionManager` 仅做编排。

```ts
export const MAX_VERSIONS = 10;

/** 追加一个版本快照并淘汰最旧，返回新数组（不可变） */
export function appendVersion(
  versions: ReportVersion[],
  snapshot: ReportVersion,
  max: number = MAX_VERSIONS,
): ReportVersion[];

/** 按 id 查找版本，未找到返回 undefined */
export function findVersion(
  versions: ReportVersion[],
  id: string,
): ReportVersion | undefined;

/** 按 id 移除版本，返回新数组 */
export function removeVersion(
  versions: ReportVersion[],
  id: string,
): ReportVersion[];

/** 构造版本 label（与 createdAt 一致的展示字符串） */
export function buildVersionLabel(index: number, createdAt: string): string;
```

不可变实现（返回新数组），便于测试与状态推理。

## 6. 编排层变更（`src/extension/services/SessionManager.ts`）

- 注入 / 复用现有 `generateId()`。
- 新增 `snapshotVersion()`：
  1. 用与 `saveCurrentSession` 相同的逻辑收集当前 `SessionArtifacts`（复用现有 artifacts 收集代码，必要时抽出私有 `collectArtifacts()` 以消除重复）。
  2. 读取/构造当前 `SessionData`，对 `data.versions` 调 `appendVersion(...)`。
  3. 顶层 `artifacts` 同步为该快照（保持「镜像最新」语义）。
  4. 写盘 + 推送 `version_list` 到 Report。
- 新增 `restoreVersion(versionId)`：
  1. 加载当前 session → `findVersion`。
  2. 将该版 `artifacts` 写回 pipeline 缓存（`lastSpec` / `lastBomItems` / `lastSchematic` / `lastPcbLayout`）与顶层 `artifacts` 草稿（与 `switchSession` 现有写回逻辑一致）。
  3. 调用抽出的 `pushArtifactsToReport(artifacts)` helper（从 `switchSession` 第 184–233 行那段产物推送逻辑提取，消除重复）推送到 Report。
  4. 不新增版本（符合用户决策）。更新 `currentVersionId` 并推送 `version_list`。
- 新增 `deleteVersion(versionId)`：`removeVersion` → 写盘 → 推送 `version_list`。若删除的是当前镜像版本，顶层 `artifacts` 保持不变（仅版本历史移除该项）。
- 重构：抽出 `private pushArtifactsToReport(artifacts: SessionArtifacts)` 与 `private collectArtifacts(): SessionArtifacts`，`switchSession` / `saveCurrentSession` / 新方法共用，净减少重复代码。属于「在改动处顺手改善」，不做无关重构。

## 7. 消息协议（`src/shared/types/messages.types.ts`）

- `ExtensionToReport` 新增：
  - `version_list` — payload: `{ versions: ReportVersionMeta[]; currentVersionId: string | null }`
  - `ReportVersionMeta = Pick<ReportVersion, 'id' | 'createdAt' | 'label'>`（不传 artifacts，列表保持轻量）
- `ReportToExtension` 新增：
  - `restore_version` — payload: `{ versionId: string }`
  - `delete_version` — payload: `{ versionId: string }`
  - `export_version` — payload: `{ versionId: string; format: 'markdown' | 'json' | 'csv' }`
- `index.ts` re-export 同步。

## 8. 导出 / 另存（复用 Phase 6B）

- `export_version` 路由到 Phase 6B 既有导出器（`markdownExporter` / `jsonExporter` / `bomCsvExporter`），但输入 artifacts 改为指定版本的快照。
- 为满足 §9.5「另存到任意路径」验收：`export_version` 处理时使用 `vscode.window.showSaveDialog` 让用户选目标路径。
- 导出器与调用方的具体写入边界（导出器是否自行写文件、能否接收目标 URI）在实现计划阶段依据 Phase 6B 现有导出器签名确定；本设计仅约束：复用 Phase 6B 导出逻辑、输入 artifacts 替换为指定版本快照、目标路径来自 save dialog。

## 9. Report 前端

- 新建 `src/webview/report/components/VersionBar.tsx` + `VersionBar.css`：
  - 位置：`ReportApp.tsx` 顶部，紧邻现有 Regenerate All 按钮 / StaleIndicator 区。
  - 展示：当前版本高亮的下拉列表（label = 时间戳）；行内操作：点击=恢复（`restore_version`）、删除按钮（`delete_version`，带确认）、另存（`export_version`，选格式）。
  - 空状态：无版本时不渲染版本栏。
  - 样式遵循 `FRONTEND_GUIDELINES` 与现有 CSS 变量（`--eda-*`），不硬编码颜色。
- `src/webview/report/store/reportStore.ts`：新增 `versions: ReportVersionMeta[]` + `currentVersionId: string | null` + 对应 setter。
- `src/webview/report/ReportApp.tsx`：处理 `version_list` 消息 → 写 store → 渲染 `VersionBar`；接出 restore/delete/export 回传。

## 10. Extension 接线（`src/extension/activate.ts`）

- `pipeline.onPipelineComplete` 由 `sessionManager.autoSave()` 改为 `sessionManager.snapshotVersion()`。
- `regenerate_stage` handler 中 `regenerateFrom().then()` 路径保持调用 `autoSave()`（不变，确认不新增版本）。
- 新增 3 个 `ReportToExtension` handler：`restore_version` / `delete_version` / `export_version`，分别转 `sessionManager.restoreVersion/deleteVersion` 与导出路由。

## 11. 文件清单（4 新建 + 9 修改）

| 操作 | 文件 |
|------|------|
| 新建 | `src/extension/services/versionStore.ts` |
| 新建 | `src/extension/services/versionStore.test.ts` |
| 新建 | `src/webview/report/components/VersionBar.tsx` |
| 新建 | `src/webview/report/components/VersionBar.css` |
| 修改 | `src/shared/types/session.types.ts` |
| 修改 | `src/shared/types/messages.types.ts` |
| 修改 | `src/shared/types/index.ts` |
| 修改 | `src/extension/services/AiPipelineService.ts`（isRegenerating 标志 + onPipelineComplete 守卫） |
| 修改 | `src/extension/services/SessionManager.ts`（snapshotVersion/restoreVersion/deleteVersion + helper 抽取） |
| 修改 | `src/extension/services/SessionStorageService.ts`（loadSession 迁移规整） |
| 修改 | `src/extension/activate.ts`（接线 + 3 handler + export-version save dialog） |
| 修改 | `src/webview/report/store/reportStore.ts` |
| 修改 | `src/webview/report/ReportApp.tsx` |

（其中 `session.types.ts` / `messages.types.ts` / `index.ts` 为类型层连带修改，体量小。）

## 12. 测试计划

- `versionStore.test.ts`（纯函数全覆盖）：
  - `appendVersion`：空数组追加、未满追加、恰好满 10、超过 10 淘汰最旧（FIFO）、不可变（不修改入参）
  - `findVersion`：命中 / 未命中
  - `removeVersion`：命中移除 / 未命中原样返回 / 不可变
  - `buildVersionLabel`：格式正确性
- `SessionManager` / `SessionStorageService` 含 `vscode` 依赖，纯逻辑已下沉 `versionStore`；迁移规整与接线通过手动验证（在变更说明中记录验证步骤），符合 §15.2（说明原因 + 已下沉可测部分）。
- 回归：`npm run compile` + `npm test`（现有 123 测试须全绿）+ `npx @vscode/vsce package`。

## 13. 验收对齐（`IMPLEMENTATION_PLAN.md` §9.5，本轮相关项）

| 验收项 | 覆盖 |
|--------|------|
| 生成报告后自动保存 | ✅ snapshotVersion on full pipeline complete |
| 重开 VS Code 可加载历史报告 | ✅ 版本随 session 持久化 + 迁移兼容 |
| 版本列表显示最近 10 个，超出淘汰最旧 | ✅ appendVersion + MAX_VERSIONS |
| 用户可手动删除版本 / 另存任意路径 | ✅ deleteVersion + export_version + showSaveDialog |
| 对话历史保留并可回看 | ✅ 现有会话能力，未回退 |
| 导出 Markdown/JSON/CSV 命名规则 | ✅ 复用 Phase 6B 导出器 |
| 多方案并排对比 | ❌ 明确不在本轮（后续单独立项） |

## 14. 风险

| 风险 | 缓解 |
|------|------|
| 触发信号区分错误导致 regenerate 误增版本 | §3.2 `isRegenerating` 守卫已精确定义并核实，纯逻辑有单测 |
| 旧 session 文件结构不兼容 | §4.2 migration-on-read，无破坏性写 |
| `switchSession` 产物推送逻辑重复 | §6 抽 `pushArtifactsToReport` helper，净减重复，限定在改动范围内 |
| 版本快照体积（整套 artifacts × 10） | BOM 等已在现有 session 单文件中存储；10 倍上限可控，必要时后续可优化为差量（非本轮） |
