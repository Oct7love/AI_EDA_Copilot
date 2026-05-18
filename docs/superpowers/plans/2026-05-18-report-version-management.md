# Report Version Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为每个会话增加报告版本历史：全管线完成自动快照、最多 10 版淘汰最旧、Report 顶部版本栏可切换/删除/另存。

**Architecture:** 在现有 `SessionData` 单文件模型内嵌 `versions[]`；纯版本逻辑下沉到可单测的 `versionStore.ts`；`AiPipelineService` 用 `isRegenerating` 守卫把 `onPipelineComplete` 收敛为「初始全管线完成」信号，接 `SessionManager.snapshotVersion()`；Report 顶部新增 `VersionBar` 组件。

**Tech Stack:** TypeScript, VS Code Extension API, React 18, Zustand, Vitest, esbuild。

**Spec:** `docs/superpowers/specs/2026-05-18-report-version-management-design.md`

**Spec 偏差（已在 spec 内更新）:** §8 导出 —— 已核实 Phase 6B 三个导出器内部均自带 `showSaveDialog`，`export_version` 仅需用选定版本 artifacts 调现有导出器，无新增 dialog 代码。

**已知限制（沿用现状，不在本轮扩大范围）:** `designReviewResult` 当前未缓存在 `AiPipelineService` 上（既有 `SessionManager.saveCurrentSession` 即写 `null`）。版本快照中 `designReviewResult` 同为 `null`，与现有会话保存行为一致。修复属独立项。

---

## 前置：工作区隔离

执行本计划前，先用 `superpowers:using-git-worktrees` 创建隔离工作区（对齐 CLAUDE.md §15.1）：

- worktree：`wt-phase7-report-version`
- 分支：`feat/phase7/report-version-management`
- 基点：`main`（当前 HEAD `aed8d61`，含已提交的 Phase 6B 与本设计/计划文档）

所有任务在该 worktree 内执行。命令均假设工作目录为该 worktree 根。node 用仓库内 `node@20`（`node -v` 应为 v20.x）。

---

## File Structure

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/extension/services/versionStore.ts` | 纯函数：版本数组追加/淘汰/查找/移除/迁移/label |
| 新建 | `src/extension/services/versionStore.test.ts` | versionStore 单元测试 |
| 新建 | `src/webview/report/components/VersionBar.tsx` | Report 顶部版本栏组件 |
| 新建 | `src/webview/report/components/VersionBar.css` | 版本栏样式 |
| 修改 | `src/shared/types/session.types.ts` | 新增 `ReportVersion` / `ReportVersionMeta` + `SessionData.versions` |
| 修改 | `src/shared/types/index.ts` | re-export 新类型 |
| 修改 | `src/shared/types/messages.types.ts` | 新增 4 个消息类型 |
| 修改 | `src/extension/services/SessionStorageService.ts` | `loadSession` 迁移规整 |
| 修改 | `src/extension/services/SessionManager.ts` | snapshot/restore/delete + 抽 helper |
| 修改 | `src/extension/services/AiPipelineService.ts` | `isRegenerating` 守卫 |
| 修改 | `src/extension/activate.ts` | 接线 + 3 个 handler |
| 修改 | `src/webview/report/store/reportStore.ts` | versions 状态 |
| 修改 | `src/webview/report/ReportApp.tsx` | 集成 VersionBar + 处理 version_list |

---

## Task 1: 类型层 — ReportVersion / ReportVersionMeta / SessionData.versions

**Files:**
- Modify: `src/shared/types/session.types.ts`
- Modify: `src/shared/types/index.ts`

- [ ] **Step 1: 在 `session.types.ts` 末尾新增类型并扩展 SessionData**

在 `src/shared/types/session.types.ts` 中，`SessionData` 接口内 `formData?: FormInputData;` 行之后、闭合 `}` 之前，新增一行：

```ts
  /** 报告版本历史（越新越靠后，长度 <= 10）；旧文件加载时迁移补齐 */
  versions: ReportVersion[];
```

然后在文件末尾（`SessionIndexEntry` 接口之后）追加：

```ts
/** 单个报告版本快照 */
export interface ReportVersion {
  id: string;
  createdAt: string;          // ISO 时间戳
  label: string;              // 展示用，如 "v3 · 2026-05-18 23:10"
  artifacts: SessionArtifacts;
}

/** 版本列表轻量元信息（推送到 Report，不含 artifacts） */
export type ReportVersionMeta = Pick<ReportVersion, 'id' | 'createdAt' | 'label'>;
```

- [ ] **Step 2: 在 `index.ts` 同步 re-export**

在 `src/shared/types/index.ts` 中，将：

```ts
export type {
  ChatMessage,
  SessionArtifacts,
  SessionData,
  SessionIndexEntry,
} from './session.types';
```

替换为：

```ts
export type {
  ChatMessage,
  SessionArtifacts,
  SessionData,
  SessionIndexEntry,
  ReportVersion,
  ReportVersionMeta,
} from './session.types';
```

- [ ] **Step 3: 给现有 SessionManager 加最小 stopgap（保持可编译）**

新增的必填 `versions` 字段会让 `SessionManager.saveCurrentSession` 现有 `SessionData` 字面量编译失败。为保证每个提交都可编译（Task 5 会整体重写该方法），在 `src/extension/services/SessionManager.ts` 的 `saveCurrentSession` 内，将：

```ts
      inputMode: this.inputMode,
    };

    await this.storage.saveSession(data);
```

替换为：

```ts
      inputMode: this.inputMode,
      versions: [], // stopgap（Task 5 整体重写为透传已有 versions）
    };

    await this.storage.saveSession(data);
