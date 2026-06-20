/**
 * 流式 AI 调用执行器，封装带重试的 stream 逻辑，与管线编排解耦
 */
import type { PipelineStage, AiErrorCode } from '@shared/types';
import { RETRYABLE_ERRORS, createRetryState } from '@shared/types';
import { AiAdapter, AiAdapterError, classifyError } from '../adapters/AiAdapter';
import { StreamBuffer } from './StreamBuffer';
import type { SidePanelProvider } from '../providers/SidePanelProvider';
import type * as vscode from 'vscode';

/** streamWithRetry 所需的外部依赖 */
export interface StreamRunnerDeps {
  adapter: AiAdapter;
  panelProvider: SidePanelProvider;
  outputChannel: vscode.OutputChannel;
  sendPanelStatus: (stage: PipelineStage, progress: number) => void;
}

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

/**
 * 重试耗尽后抛出的阶段化错误：保留失败阶段、错误码与原始错误（cause）。
 * 便于上层与 UI 精确展示「哪个阶段、什么原因」，且不丢失最有用的原始错误。
 */
export class StreamStageError extends Error {
  constructor(
    public readonly stage: PipelineStage,
    public readonly code: AiErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'StreamStageError';
  }
}

/**
 * 带重试的流式调用，返回完整文本。
 * @param stage 当前管线阶段（用于状态/日志/错误透传）
 * @param showInPanel 是否将原始内容流式显示到 Panel
 */
export async function streamWithRetry(
  deps: StreamRunnerDeps,
  model: string,
  messages: ChatMessage[],
  stage: PipelineStage = 'requirement',
  showInPanel = false,
  signal?: AbortSignal,
): Promise<string> {
  const retry = createRetryState();
  let lastError: Error | null = null;

  while (retry.attempt < retry.maxAttempts) {
    // 用户在重试间隙取消：立即停止，不再发起新尝试
    if (signal?.aborted) throw new AiAdapterError('CANCELLED', '分析已取消');
    try {
      return await doStream(deps, model, messages, showInPanel, signal);
    } catch (err) {
      const code = err instanceof AiAdapterError ? err.code : classifyError(err);
      retry.lastError = code;
      retry.attempt++;

      // 不可重试错误：直接抛原始错误（保留分类信息）
      if (!RETRYABLE_ERRORS.has(code)) throw err;

      if (retry.attempt >= retry.maxAttempts) {
        lastError = err instanceof Error ? err : new Error(String(err));
        break;
      }

      deps.outputChannel.appendLine(
        `[Pipeline] stage=${stage} retry ${retry.attempt}/${retry.maxAttempts}, error=${code}, wait=${retry.intervalMs}ms`
      );
      // 透传真实阶段而非硬编码 requirement，避免进度条误回退到第一步
      deps.sendPanelStatus(stage, 0);
      deps.panelProvider.postMessage({
        type: 'ai_chat_response',
        source: 'extension',
        payload: {
          content: `[重试 ${retry.attempt}/${retry.maxAttempts} @${stage}] ${code}，${retry.intervalMs / 1000}s 后重试...`,
          isStreaming: false,
        },
        timestamp: Date.now(),
      });

      await sleep(retry.intervalMs, signal);
    }
  }

  // 重试耗尽：包装为阶段化错误，保留原始错误为 cause
  throw new StreamStageError(
    stage,
    retry.lastError ?? 'UNKNOWN',
    lastError?.message ?? 'Max retries exceeded',
    lastError,
  );
}

/** 单次流式调用，返回完整文本 */
async function doStream(
  deps: StreamRunnerDeps,
  model: string,
  messages: ChatMessage[],
  showInPanel: boolean,
  signal?: AbortSignal,
): Promise<string> {
  let fullText = '';

  const streamBuffer = showInPanel
    ? new StreamBuffer((content) => {
        deps.panelProvider.postMessage({
          type: 'ai_chat_response',
          source: 'extension',
          payload: { content, isStreaming: true },
          timestamp: Date.now(),
        });
      })
    : null;

  try {
    const stream = deps.adapter.stream({ model, messages, stream: true, signal });
    for await (const chunk of stream) {
      if (chunk.content) {
        fullText += chunk.content;
        streamBuffer?.push(chunk.content);
      }
    }
  } finally {
    streamBuffer?.dispose();
  }

  return fullText;
}

/** 可被 AbortSignal 中断的 sleep：取消时立即以 CANCELLED 结束，不再空等 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AiAdapterError('CANCELLED', '分析已取消'));
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AiAdapterError('CANCELLED', '分析已取消'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
