import OpenAI from 'openai';
import * as vscode from 'vscode';
import type { AiCompletionParams, AiStreamChunk, AiErrorCode } from '@shared/types';

export class AiAdapter {
  private client: OpenAI | null = null;
  private cachedBaseUrl = '';
  private cachedApiKey = '';

  constructor(private readonly secrets: vscode.SecretStorage) {}

  /** 懒初始化，检测配置变更时重建客户端 */
  private async ensureClient(): Promise<OpenAI> {
    const config = vscode.workspace.getConfiguration('aiEda');
    const baseUrl = config.get<string>('apiBaseUrl', '');
    const apiKey = await this.secrets.get('aiEda.apiKey') ?? '';

    if (!apiKey) {
      throw new AiAdapterError('AUTH_ERROR', 'API Key 未配置');
    }

    if (!this.client || baseUrl !== this.cachedBaseUrl || apiKey !== this.cachedApiKey) {
      this.client = new OpenAI({
        apiKey,
        baseURL: baseUrl || undefined,
      });
      this.cachedBaseUrl = baseUrl;
      this.cachedApiKey = apiKey;
    }

    return this.client;
  }

  /** 流式调用，返回 AsyncGenerator */
  async *stream(params: AiCompletionParams): AsyncGenerator<AiStreamChunk> {
    const client = await this.ensureClient();

    const response = await client.chat.completions.create({
      model: params.model,
      messages: params.messages.map(m => ({ role: m.role, content: m.content })),
      temperature: params.temperature ?? 0.3,
      max_tokens: params.maxTokens ?? 4096,
      stream: true,
    });

    for await (const chunk of response) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        yield {
          content: delta.content,
          finishReason: chunk.choices[0]?.finish_reason ?? null,
        };
      } else if (chunk.choices[0]?.finish_reason) {
        yield { content: '', finishReason: chunk.choices[0].finish_reason };
      }
    }
  }

  /** 非流式调用 */
  async complete(params: AiCompletionParams): Promise<string> {
    const client = await this.ensureClient();

    const response = await client.chat.completions.create({
      model: params.model,
      messages: params.messages.map(m => ({ role: m.role, content: m.content })),
      temperature: params.temperature ?? 0.3,
      max_tokens: params.maxTokens ?? 4096,
    });

    return response.choices[0]?.message?.content ?? '';
  }

  /** 检查 API Key 是否已配置 */
  async hasApiKey(): Promise<boolean> {
    const key = await this.secrets.get('aiEda.apiKey');
    return !!key;
  }
}

/** 错误分类 */
export function classifyError(err: unknown): AiErrorCode {
  if (err instanceof OpenAI.APIError) {
    const status = err.status;
    if (status === 401 || status === 403) return 'AUTH_ERROR';
    if (status === 429) return 'RATE_LIMIT';
    if (status === 400) return 'INVALID_REQUEST';
    if (status === 402) return 'QUOTA_EXCEEDED';
    if (status && status >= 500) return 'SERVER_ERROR';
  }

  if (err instanceof OpenAI.APIConnectionError) return 'NETWORK_ERROR';
  if (err instanceof OpenAI.APIConnectionTimeoutError) return 'TIMEOUT';

  const msg = err instanceof Error ? err.message.toLowerCase() : '';
  if (msg.includes('timeout') || msg.includes('timed out')) return 'TIMEOUT';
  if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('fetch failed')) return 'NETWORK_ERROR';

  return 'UNKNOWN';
}

export class AiAdapterError extends Error {
  constructor(
    public readonly code: AiErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'AiAdapterError';
  }
}