```

- [ ] **Step 4: 类型检查通过**

Run: `npm run check-types`
Expected: PASS（零 tsc 错误；stopgap 让类型补全，本次提交可编译）。

- [ ] **Step 5: Commit**

```bash
git add src/shared/types/session.types.ts src/shared/types/index.ts src/extension/services/SessionManager.ts
git commit -m "feat(types): ReportVersion + SessionData.versions 类型定义（含 SessionManager stopgap）"
```

---

## Task 2: versionStore.ts 纯逻辑模块（TDD）

**Files:**
- Create: `src/extension/services/versionStore.ts`
- Test: `src/extension/services/versionStore.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `src/extension/services/versionStore.test.ts`：

```ts
/**
 * versionStore 单元测试 — 版本数组纯函数行为验证
 */
import { describe, it, expect } from 'vitest';
import {
  MAX_VERSIONS,
  appendVersion,
  findVersion,
  removeVersion,
  buildVersionLabel,
  migrateSessionVersions,
} from './versionStore';
import type { ReportVersion, SessionData, SessionArtifacts } from '@shared/types';

function emptyArtifacts(): SessionArtifacts {
  return {
    requirementSpec: null,
    overview: null,
    bomItems: [],
    procurementItems: [],
    schematicIntent: null,
    pcbLayoutPlan: null,
    designReviewResult: null,
  };
}

function makeVersion(id: string): ReportVersion {
  return { id, createdAt: '2026-05-18T00:00:00.000Z', label: `v-${id}`, artifacts: emptyArtifacts() };
}

describe('appendVersion', () => {
  it('空数组追加得到长度 1', () => {
    const out = appendVersion([], makeVersion('a'));
    expect(out.map(v => v.id)).toEqual(['a']);
  });

  it('未满时按顺序追加在末尾', () => {
    const out = appendVersion([makeVersion('a')], makeVersion('b'));
    expect(out.map(v => v.id)).toEqual(['a', 'b']);
  });

  it('恰好满 MAX_VERSIONS 后再追加淘汰最旧', () => {
    const full: ReportVersion[] = Array.from({ length: MAX_VERSIONS }, (_, i) => makeVersion(`v${i}`));
    const out = appendVersion(full, makeVersion('new'));
    expect(out).toHaveLength(MAX_VERSIONS);
    expect(out[0].id).toBe('v1');                 // v0 被淘汰
    expect(out[out.length - 1].id).toBe('new');
  });

  it('不修改入参数组（不可变）', () => {
    const input = [makeVersion('a')];
    appendVersion(input, makeVersion('b'));
    expect(input.map(v => v.id)).toEqual(['a']);
  });
});

describe('findVersion', () => {
  it('命中返回该版本', () => {
    expect(findVersion([makeVersion('a'), makeVersion('b')], 'b')?.id).toBe('b');
  });
  it('未命中返回 undefined', () => {
    expect(findVersion([makeVersion('a')], 'x')).toBeUndefined();
  });
});

describe('removeVersion', () => {
  it('命中移除', () => {
    const out = removeVersion([makeVersion('a'), makeVersion('b')], 'a');
    expect(out.map(v => v.id)).toEqual(['b']);
  });
  it('未命中原样返回新数组', () => {
    const out = removeVersion([makeVersion('a')], 'x');
    expect(out.map(v => v.id)).toEqual(['a']);
  });
  it('不修改入参数组（不可变）', () => {
    const input = [makeVersion('a'), makeVersion('b')];
    removeVersion(input, 'a');
    expect(input).toHaveLength(2);
  });
});

describe('buildVersionLabel', () => {
  it('格式为 v{n} · 本地时间', () => {
    const label = buildVersionLabel(3, '2026-05-18T15:10:00.000Z');
    expect(label.startsWith('v3 · ')).toBe(true);
    expect(label).toContain('2026');
  });
});

describe('migrateSessionVersions', () => {
  it('已有 versions 时原样返回', () => {
    const existing = [makeVersion('a')];
    const data = { artifacts: emptyArtifacts(), versions: existing } as unknown as SessionData;
    expect(migrateSessionVersions(data)).toBe(existing);
  });

  it('缺 versions 且 artifacts 全空 → 返回空数组', () => {
    const data = { artifacts: emptyArtifacts(), createdAt: '2026-05-18T00:00:00.000Z' } as unknown as SessionData;
    expect(migrateSessionVersions(data)).toEqual([]);
  });

  it('缺 versions 但 artifacts 非空 → 播种单个 v1', () => {
    const arts = emptyArtifacts();
    arts.bomItems = [{ designator: 'R1' } as never];
    const data = {
      artifacts: arts,
      createdAt: '2026-05-18T00:00:00.000Z',
      updatedAt: '2026-05-18T01:00:00.000Z',
    } as unknown as SessionData;
    const out = migrateSessionVersions(data);
    expect(out).toHaveLength(1);
    expect(out[0].label.startsWith('v1 · ')).toBe(true);
    expect(out[0].artifacts).toBe(arts);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run src/extension/services/versionStore.test.ts`
Expected: FAIL —— `Failed to resolve import "./versionStore"` 或 `does not provide an export`。

- [ ] **Step 3: 实现 versionStore.ts**

创建 `src/extension/services/versionStore.ts`：

