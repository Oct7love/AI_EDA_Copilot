/**
 * AI API 适配器，封装 OpenAI SDK 的 stream/complete 调用，隔离协议细节
 */
import OpenAI from 'openai';
import * as vscode from 'vscode';
import type { AiCompletionParams, AiStreamChunk, AiErrorCode } from '@shared/types';

export class AiAdapter {
  private client: OpenAI | null = null;
  private cachedBaseUrl = '';
  private cachedApiKey = '';

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly log?: (msg: string) => void,
  ) {}

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

  /** 分离 system 消息（兼容 Anthropic Messages API 顶层 system 参数） */
  private separateSystemMessages(messages: AiCompletionParams['messages']) {
    const systemParts: string[] = [];
    const nonSystem: { role: 'user' | 'assistant'; content: string }[] = [];
    for (const m of messages) {
      if (m.role === 'system') {
        systemParts.push(m.content);
      } else {
        nonSystem.push({ role: m.role as 'user' | 'assistant', content: m.content });
      }
    }
    return { systemPrompt: systemParts.join('\n\n') || undefined, messages: nonSystem };
  }

  /** 流式调用，返回 AsyncGenerator */
  async *stream(params: AiCompletionParams): AsyncGenerator<AiStreamChunk> {
    const client = await this.ensureClient();
    const { systemPrompt, messages } = this.separateSystemMessages(params.messages);

    const body: Record<string, unknown> = {
      model: params.model,
      messages,
      temperature: params.temperature ?? 0.3,
      max_tokens: params.maxTokens ?? 16384,
      stream: true,
    };
    if (systemPrompt) body.system = systemPrompt;

    // as any: OpenAI SDK 类型不支持动态 body（含可选 system 字段），需绕过类型检查
    const response = await (client.chat.completions as any).create(body);
    this.log?.(`[AiAdapter] response type=${typeof response}, constructor=${response?.constructor?.name}`);

    let chunkIndex = 0;
    for await (const chunk of response) {
      if (chunkIndex < 3) {
        this.log?.(`[AiAdapter] chunk[${chunkIndex}]: ${JSON.stringify(chunk).slice(0, 800)}`);
      }
      chunkIndex++;
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
    this.log?.(`[AiAdapter] stream done, total chunks=${chunkIndex}`);
  }

  /** 非流式调用 */
  async complete(params: AiCompletionParams): Promise<string> {
    const client = await this.ensureClient();
    const { systemPrompt, messages } = this.separateSystemMessages(params.messages);

    const body: Record<string, unknown> = {
      model: params.model,
      messages,
      temperature: params.temperature ?? 0.3,
      max_tokens: params.maxTokens ?? 16384,
    };
    if (systemPrompt) body.system = systemPrompt;

    // as any: OpenAI SDK 类型不支持动态 body（含可选 system 字段），需绕过类型检查
    const response = await (client.chat.completions as any).create(body);

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
