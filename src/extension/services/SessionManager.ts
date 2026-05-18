/**
 * 会话管理器 — 编排 Storage / Pipeline / Webview 之间的会话生命周期
 *
 * 职责：
 * - 维护对话镜像（extension 侧同步一份对话记录）
 * - 保存 / 加载 / 新建 / 切换会话
 * - 管线完成后自动保存
 */
import type * as vscode from 'vscode';
import type { ChatMessage, SessionData, SessionIndexEntry, SessionArtifacts } from '@shared/types';
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

  // ─── 公开 API ─────────────────────────────────────────

  async listSessions(): Promise<SessionIndexEntry[]> {
    return this.storage.listSessions();
  }

  async saveCurrentSession(name?: string): Promise<string> {
    const now = new Date().toISOString();
    const id = this.currentSessionId ?? generateId();
    const sessionName = name
      ?? this.pipeline.lastSpec?.projectName?.value
      ?? (this.conversationMirror[0]?.content.slice(0, 30) || '未命名会话');

    const artifacts: SessionArtifacts = {
      requirementSpec: this.pipeline.lastSpec,
      overview: null, // deriveOverview 是纯函数，加载时可重新派生
      bomItems: this.pipeline.lastBomItems,
      procurementItems: [],
      schematicIntent: this.pipeline.lastSchematic,
      pcbLayoutPlan: this.pipeline.lastPcbLayout,
      designReviewResult: null, // 暂不缓存在 pipeline 上
    };

    const data: SessionData = {
      id,
      name: sessionName,
      createdAt: this.currentSessionId ? (await this.storage.loadSession(id))?.createdAt ?? now : now,
      updatedAt: now,
      conversation: [...this.conversationMirror],
      artifacts,
      inputMode: this.inputMode,
      versions: [], // stopgap（后续任务整体重写为透传已有 versions）
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

  async newSession(): Promise<void> {
    // 自动保存当前会话（如果有对话内容）
    if (this.conversationMirror.length > 0) {
      await this.saveCurrentSession();
    }

    // 清空状态
    this.currentSessionId = null;
    this.conversationMirror = [];
    this.inputMode = 'chat';
    this.pipeline.lastSpec = null;
    this.pipeline.lastBomItems = [];
    this.pipeline.lastSchematic = null;
    this.pipeline.lastPcbLayout = null;
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

    // 恢复 pipeline 缓存
    this.pipeline.lastSpec = data.artifacts.requirementSpec;
    this.pipeline.lastBomItems = data.artifacts.bomItems;
    this.pipeline.lastSchematic = data.artifacts.schematicIntent;
    this.pipeline.lastPcbLayout = data.artifacts.pcbLayoutPlan;

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

    // 推送产物到 Report（复用现有消息类型）
    if (data.artifacts.requirementSpec) {
      const overview = deriveOverview(data.artifacts.requirementSpec);
      ReportPanelManager.openOrFocus(this.extensionUri);
      ReportPanelManager.postMessage({
        type: 'report_data',
        source: 'extension',
        payload: { report: { requirementSpec: data.artifacts.requirementSpec, overview }, isStreaming: false },
        timestamp: Date.now(),
      });
    }
    if (data.artifacts.bomItems.length > 0) {
      ReportPanelManager.postMessage({
        type: 'bom_data',
        source: 'extension',
        payload: { bomItems: data.artifacts.bomItems, isStreaming: false },
        timestamp: Date.now(),
      });
    }
    if (data.artifacts.procurementItems.length > 0) {
      ReportPanelManager.postMessage({
        type: 'procurement_data',
        source: 'extension',
        payload: { procurementItems: data.artifacts.procurementItems },
        timestamp: Date.now(),
      });
    }
    if (data.artifacts.schematicIntent) {
      ReportPanelManager.postMessage({
        type: 'schematic_data',
        source: 'extension',
        payload: { schematicIntent: data.artifacts.schematicIntent },
        timestamp: Date.now(),
      });
    }
    if (data.artifacts.pcbLayoutPlan) {
      ReportPanelManager.postMessage({
        type: 'pcb_layout_data',
        source: 'extension',
        payload: { pcbLayoutPlan: data.artifacts.pcbLayoutPlan },
        timestamp: Date.now(),
      });
    }
    if (data.artifacts.designReviewResult) {
      ReportPanelManager.postMessage({
        type: 'design_review_data',
        source: 'extension',
        payload: { designReviewResult: data.artifacts.designReviewResult },
        timestamp: Date.now(),
      });
    }

    this.outputChannel.appendLine(`[SessionManager] switched to session: ${id} (${data.name})`);
  }

  async deleteSession(id: string): Promise<void> {
    await this.storage.deleteSession(id);
    if (this.currentSessionId === id) {
      this.currentSessionId = null;
    }
    this.outputChannel.appendLine(`[SessionManager] deleted session: ${id}`);
  }

  async autoSave(): Promise<void> {
    await this.saveCurrentSession();
    this.outputChannel.appendLine('[SessionManager] auto-saved after pipeline completion');
  }
}