```ts
/**
 * 报告版本纯逻辑 — 版本数组的追加/淘汰/查找/移除/迁移/label 生成
 *
 * 全部为不可变纯函数，无 vscode 依赖，可独立单测。
 * SessionManager 仅做编排，版本逻辑集中于此。
 */
import type { ReportVersion, SessionData, SessionArtifacts } from '@shared/types';

/** 每个会话最多保留的版本数，超出淘汰最旧 */
export const MAX_VERSIONS = 10;

/** 追加一个版本并淘汰最旧（FIFO），返回新数组 */
export function appendVersion(
  versions: ReportVersion[],
  snapshot: ReportVersion,
  max: number = MAX_VERSIONS,
): ReportVersion[] {
  const next = [...versions, snapshot];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** 按 id 查找版本，未找到返回 undefined */
export function findVersion(
  versions: ReportVersion[],
  id: string,
): ReportVersion | undefined {
  return versions.find((v) => v.id === id);
}

/** 按 id 移除版本，返回新数组（未命中原样返回拷贝） */
export function removeVersion(
  versions: ReportVersion[],
  id: string,
): ReportVersion[] {
  return versions.filter((v) => v.id !== id);
}

/** 构造版本展示 label：v{n} · 本地化时间 */
export function buildVersionLabel(index: number, createdAt: string): string {
  const d = new Date(createdAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `v${index} · ${stamp}`;
}

/** 判断一套 artifacts 是否存在任意非空产物 */
function hasAnyArtifact(a: SessionArtifacts): boolean {
  return Boolean(
    a.requirementSpec ||
    a.overview ||
    (a.bomItems && a.bomItems.length > 0) ||
    (a.procurementItems && a.procurementItems.length > 0) ||
    a.schematicIntent ||
    a.pcbLayoutPlan ||
    a.designReviewResult,
  );
}

/**
 * 迁移规整：旧 SessionData 无 versions 字段时补齐。
 * - 已有 versions：原样返回（引用不变）
 * - 缺 versions 且 artifacts 非空：播种为单个 v1
 * - 缺 versions 且 artifacts 全空：返回 []
 * 仅在内存中规整，调用方负责后续正常写盘时落盘。
 */
export function migrateSessionVersions(data: SessionData): ReportVersion[] {
  if (Array.isArray(data.versions)) return data.versions;
  if (!data.artifacts || !hasAnyArtifact(data.artifacts)) return [];
  const createdAt = data.createdAt || data.updatedAt || new Date().toISOString();
  return [
    {
      id: `seed-${createdAt}`,
      createdAt,
      label: buildVersionLabel(1, createdAt),
      artifacts: data.artifacts,
    },
  ];
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run src/extension/services/versionStore.test.ts`
Expected: PASS（全部用例通过，约 13 个）。

- [ ] **Step 5: Commit**

```bash
git add src/extension/services/versionStore.ts src/extension/services/versionStore.test.ts
git commit -m "feat(version): versionStore 纯逻辑模块 + 单元测试"
```

---

## Task 3: 消息协议 — version_list / restore_version / delete_version / export_version

**Files:**
- Modify: `src/shared/types/messages.types.ts`

- [ ] **Step 1: 引入 ReportVersionMeta 类型**

在 `src/shared/types/messages.types.ts` 顶部 import 区，将：

```ts
import type { SessionIndexEntry, ChatMessage } from './session.types';
```

替换为：

```ts
import type { SessionIndexEntry, ChatMessage, ReportVersionMeta } from './session.types';
```

- [ ] **Step 2: ExtensionToReport 新增 version_list**

在 `ExtensionToReport` 联合类型中，`| BaseMessage<'session_cleared', void>;` 行之前插入一行：

```ts
  | BaseMessage<'version_list', { versions: ReportVersionMeta[]; currentVersionId: string | null }>
```

- [ ] **Step 3: ReportToExtension 新增 3 个回传**

在 `ReportToExtension` 联合类型中，将 `| BaseMessage<'bom_export', void>;` 替换为：

```ts
  | BaseMessage<'bom_export', void>
  | BaseMessage<'restore_version', { versionId: string }>
  | BaseMessage<'delete_version', { versionId: string }>
  | BaseMessage<'export_version', { versionId: string; format: 'csv' | 'markdown' | 'json' }>;
```

- [ ] **Step 4: 类型检查**

Run: `npm run check-types`
Expected: PASS（零 tsc 错误；messages.types.ts 新增类型不应引入报错）。

- [ ] **Step 5: Commit**

```bash
git add src/shared/types/messages.types.ts
git commit -m "feat(types): 新增 version_list/restore/delete/export_version 消息类型"
```

---

## Task 4: SessionStorageService — loadSession 迁移规整

**Files:**
- Modify: `src/extension/services/SessionStorageService.ts`

- [ ] **Step 1: import migrateSessionVersions**

在 `src/extension/services/SessionStorageService.ts` 顶部，将：

```ts
import type { SessionData, SessionIndexEntry } from '@shared/types';
```

替换为：

```ts
import type { SessionData, SessionIndexEntry } from '@shared/types';
import { migrateSessionVersions } from './versionStore';
```

- [ ] **Step 2: 新增私有规整方法**

在 `loadSession` 方法之前，新增私有方法：

```ts
  /** 规整旧会话：补齐 versions 字段（仅内存，落盘交由下次正常写入） */
  private normalize(data: SessionData | null): SessionData | null {
    if (!data) return null;
    data.versions = migrateSessionVersions(data);
    return data;
  }
```

- [ ] **Step 3: loadSession 两个返回路径都过规整**

将现有 `loadSession`：

```ts
  async loadSession(id: string): Promise<SessionData | null> {
    const root = this.getStorageRoot();
    if (root) {
      const fileUri = vscode.Uri.joinPath(root, SESSIONS_DIR, `${id}.json`);
      return this.readJson<SessionData>(fileUri);
    }
    return this.context.globalState.get<SessionData | null>(`${GS_DATA_PREFIX}${id}`, null);
  }
```

替换为：

```ts
  async loadSession(id: string): Promise<SessionData | null> {
    const root = this.getStorageRoot();
    if (root) {
      const fileUri = vscode.Uri.joinPath(root, SESSIONS_DIR, `${id}.json`);
      return this.normalize(await this.readJson<SessionData>(fileUri));
    }
    return this.normalize(
      this.context.globalState.get<SessionData | null>(`${GS_DATA_PREFIX}${id}`, null),
    );
  }
```

