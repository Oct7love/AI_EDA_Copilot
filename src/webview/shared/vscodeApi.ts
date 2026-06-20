/**
 * acquireVsCodeApi 封装
 * Webview 中只能调用一次 acquireVsCodeApi()，此模块缓存结果供全局复用
 */

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

// VS Code Webview 全局 API 无 TypeScript 类型声明，通过 globalThis 上的可选属性窄化访问
const acquireVsCodeApi = (globalThis as { acquireVsCodeApi?: () => VsCodeApi }).acquireVsCodeApi;
const vscodeApi: VsCodeApi = acquireVsCodeApi?.()
  ?? { postMessage: () => {}, getState: () => null, setState: () => {} };

export default vscodeApi;
