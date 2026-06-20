/**
 * 会话管理器 — 编排 Storage / Pipeline / Webview 之间的会话生命周期
 *
 * 职责：
 * - 维护对话镜像（extension 侧同步一份对话记录）
 * - 保存 / 加载 / 新建 / 切换会话
 * - 管线完成后自动保存
 */
import type * as vscode from 'vscode';
import type { ChatMessage, SessionData, SessionIndexEntry, SessionArtifacts, ReportVersion, ReportVersionMeta } from '@shared/types';
import { appendVersion, findVersion, removeVersion, buildVersionLabel } from './versionStore';
import { collectArtifacts, normalizeArtifacts } from './artifactCollector';
import type { SessionStorageService } from './SessionStorageService';
import type { AiPipelineService } from './AiPipelineService';
import type { ArtifactStateService } from './ArtifactStateService';
import type { SidePanelProvider } from '../providers/SidePanelProvider';
import { ReportPanelManager } from '../providers/ReportPanelManager';
import { deriveOverview } from './overviewDeriver';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class SessionManager {
  private currentSessionId: string | null = null;
  private conversationMirror: ChatMessage[] = [];
  private inputMode: 'chat' | 'form' = 'chat';
  private currentVersionId: string | null = null;

  private artifactState?: ArtifactStateService;

  constructor(
    private readonly storage: SessionStorageService,
    private readonly pipeline: AiPipelineService,
    private readonly panelProvider: SidePanelProvider,
    private readonly extensionUri: vscode.Uri,
    private readonly outputChannel: vscode.OutputChannel,
  ) {}

  /** 注入 ArtifactStateService（由 activate.ts 调用） */
  setArtifactStateService(svc: ArtifactStateService): void {
    this.artifactState = svc;
  }

  // ─── 对话镜像 ─────────────────────────────────────────

  mirrorUserMessage(content: string): void {
    this.conversationMirror.push({
      id: generateId(),
      role: 'user',
      content,
      timestamp: Date.now(),
    });
  }

  mirrorAssistantMessage(content: string): void {
    this.conversationMirror.push({
      id: generateId(),
      role: 'assistant',
      content,
      timestamp: Date.now(),
    });
  }

  setInputMode(mode: 'chat' | 'form'): void {
    this.inputMode = mode;
  }

  // ─── 内部 helper ──────────────────────────────────────

  /** 会话保存失败：记录日志并向 Panel 推送错误，让 UI 感知写盘失败 */
  private reportSaveFailure(where: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.outputChannel.appendLine(`[SessionManager] ${where} save failed: ${message}`);
    this.panelProvider.postMessage({
      type: 'error',
      source: 'extension',
      payload: { code: 'SAVE_FAILED', message: '会话保存失败' },
      timestamp: Date.now(),
    });
  }

  /** 从 pipeline 缓存收集当前产物快照（含 procurement / designReview / overview） */
  private collectCurrentArtifacts(): SessionArtifacts {
    return collectArtifacts({
      requirementSpec: this.pipeline.lastSpec,
      bomItems: this.pipeline.lastBomItems,
      procurementItems: this.pipeline.lastProcurementItems,
      schematicIntent: this.pipeline.lastSchematic,
      pcbLayoutPlan: this.pipeline.lastPcbLayout,
      designReviewResult: this.pipeline.lastDesignReviewResult,
    });
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

  /**
   * 计算下一个版本展示编号：取现有 versions 中已用的最大 vN 之上 +1。
   * 单调递增，不因 10 上限淘汰最旧而回退。空数组返回 1。
   */
  private nextVersionIndex(versions: ReportVersion[]): number {
    let max = 0;
    for (const v of versions) {
      const m = /^v(\d+) /.exec(v.label);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
    return max + 1;
  }

  // ─── 公开 API ─────────────────────────────────────────

  async listSessions(): Promise<SessionIndexEntry[]> {
    return this.storage.listSessions();
  }

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

    try {
      await this.storage.saveSession(data);
    } catch (err) {
      this.reportSaveFailure('saveCurrentSession', err);
      throw err;
    }
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

  async newSession(): Promise<void> {
    // 自动保存当前会话（如果有对话内容）
    if (this.conversationMirror.length > 0) {
      await this.saveCurrentSession();
    }

    // 清空状态
    this.currentSessionId = null;
    this.currentVersionId = null;
    this.conversationMirror = [];
    this.inputMode = 'chat';
    this.pipeline.lastSpec = null;
    this.pipeline.lastBomItems = [];
    this.pipeline.lastProcurementItems = [];
    this.pipeline.lastSchematic = null;
    this.pipeline.lastPcbLayout = null;
    this.pipeline.lastDesignReviewResult = null;
    this.artifactState?.resetAll();

    // 通知 Panel 和 Report 清空
    this.panelProvider.postMessage({
      type: 'session_cleared',
      source: 'extension',
      payload: undefined as never,
      timestamp: Date.now(),
    });
    ReportPanelManager.postMessage({
      type: 'session_cleared',
      source: 'extension',
      payload: undefined as never,
      timestamp: Date.now(),
    });

    this.outputChannel.appendLine('[SessionManager] new session created');
  }

  async switchSession(id: string): Promise<void> {
    // 自动保存当前会话
    if (this.conversationMirror.length > 0 && this.currentSessionId !== id) {
      await this.saveCurrentSession();
    }

    const data = await this.storage.loadSession(id);
    if (!data) {
      this.outputChannel.appendLine(`[SessionManager] session not found: ${id}`);
      return;
    }

    // 恢复内部状态
    this.currentSessionId = id;
    this.conversationMirror = [...data.conversation];
    this.inputMode = data.inputMode;

    // 恢复 pipeline 缓存（规整旧/缺字段快照，避免后续访问崩溃 + 找回 procurement/designReview）
    const arts = normalizeArtifacts(data.artifacts);
    this.pipeline.lastSpec = arts.requirementSpec;
    this.pipeline.lastBomItems = arts.bomItems;
    this.pipeline.lastProcurementItems = arts.procurementItems;
    this.pipeline.lastSchematic = arts.schematicIntent;
    this.pipeline.lastPcbLayout = arts.pcbLayoutPlan;
    this.pipeline.lastDesignReviewResult = arts.designReviewResult;

    // 推送对话到 Panel
    this.panelProvider.postMessage({
      type: 'session_loaded',
      source: 'extension',
      payload: {
        sessionId: id,
        name: data.name,
        conversation: data.conversation,
        inputMode: data.inputMode,
        formData: data.formData,
      },
      timestamp: Date.now(),
    });

    // 推送产物到 Report（restore 复用同一 helper）
    this.currentVersionId = null;
    this.pushArtifactsToReport(arts);
    this.pushVersionList(data);

    this.outputChannel.appendLine(`[SessionManager] switched to session: ${id} (${data.name})`);
  }

  async deleteSession(id: string): Promise<void> {
    await this.storage.deleteSession(id);
    if (this.currentSessionId === id) {
      this.currentSessionId = null;
      this.currentVersionId = null;
    }
    this.outputChannel.appendLine(`[SessionManager] deleted session: ${id}`);
  }

  async autoSave(): Promise<void> {
    await this.saveCurrentSession();
    this.outputChannel.appendLine('[SessionManager] auto-saved after pipeline completion');
  }

  /** 全管线完成：快照当前产物为新版本（最多 10，淘汰最旧） */
  async snapshotVersion(): Promise<void> {
    const id = await this.saveCurrentSession();
    const data = await this.storage.loadSession(id);
    if (!data) return;

    const createdAt = new Date().toISOString();
    const snapshot: ReportVersion = {
      id: generateId(),
      createdAt,
      label: buildVersionLabel(this.nextVersionIndex(data.versions), createdAt),
      artifacts: this.collectCurrentArtifacts(),
    };

    data.versions = appendVersion(data.versions, snapshot);
    data.artifacts = snapshot.artifacts; // 顶层镜像最新版
    data.updatedAt = createdAt;
    try {
      await this.storage.saveSession(data);
    } catch (err) {
      this.reportSaveFailure('snapshotVersion', err);
      throw err;
    }

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

    const a = normalizeArtifacts(version.artifacts);
    this.pipeline.lastSpec = a.requirementSpec;
    this.pipeline.lastBomItems = a.bomItems;
    this.pipeline.lastProcurementItems = a.procurementItems;
    this.pipeline.lastSchematic = a.schematicIntent;
    this.pipeline.lastPcbLayout = a.pcbLayoutPlan;
    this.pipeline.lastDesignReviewResult = a.designReviewResult;

    data.artifacts = { ...a }; // 顶层镜像被恢复的版本（浅拷贝，与版本内 artifacts 解耦引用）
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

  /**
   * 重建会话索引（自愈）：扫描磁盘会话文件重建 sessions.json，把孤儿折回索引。
   * 损坏文件被跳过、不删除。结果记日志，供未来命令调用；此处不接任何 UI/命令。
   */
  async rebuildSessionIndex(): Promise<{ rebuilt: number; skipped: number }> {
    const result = await this.storage.rebuildIndex();
    this.outputChannel.appendLine(
      `[SessionManager] rebuilt session index: rebuilt=${result.rebuilt} skipped=${result.skipped}`,
    );
    return result;
  }

  /** 取某版本的产物快照（用于按版本导出），未找到返回 null */
  async getVersionArtifacts(versionId: string): Promise<SessionArtifacts | null> {
    if (!this.currentSessionId) return null;
    const data = await this.storage.loadSession(this.currentSessionId);
    if (!data) return null;
    const found = findVersion(data.versions, versionId);
    return found ? normalizeArtifacts(found.artifacts) : null;
  }
}