- [ ] **Step 4: 类型检查**

Run: `npm run check-types`
Expected: PASS（零 tsc 错误；SessionStorageService 改动不引入新报错）。

- [ ] **Step 5: Commit**

```bash
git add src/extension/services/SessionStorageService.ts
git commit -m "feat(version): loadSession 迁移规整旧会话补齐 versions"
```

---

## Task 5: SessionManager — helper 抽取 + snapshot/restore/delete

**Files:**
- Modify: `src/extension/services/SessionManager.ts`

- [ ] **Step 1: 更新 import**

在 `src/extension/services/SessionManager.ts` 顶部，将：

```ts
import type { ChatMessage, SessionData, SessionIndexEntry, SessionArtifacts } from '@shared/types';
```

替换为：

```ts
import type { ChatMessage, SessionData, SessionIndexEntry, SessionArtifacts, ReportVersion, ReportVersionMeta } from '@shared/types';
import { appendVersion, findVersion, removeVersion, buildVersionLabel } from './versionStore';
```

- [ ] **Step 2: 新增内部状态字段**

在 `private inputMode: 'chat' | 'form' = 'chat';` 行之后新增：

```ts
  private currentVersionId: string | null = null;
```

- [ ] **Step 3: 新增两个私有 helper（DRY）**

在 `// ─── 公开 API ─────────────────────────────────────────` 注释行之前，新增：

```ts
  // ─── 内部 helper ──────────────────────────────────────

  /** 从 pipeline 缓存收集当前产物快照（与 saveCurrentSession 口径一致） */
  private collectCurrentArtifacts(): SessionArtifacts {
    return {
      requirementSpec: this.pipeline.lastSpec,
      overview: null, // deriveOverview 是纯函数，加载时重新派生
      bomItems: this.pipeline.lastBomItems,
      procurementItems: [],
      schematicIntent: this.pipeline.lastSchematic,
      pcbLayoutPlan: this.pipeline.lastPcbLayout,
      designReviewResult: null, // 暂不缓存在 pipeline 上（既有限制）
    };
  }

  /** 把一套产物推送到 Report（从 switchSession 提取，restore 复用） */
  private pushArtifactsToReport(a: SessionArtifacts): void {
    if (a.requirementSpec) {
      const overview = deriveOverview(a.requirementSpec);
      ReportPanelManager.openOrFocus(this.extensionUri);
      ReportPanelManager.postMessage({
        type: 'report_data',
        source: 'extension',
        payload: { report: { requirementSpec: a.requirementSpec, overview }, isStreaming: false },
        timestamp: Date.now(),
      });
    }
    if (a.bomItems.length > 0) {
      ReportPanelManager.postMessage({
        type: 'bom_data',
        source: 'extension',
        payload: { bomItems: a.bomItems, isStreaming: false },
        timestamp: Date.now(),
      });
    }
    if (a.procurementItems.length > 0) {
      ReportPanelManager.postMessage({
        type: 'procurement_data',
        source: 'extension',
        payload: { procurementItems: a.procurementItems },
        timestamp: Date.now(),
      });
    }
    if (a.schematicIntent) {
      ReportPanelManager.postMessage({
        type: 'schematic_data',
        source: 'extension',
        payload: { schematicIntent: a.schematicIntent },
        timestamp: Date.now(),
      });
    }
    if (a.pcbLayoutPlan) {
      ReportPanelManager.postMessage({
        type: 'pcb_layout_data',
        source: 'extension',
        payload: { pcbLayoutPlan: a.pcbLayoutPlan },
        timestamp: Date.now(),
      });
    }
    if (a.designReviewResult) {
      ReportPanelManager.postMessage({
        type: 'design_review_data',
        source: 'extension',
        payload: { designReviewResult: a.designReviewResult },
        timestamp: Date.now(),
      });
    }
  }

  /** 推送版本列表到 Report */
  private pushVersionList(data: SessionData): void {
    const versions: ReportVersionMeta[] = data.versions.map((v) => ({
      id: v.id,
      createdAt: v.createdAt,
      label: v.label,
    }));
    ReportPanelManager.postMessage({
      type: 'version_list',
      source: 'extension',
      payload: { versions, currentVersionId: this.currentVersionId },
      timestamp: Date.now(),
    });
  }
```

- [ ] **Step 4: 重写 saveCurrentSession（带 versions 透传 + 用 helper）**

将现有 `saveCurrentSession` 整个方法（从 `async saveCurrentSession(name?: string): Promise<string> {` 到其闭合 `}`）替换为：

```ts
  async saveCurrentSession(name?: string): Promise<string> {
    const now = new Date().toISOString();
    const id = this.currentSessionId ?? generateId();
    const existing = this.currentSessionId ? await this.storage.loadSession(id) : null;
    const sessionName = name
      ?? this.pipeline.lastSpec?.projectName?.value
      ?? (this.conversationMirror[0]?.content.slice(0, 30) || '未命名会话');

    const data: SessionData = {
      id,
      name: sessionName,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      conversation: [...this.conversationMirror],
      artifacts: this.collectCurrentArtifacts(),
      inputMode: this.inputMode,
      versions: existing?.versions ?? [],
    };

    await this.storage.saveSession(data);
    this.currentSessionId = id;

    this.panelProvider.postMessage({
      type: 'session_saved',
      source: 'extension',
      payload: { sessionId: id, name: sessionName },
      timestamp: Date.now(),
    });

    this.outputChannel.appendLine(`[SessionManager] saved session: ${id} (${sessionName})`);
    return id;
  }
```

- [ ] **Step 5: switchSession 内联产物推送改为调用 helper**

在现有 `switchSession` 中，将「推送产物到 Report」整段（从注释 `// 推送产物到 Report（复用现有消息类型）` 起，到最后一个 `if (data.artifacts.designReviewResult) { ... }` 块结束）整体替换为：

