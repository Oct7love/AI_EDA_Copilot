import * as vscode from 'vscode';
import type { PanelToExtension, ExtensionToPanel } from '../../shared/types';

/**
 * 侧边栏 Webview Provider
 * 负责生命周期管理 + 消息路由，不含业务逻辑
 */
export class SidePanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'aiEdaCopilot.sidePanel';

  private _view?: vscode.WebviewView;
  private _onMessage?: (message: PanelToExtension) => void;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  /** 注册消息回调（由 activate 层注入） */
  public onMessage(handler: (message: PanelToExtension) => void): void {
    this._onMessage = handler;
  }

  /** 向侧边栏发送消息 */
  public postMessage(message: ExtensionToPanel): void {
    this._view?.webview.postMessage(message);
  }

  /** VS Code 调用：创建 Webview 内容 */
  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message: PanelToExtension) => {
      this._onMessage?.(message);
    });
  }

  /** 生成 Webview HTML（加载 React 打包产物） */
  private _getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'panel.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'panel.css')
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
  <title>AI EDA Copilot</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

/** 生成随机 nonce 用于 CSP */
function getNonce(): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
