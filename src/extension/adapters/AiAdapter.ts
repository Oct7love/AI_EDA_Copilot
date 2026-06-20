/**
 * AI API 适配器，封装 OpenAI SDK 的 stream/complete 调用，隔离协议细节
 */
import OpenAI from 'openai';
import * as vscode from 'vscode';
import type { AiCompletionParams, AiStreamChunk, AiErrorCode } from '@shared/types';
import { withIdleTimeout, IdleTimeoutError } from '../services/withIdleTimeout';

/** 单次请求建立响应的超时（ms） */
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
/** 流式相邻 chunk 之间的最大空闲（ms），超过即判定流停滞 */
const DEFAULT_STREAM_IDLE_MS = 90_000;

/** OpenAI chat.completions.create 的最小动态调用形态（绕过 SDK 静态类型对可选 system 字段的限制，避免 any） */
interface ChatCompletionsLike {
  create(body: Record<string, unknown>, opts?: { signal?: AbortSignal }): Promise<unknown>;
}
/** 流式 chunk 的最小结构 */
interface StreamChunkLike {
  choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
}
/** 非流式响应的最小结构 */
interface CompletionResponseLike {
  choices?: { message?: { content?: string } }[];
}

export class AiAdapter {
  private client: OpenAI | null = null;
  private cachedBaseUrl = '';
  private cachedApiKey = '';
  private cachedTimeout = 0;

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly log?: (msg: string) => void,
  ) {}

  /** 懒初始化，检测配置变更时重建客户端 */
  private async ensureClient(): Promise<OpenAI> {
    const config = vscode.workspace.getConfiguration('aiEda');
    const baseUrl = config.get<string>('apiBaseUrl', '');
    const apiKey = await this.secrets.get('aiEda.apiKey') ?? '';
    const timeout = config.get<number>('requestTimeoutMs', DEFAULT_REQUEST_TIMEOUT_MS);

    if (!apiKey) {
      throw new AiAdapterError('AUTH_ERROR', 'API Key 未配置');
    }

    if (!this.client
      || baseUrl !== this.cachedBaseUrl
      || apiKey !== this.cachedApiKey
      || timeout !== this.cachedTimeout) {
      this.client = new OpenAI({
        apiKey,
        baseURL: baseUrl || undefined,
        // 单次请求超时；应用层 pipelineStreamRunner 负责重试，故关闭 SDK 内置重试避免叠加
        timeout,
        maxRetries: 0,
      });
      this.cachedBaseUrl = baseUrl;
      this.cachedApiKey = apiKey;
      this.cachedTimeout = timeout;
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
    const config = vscode.workspace.getConfiguration('aiEda');
    const idleMs = config.get<number>('streamIdleTimeoutMs', DEFAULT_STREAM_IDLE_MS);
    const debug = config.get<boolean>('debugLogging', false);
    const { systemPrompt, messages } = this.separateSystemMessages(params.messages);

    const body: Record<string, unknown> = {
      model: params.model,
      messages,
      temperature: params.temperature ?? 0.3,
      max_tokens: params.maxTokens ?? 16384,
      stream: true,
    };
    if (systemPrompt) body.system = systemPrompt;

    // 内部 controller 同时承载 idle watchdog 与用户取消；userAborted 用于区分两者
    const controller = new AbortController();
    const external = params.signal;
    let userAborted = false;
    const onExternalAbort = () => { userAborted = true; controller.abort(); };
    if (external?.aborted) { userAborted = true; controller.abort(); }
    else external?.addEventListener('abort', onExternalAbort, { once: true });

    let chunkIndex = 0;
    try {
      if (userAborted) throw new AiAdapterError('CANCELLED', '分析已取消');

      const completions = client.chat.completions as unknown as ChatCompletionsLike;
      const response = await completions.create(body, { signal: controller.signal });
      if (debug) this.log?.(`[AiAdapter] response type=${typeof response}`);

      for await (const chunk of withIdleTimeout(response as AsyncIterable<StreamChunkLike>, idleMs, () => controller.abort())) {
        if (debug && chunkIndex < 3) {
          this.log?.(`[AiAdapter] chunk[${chunkIndex}]: ${JSON.stringify(chunk).slice(0, 800)}`);
        }
        chunkIndex++;
        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) {
          yield {
            content: delta.content,
            finishReason: chunk.choices?.[0]?.finish_reason ?? null,
          };
        } else if (chunk.choices?.[0]?.finish_reason) {
          yield { content: '', finishReason: chunk.choices[0].finish_reason };
        }
      }
      this.log?.(`[AiAdapter] stream done, total chunks=${chunkIndex}`);
    } catch (err) {
      // 用户取消优先于 idle 超时判定，归类为不可重试的 CANCELLED（非崩溃）
      if (userAborted || (err instanceof AiAdapterError && err.code === 'CANCELLED')) {
        throw new AiAdapterError('CANCELLED', '分析已取消');
      }
      // idle watchdog 触发 → 可重试的 TIMEOUT
      if (err instanceof IdleTimeoutError) {
        this.log?.(`[AiAdapter] ${err.message}`);
        throw new AiAdapterError('TIMEOUT', err.message);
      }
      throw err;
    } finally {
      external?.removeEventListener('abort', onExternalAbort);
    }
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

    const completions = client.chat.completions as unknown as ChatCompletionsLike;
    const opts = params.signal ? { signal: params.signal } : undefined;
    const response = (await completions.create(body, opts)) as CompletionResponseLike;

    return response.choices?.[0]?.message?.content ?? '';
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

  // 注意顺序：APIConnectionTimeoutError 继承自 APIConnectionError，
  // 必须先判定更具体的子类，否则超时错误会被误判为 NETWORK_ERROR。
  if (err instanceof OpenAI.APIConnectionTimeoutError) return 'TIMEOUT';
  if (err instanceof OpenAI.APIConnectionError) return 'NETWORK_ERROR';

  const msg = err instanceof Error ? err.message.toLowerCase() : '';
  if (msg.includes('timeout') || msg.includes('timed out')) return 'TIMEOUT';
  if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('fetch failed') || msg.includes('premature close')) return 'NETWORK_ERROR';

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