```ts
    // 推送产物到 Report（restore 复用同一 helper）
    this.currentVersionId = null;
    this.pushArtifactsToReport(data.artifacts);
    this.pushVersionList(data);
```

> 行为不变性说明：原内联逻辑与 `pushArtifactsToReport` 一一对应；新增 `pushVersionList` 让切换会话时版本栏同步刷新；`currentVersionId = null` 表示切换后处于「最新草稿」态。

- [ ] **Step 6: newSession 重置 currentVersionId**

在 `newSession` 方法中，`this.currentSessionId = null;` 行之后新增一行：

```ts
    this.currentVersionId = null;
```

- [ ] **Step 7: 新增 snapshotVersion / restoreVersion / deleteVersion**

在 `autoSave()` 方法之后、类闭合 `}` 之前，新增：

```ts
  /** 全管线完成：快照当前产物为新版本（最多 10，淘汰最旧） */
  async snapshotVersion(): Promise<void> {
    const id = await this.saveCurrentSession();
    const data = await this.storage.loadSession(id);
    if (!data) return;

    const createdAt = new Date().toISOString();
    const snapshot: ReportVersion = {
      id: generateId(),
      createdAt,
      label: buildVersionLabel(data.versions.length + 1, createdAt),
      artifacts: this.collectCurrentArtifacts(),
    };

    data.versions = appendVersion(data.versions, snapshot);
    data.artifacts = snapshot.artifacts; // 顶层镜像最新版
    data.updatedAt = createdAt;
    await this.storage.saveSession(data);

    this.currentVersionId = snapshot.id;
    this.pushVersionList(data);
    this.outputChannel.appendLine(`[SessionManager] snapshot version: ${snapshot.id} (${snapshot.label})`);
  }

  /** 恢复某版本为当前工作态（写回 pipeline 缓存 + 报告视图，不新增版本） */
  async restoreVersion(versionId: string): Promise<void> {
    if (!this.currentSessionId) return;
    const data = await this.storage.loadSession(this.currentSessionId);
    if (!data) return;
    const version = findVersion(data.versions, versionId);
    if (!version) {
      this.outputChannel.appendLine(`[SessionManager] restore: version not found ${versionId}`);
      return;
    }

    const a = version.artifacts;
    this.pipeline.lastSpec = a.requirementSpec;
    this.pipeline.lastBomItems = a.bomItems;
    this.pipeline.lastSchematic = a.schematicIntent;
    this.pipeline.lastPcbLayout = a.pcbLayoutPlan;

    data.artifacts = a; // 顶层镜像被恢复的版本
    data.updatedAt = new Date().toISOString();
    await this.storage.saveSession(data);

    this.currentVersionId = versionId;
    this.pushArtifactsToReport(a);
    this.pushVersionList(data);
    this.outputChannel.appendLine(`[SessionManager] restored version: ${versionId}`);
  }

  /** 删除某版本（不影响顶层当前草稿） */
  async deleteVersion(versionId: string): Promise<void> {
    if (!this.currentSessionId) return;
    const data = await this.storage.loadSession(this.currentSessionId);
    if (!data) return;
    data.versions = removeVersion(data.versions, versionId);
    if (this.currentVersionId === versionId) this.currentVersionId = null;
    data.updatedAt = new Date().toISOString();
    await this.storage.saveSession(data);
    this.pushVersionList(data);
    this.outputChannel.appendLine(`[SessionManager] deleted version: ${versionId}`);
  }
```

- [ ] **Step 8: 类型检查通过**

Run: `npm run check-types`
Expected: PASS（Task 1 的 stopgap 被本任务整体重写取代为 `existing?.versions ?? []`；全仓零 tsc 错误）。

- [ ] **Step 9: 回归测试**

Run: `npm test`
Expected: PASS（123 旧测试 + Task 2 的 versionStore 测试，全绿）。

- [ ] **Step 10: Commit**

```bash
git add src/extension/services/SessionManager.ts
git commit -m "feat(version): SessionManager snapshot/restore/delete + helper 抽取"
```

---

## Task 6: AiPipelineService — isRegenerating 守卫

**Files:**
- Modify: `src/extension/services/AiPipelineService.ts`

- [ ] **Step 1: 新增 isRegenerating 字段**

在 `src/extension/services/AiPipelineService.ts` 中，找到 `private isRunning = false;` 行，在其后新增一行：

```ts
  private isRegenerating = false;
```

- [ ] **Step 2: runDesignReviewStage 末尾守卫 onPipelineComplete**

在 `runDesignReviewStage` 中，将：

```ts
      this.onPipelineComplete?.();
```

替换为：

```ts
      if (!this.isRegenerating) this.onPipelineComplete?.();
```

> 这是该文件中唯一的 `this.onPipelineComplete?.()` 调用点（位于 `[Pipeline] design_review stage completed` 日志之后）。

- [ ] **Step 3: regenerateFrom 设置/复位标志**

在 `regenerateFrom` 方法中，将：

```ts
    this.isRunning = true;

    try {
```

替换为：

```ts
    this.isRunning = true;
    this.isRegenerating = true;

    try {
```

并将该方法的 `finally` 块：

```ts
    } finally {
      this.isRunning = false;
    }
```

替换为：

```ts
    } finally {
      this.isRunning = false;
      this.isRegenerating = false;
    }
```

- [ ] **Step 4: 类型检查 + 回归测试**

Run: `npm run check-types && npm test`
Expected: PASS（零 tsc 错误；全部测试通过）。

- [ ] **Step 5: 手动逻辑核验（记录在 commit message / progress）**

