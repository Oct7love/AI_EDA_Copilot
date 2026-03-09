/**
 * Report Tab WebviewPanel 单例管理，负责生命周期和消息路由
 */
import * as vscode from 'vscode';
import type { ReportToExtension, ExtensionToReport } from '../../shared/types';

/**
 * Report Tab Webview 管理器
 * 管理 Report WebviewPanel 生命周期，支持单例复用
 */
export class ReportPanelManager {
  private static _panel?: vscode.WebviewPanel;
  private static _onMessage?: (message: ReportToExtension) => void;

  /** 注册消息回调（由 activate 层注入） */
  public static onMessage(handler: (message: ReportToExtension) => void): void {
    ReportPanelManager._onMessage = handler;
  }

  /** 向报告页发送消息 */
  public static postMessage(message: ExtensionToReport): void {
    ReportPanelManager._panel?.webview.postMessage(message);
  }

  /** 打开或聚焦报告页 */
  public static openOrFocus(extensionUri: vscode.Uri, title?: string): void {
    // 已有面板则聚焦
    if (ReportPanelManager._panel) {
      ReportPanelManager._panel.reveal(vscode.ViewColumn.One);
      if (title) {
        ReportPanelManager._panel.title = title;
      }
      return;
    }

    // 创建新面板
    const panel = vscode.window.createWebviewPanel(
      'aiEdaCopilot.report',
      title ?? 'AI EDA Report',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      }
    );

    panel.webview.html = ReportPanelManager._getHtml(panel.webview, extensionUri);

    panel.webview.onDidReceiveMessage((message: ReportToExtension) => {
      ReportPanelManager._onMessage?.(message);
    });

    panel.onDidDispose(() => {
      ReportPanelManager._panel = undefined;
    });

    ReportPanelManager._panel = panel;
  }

  /** 面板是否存在 */
  public static get isOpen(): boolean {
    return ReportPanelManager._panel !== undefined;
  }

  /** 生成 Webview HTML */
  private static _getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'dist', 'report.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'dist', 'report.css')
    );
    const nonce = getNonce();

    return /* html */ `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>AI EDA Report</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
