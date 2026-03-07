/**
 * acquireVsCodeApi 封装
 * Webview 中只能调用一次 acquireVsCodeApi()，此模块缓存结果供全局复用
 */

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vscodeApi: VsCodeApi = (globalThis as any).acquireVsCodeApi?.()
  ?? { postMessage: () => {}, getState: () => null, setState: () => {} };

export default vscodeApi;