确认三条推理成立（无自动化测试，因 AiPipelineService 强耦合 vscode）：
1. 初始全管线：`runRequirementStage → ... → runDesignReviewStage`，`isRegenerating=false` → `onPipelineComplete` 触发 → 新版本。✓
2. `regenerateFrom('bom'|'schematic'|'pcbLayout'|'procurement')`：`isRegenerating=true`，即便 cascade 到 designReview 也被守卫拦截 → 不新增版本。✓
3. `regenerateFrom('designReview')`：进入 `runDesignReviewStage`，`isRegenerating=true` → 守卫拦截 → 不新增版本（activate.ts 的 `.then` 仍调 `autoSave` 更新草稿）。✓

- [ ] **Step 6: Commit**

```bash
git add src/extension/services/AiPipelineService.ts
git commit -m "feat(version): isRegenerating 守卫 — onPipelineComplete 收敛为初始全管线信号"
```

---

## Task 7: activate.ts — 接线 + 3 个 handler

**Files:**
- Modify: `src/extension/activate.ts`

- [ ] **Step 1: onPipelineComplete 改接 snapshotVersion**

在 `src/extension/activate.ts` 中，将：

```ts
  // 管线完成后自动保存会话
  pipeline.onPipelineComplete = () => {
    sessionManager.autoSave();
  };
```

替换为：

```ts
  // 初始全管线完成后：快照为新版本（regenerate 路径不走这里，见 isRegenerating 守卫）
  pipeline.onPipelineComplete = () => {
    sessionManager.snapshotVersion();
  };
```

- [ ] **Step 2: 新增 3 个 ReportToExtension handler**

在 `ReportPanelManager.onMessage` 的 `switch (message.type)` 中，找到 `case 'regenerate_stage': { ... }` 块的闭合 `}`（即 `break;` 后的 `}`），在其之后、`switch` 闭合 `}` 之前，新增：

```ts
      case 'restore_version':
        sessionManager.restoreVersion(message.payload.versionId);
        break;

      case 'delete_version':
        sessionManager.deleteVersion(message.payload.versionId);
        break;

      case 'export_version': {
        const { versionId, format } = message.payload;
        sessionManager.getVersionArtifacts(versionId).then((arts) => {
          if (!arts) {
            vscode.window.showWarningMessage('未找到该版本数据');
            return;
          }
          const pName = arts.requirementSpec?.projectName?.value ?? 'untitled';
          if (format === 'csv') {
            if (arts.bomItems.length > 0) {
              exportBomCsv(arts.bomItems);
            } else {
              vscode.window.showWarningMessage('该版本无 BOM 数据');
            }
          } else if (format === 'markdown') {
            exportMarkdown(arts, pName);
          } else if (format === 'json') {
            exportJson(arts, pName);
          }
        });
        break;
      }
```

> `export_version` 复用 Phase 6B 三个导出器（均内置 `showSaveDialog`，满足「另存到任意路径」），仅替换为指定版本 artifacts。需要 SessionManager 暴露按 id 取 artifacts 的方法 —— 见 Step 3。

- [ ] **Step 3: SessionManager 新增 getVersionArtifacts（供 export 使用）**

切到 `src/extension/services/SessionManager.ts`，在 `deleteVersion` 方法之后新增：

```ts
  /** 取某版本的产物快照（用于按版本导出），未找到返回 null */
  async getVersionArtifacts(versionId: string): Promise<SessionArtifacts | null> {
    if (!this.currentSessionId) return null;
    const data = await this.storage.loadSession(this.currentSessionId);
    if (!data) return null;
    return findVersion(data.versions, versionId)?.artifacts ?? null;
  }
```

- [ ] **Step 4: 类型检查 + 回归测试**

Run: `npm run check-types && npm test`
Expected: PASS（零 tsc 错误；测试全绿）。

- [ ] **Step 5: Commit**

```bash
git add src/extension/activate.ts src/extension/services/SessionManager.ts
git commit -m "feat(version): activate 接线 snapshotVersion + restore/delete/export_version handler"
```

---

## Task 8: reportStore.ts — versions 状态

**Files:**
- Modify: `src/webview/report/store/reportStore.ts`

- [ ] **Step 1: import 新类型**

将：

```ts
import type { RequirementSpec, OverviewData, BOMItem, ProcurementItem, SchematicIntent, PCBLayoutPlan, DesignReviewResult, ArtifactState } from '../../../shared/types';
```

替换为：

```ts
import type { RequirementSpec, OverviewData, BOMItem, ProcurementItem, SchematicIntent, PCBLayoutPlan, DesignReviewResult, ArtifactState, ReportVersionMeta } from '../../../shared/types';
```

- [ ] **Step 2: 接口新增字段与 setter**

在 `interface ReportState` 中，`artifactStatus: ArtifactState | null;` 行之后新增：

```ts
  versions: ReportVersionMeta[];
  currentVersionId: string | null;
```

并在 `setArtifactStatus: (state: ArtifactState) => void;` 行之后新增：

```ts
  setVersionList: (versions: ReportVersionMeta[], currentVersionId: string | null) => void;
```

- [ ] **Step 3: 初始值与实现**

在 `create<ReportState>` 初始值对象中，`artifactStatus: null,` 行之后新增：

```ts
  versions: [],
  currentVersionId: null,
```

在 `setArtifactStatus: (state) => set({ artifactStatus: state }),` 行之后新增：

```ts
  setVersionList: (versions, currentVersionId) => set({ versions, currentVersionId }),
```

在 `reset:` 的 `set({ ... })` 对象中，把 `artifactStatus: null,` 改为：

```ts
      artifactStatus: null, versions: [], currentVersionId: null,
```

- [ ] **Step 4: 类型检查**

Run: `npm run check-types`
Expected: PASS（store 无单测，靠 tsc + 下游使用验证）。

- [ ] **Step 5: Commit**

```bash
git add src/webview/report/store/reportStore.ts
git commit -m "feat(version): reportStore 新增 versions/currentVersionId 状态"
```

