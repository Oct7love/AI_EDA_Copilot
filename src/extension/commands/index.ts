import * as vscode from 'vscode';
import { ReportPanelManager } from '../providers/ReportPanelManager';

/**
 * 注册所有 VS Code 命令
 * 命令只做路由，不含业务逻辑
 */
export function registerCommands(
  context: vscode.ExtensionContext
): vscode.Disposable[] {
  const openReport = vscode.commands.registerCommand('aiEda.openReport', () => {
    ReportPanelManager.openOrFocus(context.extensionUri);
  });

  const showPanel = vscode.commands.registerCommand('aiEda.showPanel', () => {
    vscode.commands.executeCommand('aiEdaCopilot.sidePanel.focus');
  });

  const configureApiKey = vscode.commands.registerCommand('aiEda.configureApiKey', async () => {
    const key = await vscode.window.showInputBox({
      title: 'AI EDA Copilot — API Key',
      prompt: '请输入 OpenAI 兼容的 API Key（将加密存储）',
      password: true,
      ignoreFocusOut: true,
    });

    if (key !== undefined) {
      await context.secrets.store('aiEda.apiKey', key);
      vscode.window.showInformationMessage(
        key ? 'API Key 已保存' : 'API Key 已清除'
      );
    }
  });

  return [openReport, showPanel, configureApiKey];
}
