/**
 * 流式 AI 调用执行器，封装带重试的 stream 逻辑，与管线编排解耦
 */
import type { PipelineStage } from '@shared/types';
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

/** 带重试的流式调用，返回完整文本。showInPanel 控制是否将原始内容流式显示到 Panel */
export async function streamWithRetry(
  deps: StreamRunnerDeps,
  model: string,
  messages: ChatMessage[],
  showInPanel = false,
): Promise<string> {
  const retry = createRetryState();
  let lastError: Error | null = null;

  while (retry.attempt < retry.maxAttempts) {
    try {
      return await doStream(deps, model, messages, showInPanel);
    } catch (err) {
      const code = err instanceof AiAdapterError ? err.code : classifyError(err);
      retry.lastError = code;
      retry.attempt++;

      if (!RETRYABLE_ERRORS.has(code)) throw err;

      if (retry.attempt >= retry.maxAttempts) {
        lastError = err instanceof Error ? err : new Error(String(err));
        break;
      }

      deps.outputChannel.appendLine(
        `[Pipeline] retry ${retry.attempt}/${retry.maxAttempts}, error=${code}, wait=${retry.intervalMs}ms`
      );
      deps.sendPanelStatus('requirement', 0);
      deps.panelProvider.postMessage({
        type: 'ai_chat_response',
        source: 'extension',
        payload: {
          content: `[重试 ${retry.attempt}/${retry.maxAttempts}] ${code}，${retry.intervalMs / 1000}s 后重试...`,
          isStreaming: false,
        },
        timestamp: Date.now(),
      });

      await sleep(retry.intervalMs);
    }
  }

  throw lastError ?? new Error('Max retries exceeded');
}

/** 单次流式调用，返回完整文本 */
async function doStream(
  deps: StreamRunnerDeps,
  model: string,
  messages: ChatMessage[],
  showInPanel: boolean,
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
    const stream = deps.adapter.stream({ model, messages, stream: true });
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