---

## Task 9: VersionBar 组件 + 样式

**Files:**
- Create: `src/webview/report/components/VersionBar.tsx`
- Create: `src/webview/report/components/VersionBar.css`

- [ ] **Step 1: 创建 VersionBar.css**

创建 `src/webview/report/components/VersionBar.css`：

```css
/* VersionBar — Report 顶部版本栏 */
.version-bar {
  display: flex;
  align-items: center;
  gap: var(--eda-space-2);
  padding: var(--eda-space-2) var(--eda-space-3);
  background-color: var(--eda-bg-secondary);
  border-bottom: 1px solid var(--eda-border);
  font-size: 0.85em;
}

.version-bar__label {
  color: var(--eda-status-muted);
  flex-shrink: 0;
}

.version-bar__select {
  flex: 1;
  min-width: 0;
  padding: 2px 6px;
  background-color: var(--eda-bg-primary);
  color: inherit;
  border: 1px solid var(--eda-border);
  border-radius: var(--eda-radius-sm);
}

.version-bar__btn {
  padding: 2px 10px;
  border: 1px solid var(--eda-border);
  border-radius: var(--eda-radius-sm);
  background: transparent;
  color: inherit;
  cursor: pointer;
  white-space: nowrap;
}

.version-bar__btn:hover {
  background-color: var(--eda-bg-hover);
}

.version-bar__btn--danger:hover {
  border-color: var(--eda-status-critical);
  color: var(--eda-status-critical);
}
```

- [ ] **Step 2: 创建 VersionBar.tsx**

创建 `src/webview/report/components/VersionBar.tsx`：

```tsx
/** Report 顶部版本栏：切换/删除/另存历史报告版本 */
import React from 'react';
import { createMessage } from '../../../shared/types';
import vscodeApi from '../../shared/vscodeApi';
import { useReportStore } from '../store/reportStore';
import './VersionBar.css';

export function VersionBar(): React.ReactElement | null {
  const versions = useReportStore((s) => s.versions);
  const currentVersionId = useReportStore((s) => s.currentVersionId);

  if (versions.length === 0) return null;

  const selectedId = currentVersionId ?? versions[versions.length - 1].id;

  const handleSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    vscodeApi.postMessage(
      createMessage('restore_version', 'report', { versionId: e.target.value }),
    );
  };

  const handleDelete = () => {
    if (!window.confirm('删除该版本？此操作不可撤销。')) return;
    vscodeApi.postMessage(
      createMessage('delete_version', 'report', { versionId: selectedId }),
    );
  };

  const handleExport = (format: 'csv' | 'markdown' | 'json') => {
    vscodeApi.postMessage(
      createMessage('export_version', 'report', { versionId: selectedId, format }),
    );
  };

  return (
    <div className="version-bar">
      <span className="version-bar__label">报告版本</span>
      <select
        className="version-bar__select"
        value={selectedId}
        onChange={handleSelect}
        aria-label="选择报告版本"
      >
        {versions.map((v) => (
          <option key={v.id} value={v.id}>{v.label}</option>
        ))}
      </select>
      <button className="version-bar__btn" onClick={() => handleExport('markdown')}>另存 MD</button>
      <button className="version-bar__btn" onClick={() => handleExport('json')}>另存 JSON</button>
      <button className="version-bar__btn" onClick={() => handleExport('csv')}>另存 CSV</button>
      <button className="version-bar__btn version-bar__btn--danger" onClick={handleDelete}>删除此版</button>
    </div>
  );
}
```

- [ ] **Step 3: 类型检查**

Run: `npm run check-types`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add src/webview/report/components/VersionBar.tsx src/webview/report/components/VersionBar.css
git commit -m "feat(version): VersionBar 组件 + 样式"
```

---

## Task 10: ReportApp.tsx — 集成 VersionBar + 处理 version_list

**Files:**
- Modify: `src/webview/report/ReportApp.tsx`

- [ ] **Step 1: import VersionBar**

在 import 区，`import { DesignReviewSection } from './components/DesignReviewSection';` 行之后新增：

```ts
import { VersionBar } from './components/VersionBar';
```

- [ ] **Step 2: 从 store 取 setVersionList**

将：

```ts
    setArtifactStatus, artifactStatus,
  } = useReportStore();
```

替换为：

```ts
    setArtifactStatus, artifactStatus, setVersionList,
  } = useReportStore();
```

- [ ] **Step 3: 处理 version_list 消息**

在 `handler` 的 `switch (msg.type)` 中，`case 'session_cleared':` 之前新增：

```ts
        case 'version_list':
          setVersionList(msg.payload.versions, msg.payload.currentVersionId);
          break;
```

并把 `useEffect` 依赖数组末尾的 `reset]` 改为 `reset, setVersionList]`：

```ts
  }, [setRequirementSpec, setOverview, setBomItems, setProcurementItems, setSchematicIntent, setPcbLayoutPlan, setDesignReviewResult, appendStreamContent, setIsStreaming, setArtifactStatus, reset, setVersionList]);
