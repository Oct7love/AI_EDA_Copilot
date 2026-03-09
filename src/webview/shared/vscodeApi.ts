/**
 * acquireVsCodeApi 封装
 * Webview 中只能调用一次 acquireVsCodeApi()，此模块缓存结果供全局复用
 */

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

// as any: VS Code Webview 全局 API 无 TypeScript 类型声明，必须通过 globalThis 动态访问
const vscodeApi: VsCodeApi = (globalThis as any).acquireVsCodeApi?.()
  ?? { postMessage: () => {}, getState: () => null, setState: () => {} };

export default vscodeApi;
