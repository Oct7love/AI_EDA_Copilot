/**
 * 插件入口，注册 Provider / 命令 / 消息路由 / 会话管理，不含业务逻辑
 */
import * as vscode from 'vscode';
import { SidePanelProvider } from './providers/SidePanelProvider';
import { ReportPanelManager } from './providers/ReportPanelManager';
import { InputService } from './services/InputService';
import { AiPipelineService } from './services/AiPipelineService';
import { SessionStorageService } from './services/SessionStorageService';
import { SessionManager } from './services/SessionManager';
import { exportBomCsv } from './export/bomCsvExporter';
import { exportMarkdown } from './export/markdownExporter';
import { exportJson } from './export/jsonExporter';
import { registerCommands } from './commands';
import { ArtifactStateService } from './services/ArtifactStateService';
import { deriveOverview } from './services/overviewDeriver';
import type { RequirementField, ArtifactKey, SessionArtifacts } from '@shared/types';

const EXTENSION_ID = 'ai-eda-copilot';

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel('AI EDA Copilot');
  outputChannel.appendLine(`[${EXTENSION_ID}] activated`);

  const inputService = new InputService();

  // ── Side Panel Provider ──
  const sidePanelProvider = new SidePanelProvider(context.extensionUri);

  // ── AI 管线服务 ──
  const pipeline = new AiPipelineService(
    context.secrets,
    context.extensionUri,
    outputChannel,
    sidePanelProvider,
  );

  // ── Artifact 状态管理 ──
  const artifactState = new ArtifactStateService();
  artifactState.onStateChange = (state) => {
    ReportPanelManager.postMessage({
      type: 'artifact_status',
      source: 'extension',
      payload: { state },
      timestamp: Date.now(),
    });
  };

  // ── 会话管理 ──
  const sessionStorage = new SessionStorageService(context);
  const sessionManager = new SessionManager(
    sessionStorage,
    pipeline,
    sidePanelProvider,
    context.extensionUri,
    outputChannel,
  );

  // 注入 ArtifactStateService 到 SessionManager
  sessionManager.setArtifactStateService(artifactState);

  // 初始全管线完成后：快照为新版本（regenerate 路径不走这里，见 isRegenerating 守卫）
  pipeline.onPipelineComplete = () => {
    sessionManager.snapshotVersion();
  };

  // 拦截 assistant 消息用于对话镜像
  sidePanelProvider.addMessageInterceptor((msg) => {
    if (msg.type === 'ai_chat_response' && !msg.payload.isStreaming) {
      sessionManager.mirrorAssistantMessage(msg.payload.content);
    }
  });

  // ── Side Panel 消息路由 ──
  sidePanelProvider.onMessage((message) => {
    outputChannel.appendLine(`[panel→ext] ${message.type}`);

    switch (message.type) {
      case 'open_report':
        ReportPanelManager.openOrFocus(context.extensionUri);
        break;

      case 'submit_requirement': {
        const { text, mode } = message.payload;
        const request = mode === 'form'
          ? inputService.fromForm(JSON.parse(text))
          : inputService.fromNaturalLanguage(text);

        // 对话镜像：记录用户消息
        sessionManager.mirrorUserMessage(text);
        sessionManager.setInputMode(mode);

        outputChannel.appendLine(`[InputService] ${request.inputType} → rawText=${request.rawText?.slice(0, 80)}`);
        pipeline.runRequirementStage(request);
        break;
      }

      case 'select_template': {
        const request = inputService.fromTemplate(message.payload.templateId);
        sessionManager.mirrorUserMessage(`[模板] ${message.payload.templateId}`);
        outputChannel.appendLine(`[InputService] template → ${request.templateId}`);
        pipeline.runRequirementStage(request);
        break;
      }

      // ── 会话管理消息 ──
      case 'session_list':
        sessionManager.listSessions().then((sessions) => {
          sidePanelProvider.postMessage({
            type: 'session_list_response',
            source: 'extension',
            payload: { sessions },
            timestamp: Date.now(),
          });
        });
        break;

      case 'session_save':
        sessionManager.saveCurrentSession(message.payload?.name);
        break;

      case 'session_new':
        sessionManager.newSession();
        break;

      case 'session_switch':
        sessionManager.switchSession(message.payload.sessionId);
        break;

      case 'session_delete':
        sessionManager.deleteSession(message.payload.sessionId).then(() => {
          // 删除后刷新列表
          sessionManager.listSessions().then((sessions) => {
            sidePanelProvider.postMessage({
              type: 'session_list_response',
              source: 'extension',
              payload: { sessions },
              timestamp: Date.now(),
            });
          });
        });
        break;

      case 'session_rename':
        sessionStorage.renameSession(message.payload.sessionId, message.payload.name).then(() => {
          sessionManager.listSessions().then((sessions) => {
            sidePanelProvider.postMessage({
              type: 'session_list_response',
              source: 'extension',
              payload: { sessions },
              timestamp: Date.now(),
            });
          });
        });
        break;
    }
  });

  const sidePanelRegistration = vscode.window.registerWebviewViewProvider(
    SidePanelProvider.viewType,
    sidePanelProvider,
    { webviewOptions: { retainContextWhenHidden: true } }
  );

  // ── 导出辅助：从管线缓存收集产物 ──
  const collectArtifacts = (): SessionArtifacts => ({
    requirementSpec: pipeline.lastSpec,
    overview: pipeline.lastSpec ? deriveOverview(pipeline.lastSpec) : null,
    bomItems: pipeline.lastBomItems,
    procurementItems: [],
    schematicIntent: pipeline.lastSchematic,
    pcbLayoutPlan: pipeline.lastPcbLayout,
    designReviewResult: null,
  });

  // ── Report Panel 消息路由 ──
  ReportPanelManager.onMessage((message) => {
    outputChannel.appendLine(`[report→ext] ${message.type}`);

    switch (message.type) {
      case 'export_request': {
        const format = message.payload.format;
        const pName = pipeline.lastSpec?.projectName?.value ?? 'untitled';
        if (format === 'csv') {
          if (pipeline.lastBomItems.length > 0) {
            exportBomCsv(pipeline.lastBomItems);
          } else {
            vscode.window.showWarningMessage('暂无 BOM 数据，请先运行分析');
          }
        } else if (format === 'markdown') {
          const arts = collectArtifacts();
          exportMarkdown(arts, pName);
        } else if (format === 'json') {
          const arts = collectArtifacts();
          exportJson(arts, pName);
        }
        break;
      }
      case 'open_external_link':
        vscode.env.openExternal(vscode.Uri.parse(message.payload.url));
        break;
      case 'bom_export':
        if (pipeline.lastBomItems.length > 0) {
          exportBomCsv(pipeline.lastBomItems);
        } else {
          vscode.window.showWarningMessage('暂无 BOM 数据，请先运行分析');
        }
        break;

      case 'requirement_edit': {
        const { field, value } = message.payload;
        if (!pipeline.lastSpec) {
          outputChannel.appendLine('[requirement_edit] no spec to edit');
          break;
        }
        // 更新 lastSpec 中对应字段
        const spec = pipeline.lastSpec as unknown as Record<string, unknown>;
        const fieldObj = spec[field];
        if (fieldObj && typeof fieldObj === 'object' && 'value' in (fieldObj as RequirementField)) {
          const rf = fieldObj as RequirementField;
          rf.value = value as string;
          rf.source = 'user_provided';
          rf.status = 'confirmed';
          rf.confidence = 1.0;
        }

        // 重新派生 overview 并推送
        const overview = deriveOverview(pipeline.lastSpec);
        ReportPanelManager.postMessage({
          type: 'report_data',
          source: 'extension',
          payload: { report: { requirementSpec: pipeline.lastSpec, overview }, isStreaming: false },
          timestamp: Date.now(),
        });

        // 级联标记下游 stale
        artifactState.markStale('requirement');
        outputChannel.appendLine(`[requirement_edit] field=${field}, downstream marked stale`);
        break;
      }

      case 'regenerate_stage': {
        const { stage } = message.payload;
        outputChannel.appendLine(`[regenerate] stage=${stage}, mode=${message.payload.mode}`);

        artifactState.markGenerating(stage);

        // 接线：阶段完成后标记 valid
        pipeline.onStageComplete = (completedStage: ArtifactKey) => {
          artifactState.markValid(completedStage);
        };

        pipeline.regenerateFrom(stage).then(() => {
          outputChannel.appendLine(`[regenerate] ${stage} completed`);
          sessionManager.autoSave();
        }).catch((err) => {
          artifactState.markError(stage);
          outputChannel.appendLine(`[regenerate] ${stage} error: ${err}`);
        });
        break;
      }

      case 'restore_version':
        sessionManager.restoreVersion(message.payload.versionId).catch((err) => {
          vscode.window.showErrorMessage(`恢复版本失败: ${err}`);
          outputChannel.appendLine(`[restore_version] error: ${err}`);
        });
        break;

      case 'delete_version':
        sessionManager.deleteVersion(message.payload.versionId).catch((err) => {
          vscode.window.showErrorMessage(`删除版本失败: ${err}`);
          outputChannel.appendLine(`[delete_version] error: ${err}`);
        });
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
    }
  });

  // ── 命令注册 ──
  const commands = registerCommands(context);

  // ── 生命周期 ──
  context.subscriptions.push(
    outputChannel,
    sidePanelRegistration,
    ...commands
  );
}

export function deactivate(): void {
  // 清理逻辑（当前无需）
}