```

- [ ] **Step 4: 在顶部渲染 VersionBar**

将：

```tsx
  return (
    <div className="report-container">
      <nav className="report-tabs" role="tablist">
```

替换为：

```tsx
  return (
    <div className="report-container">
      <VersionBar />
      <nav className="report-tabs" role="tablist">
```

- [ ] **Step 5: 编译（tsc + esbuild 三入口）**

Run: `npm run compile`
Expected: PASS（`tsc --noEmit` 零错误 + esbuild 构建 extension/panel/report 三入口成功）。

- [ ] **Step 6: Commit**

```bash
git add src/webview/report/ReportApp.tsx
git commit -m "feat(version): ReportApp 集成 VersionBar + 处理 version_list 消息"
```

---

## Task 11: 终检 + 文档同步 + 打包

**Files:**
- Modify: `progress.txt`
- Modify: `docs/IMPLEMENTATION_PLAN.md`

- [ ] **Step 1: 全量门禁**

Run: `npm run compile && npm test`
Expected: `tsc` 零错误；esbuild 三入口成功；测试全绿（123 旧 + versionStore 约 13 新 ≈ 136）。

- [ ] **Step 2: 打包验证**

Run: `npx @vscode/vsce package`
Expected: 成功生成 `.vsix`（9 files），无报错。

- [ ] **Step 3: 更新 progress.txt**

在 `progress.txt` 文件末尾（`### 下一步` 小节之前）追加一节：

```markdown
## 2026-05-18

### Phase 7 — 报告版本管理 ✅

**范围**：会话内报告版本历史。全管线完成自动快照、最多 10 版淘汰最旧、Report 顶部 VersionBar 切换/删除/另存。多方案对比、代码分析输入明确不在本轮。

**新增**：
- versionStore.ts 纯逻辑（appendVersion/findVersion/removeVersion/buildVersionLabel/migrateSessionVersions）+ 单测约 13 例
- SessionData.versions[] + ReportVersion/ReportVersionMeta 类型
- SessionManager: snapshotVersion/restoreVersion/deleteVersion/getVersionArtifacts + pushArtifactsToReport/collectCurrentArtifacts/pushVersionList helper（switchSession DRY 复用）
- AiPipelineService: isRegenerating 守卫，onPipelineComplete 收敛为初始全管线信号
- SessionStorageService: loadSession 迁移规整旧会话补齐 versions
- 消息协议: version_list / restore_version / delete_version / export_version
- VersionBar.tsx + .css；reportStore versions 状态；ReportApp 集成

**触发机制**：初始全管线完成 → snapshotVersion（新版本）；regenerate（含 cascade/designReview）经 isRegenerating 守卫 → 仅 autoSave 更新草稿不新增版本；restore 恢复为当前工作态不新增版本。

**§13.5 步骤 7 自检清单**：
- [x] npm run compile（tsc 零错误 + esbuild 三入口）
- [x] npm test（全绿，123 + versionStore）
- [x] npx @vscode/vsce package 成功
- [x] 无 console.log 残留
- [x] progress.txt / IMPLEMENTATION_PLAN.md 已更新
- [x] 分支 feat/phase7/report-version-management（worktree 开发）

### 下一步
```

> 注意：上面追加内容里保留了原有的 `### 下一步` 标题；实际编辑时把新内容插入到原 `### 下一步` 之前，使其仍位于文件末尾。原 `### 下一步` 下的两条（Phase 7 本地存储... / Session 单测）改为：保留「SessionStorageService / SessionManager 单元测试补充」「多方案对比（后续单独立项）」「代码分析输入（原 Phase 8，后续单独立项）」。

- [ ] **Step 4: 更新 IMPLEMENTATION_PLAN.md §9.5 验收勾选**

在 `docs/IMPLEMENTATION_PLAN.md` §9.5 验收标准中，将本轮已覆盖项打勾：

```text
- [x] 生成报告后自动保存到 `.ai-eda/{项目名}/`（按会话存储，全管线完成快照版本）
- [x] 重新打开 VS Code 后可加载历史报告
- [x] 版本列表显示最近 10 个版本，超出自动淘汰最旧
- [x] 用户可手动删除版本 / 另存到任意路径
- [ ] 多方案并排对比显示 BOM 差异（后续单独立项，不在本轮）
- [x] 对话历史保留并可回看
- [x] 导出 Markdown / JSON / CSV 文件名符合命名规则
```

- [ ] **Step 5: Commit**

```bash
git add progress.txt docs/IMPLEMENTATION_PLAN.md
git commit -m "docs: Phase 7 报告版本管理 progress + 验收勾选"
```

- [ ] **Step 6: 收尾**

调用 `superpowers:finishing-a-development-branch` 决定合并/PR/清理（worktree 分支 `feat/phase7/report-version-management` → main，沿用项目 `--no-ff` 合并惯例由用户确认）。

---

## Self-Review（计划编写者已执行）

**1. Spec 覆盖**：§3 触发机制→Task 6；§4 数据模型→Task 1；§4.2 迁移→Task 2(migrateSessionVersions)+Task 4；§5 versionStore→Task 2；§6 SessionManager→Task 5+7；§7 消息协议→Task 3；§8 导出→Task 7(已按核实简化)；§9 前端→Task 8/9/10；§12 测试→Task 2 + 各任务门禁；§13 验收→Task 11。无遗漏。多方案对比/代码分析已在 spec 明确排除，无需任务。

**2. 占位符扫描**：无 TBD/TODO；每个改代码步骤均含完整代码与确切替换锚点；命令均给出预期输出。

**3. 类型/签名一致性**：`ReportVersion`/`ReportVersionMeta`（Task 1 定义）在 Task 2/3/5/8 一致使用；`appendVersion/findVersion/removeVersion/buildVersionLabel/migrateSessionVersions`（Task 2 定义）在 Task 4/5 调用名一致；`snapshotVersion/restoreVersion/deleteVersion/getVersionArtifacts`（Task 5/7 定义）与 activate.ts handler（Task 7）调用一致；消息 `version_list/restore_version/delete_version/export_version`（Task 3）在 SessionManager 推送（Task 5）、activate handler（Task 7）、VersionBar/ReportApp（Task 9/10）端到端一致。

**每提交可编译**：Task 1 含一行 SessionManager stopgap（`versions: []`），保证类型变更落地后每次提交均通过 `npm run check-types`；Task 5 整体重写该方法时自然取代 stopgap 为 `existing?.versions ?? []`。无不可编译的中间状态。
