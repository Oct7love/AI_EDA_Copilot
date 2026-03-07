import * as vscode from 'vscode';
import { SidePanelProvider } from './providers/SidePanelProvider';
import { ReportPanelManager } from './providers/ReportPanelManager';
import { InputService } from './services/InputService';
import { AiPipelineService } from './services/AiPipelineService';
import { exportBomCsv } from './export/bomCsvExporter';
import { registerCommands } from './commands';

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

        outputChannel.appendLine(`[InputService] ${request.inputType} → rawText=${request.rawText?.slice(0, 80)}`);
        pipeline.runRequirementStage(request);
        break;
      }

      case 'select_template': {
        const request = inputService.fromTemplate(message.payload.templateId);
        outputChannel.appendLine(`[InputService] template → ${request.templateId}`);
        pipeline.runRequirementStage(request);
        break;
      }
    }
  });

  const sidePanelRegistration = vscode.window.registerWebviewViewProvider(
    SidePanelProvider.viewType,
    sidePanelProvider,
    { webviewOptions: { retainContextWhenHidden: true } }
  );

  // ── Report Panel 消息路由 ──
  ReportPanelManager.onMessage((message) => {
    outputChannel.appendLine(`[report→ext] ${message.type}`);

    switch (message.type) {
      case 'export_request':
        vscode.window.showInformationMessage(
          `Export ${message.payload.format} — coming in Phase 7`
        );
        break;
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
