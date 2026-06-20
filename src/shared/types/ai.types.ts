/** AI 通信层类型定义 */

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiCompletionParams {
  model: string;
  messages: AiMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  /** 用户取消信号：abort 后中断底层请求并以 CANCELLED 结束 */
  signal?: AbortSignal;
}

export interface AiStreamChunk {
  content: string;
  finishReason: string | null;
}

export type AiErrorCode =
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'RATE_LIMIT'
  | 'SERVER_ERROR'
  | 'AUTH_ERROR'
  | 'INVALID_REQUEST'
  | 'QUOTA_EXCEEDED'
  | 'PARSE_ERROR'
  | 'CANCELLED'
  | 'UNKNOWN';

/** 可重试的错误码集合（注意：CANCELLED 不可重试——用户取消应立即停止） */
export const RETRYABLE_ERRORS: ReadonlySet<AiErrorCode> = new Set([
  'NETWORK_ERROR',
  'TIMEOUT',
  'RATE_LIMIT',
  'SERVER_ERROR',
]);

export interface RetryState {
  attempt: number;
  maxAttempts: number;
  intervalMs: number;
  lastError: AiErrorCode | null;
}

export function createRetryState(): RetryState {
  return { attempt: 0, maxAttempts: 10, intervalMs: 15_000, lastError: null };
}
