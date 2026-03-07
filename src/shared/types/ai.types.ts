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
  | 'UNKNOWN';

/** 可重试的错误码集合 */
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
