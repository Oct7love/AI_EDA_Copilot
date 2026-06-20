/**
 * AiAdapter 错误层单测
 *
 * 聚焦可纯逻辑单测的部分：classifyError 分类、AiAdapterError 构造、
 * 以及 RETRYABLE_ERRORS 不变量（保护 Phase 2 idle-watchdog → TIMEOUT 的可重试语义）。
 *
 * 不驱动 stream()：构造 OpenAI 客户端 + 真实流式响应不可在此处单测，
 * 仅在分类层面校验 IdleTimeoutError → TIMEOUT（可重试）的映射意图。
 */
import { describe, it, expect, vi } from 'vitest';
import OpenAI from 'openai';

// AiAdapter.ts 顶层 import 'vscode'（运行时不存在），必须 mock。
// getConfiguration().get(key, default) 直接返回 default 即可满足模块加载。
vi.mock('vscode', () => ({
  workspace: { getConfiguration: () => ({ get: (_k: string, d: unknown) => d }) },
}));

import { classifyError, AiAdapterError } from './AiAdapter';
import { RETRYABLE_ERRORS } from '@shared/types';
import { IdleTimeoutError } from '../services/withIdleTimeout';

/** 构造带指定 HTTP status 的 OpenAI.APIError */
function apiError(status: number): OpenAI.APIError {
  return new OpenAI.APIError(status, { error: { message: 'x' } }, 'msg', {});
}

describe('classifyError — OpenAI.APIError by status', () => {
  it('maps 401 and 403 to AUTH_ERROR', () => {
    expect(classifyError(apiError(401))).toBe('AUTH_ERROR');
    expect(classifyError(apiError(403))).toBe('AUTH_ERROR');
  });

  it('maps 429 to RATE_LIMIT', () => {
    expect(classifyError(apiError(429))).toBe('RATE_LIMIT');
  });

  it('maps 400 to INVALID_REQUEST', () => {
    expect(classifyError(apiError(400))).toBe('INVALID_REQUEST');
  });

  it('maps 402 to QUOTA_EXCEEDED', () => {
    expect(classifyError(apiError(402))).toBe('QUOTA_EXCEEDED');
  });

  it('maps 500 and 503 to SERVER_ERROR', () => {
    expect(classifyError(apiError(500))).toBe('SERVER_ERROR');
    expect(classifyError(apiError(503))).toBe('SERVER_ERROR');
  });
});

describe('classifyError — OpenAI connection error subclasses', () => {
  it('maps APIConnectionError to NETWORK_ERROR', () => {
    const err = new OpenAI.APIConnectionError({ message: 'connection failed' });
    expect(classifyError(err)).toBe('NETWORK_ERROR');
  });

  it('maps APIConnectionTimeoutError to TIMEOUT (more specific subclass wins)', () => {
    // 关键：APIConnectionTimeoutError 继承自 APIConnectionError，
    // classifyError 必须先判定它，否则会被误判为 NETWORK_ERROR。
    const err = new OpenAI.APIConnectionTimeoutError({});
    expect(err).toBeInstanceOf(OpenAI.APIConnectionError); // 印证继承关系
    expect(classifyError(err)).toBe('TIMEOUT');
  });
});

describe('classifyError — message heuristics', () => {
  it('maps NETWORK-like messages to NETWORK_ERROR', () => {
    // 用普通 Error 走 message-heuristic 分支（非 OpenAI 子类）
    expect(classifyError(new Error('fetch failed'))).toBe('NETWORK_ERROR');
    expect(classifyError(new Error('connect ECONNREFUSED 127.0.0.1'))).toBe('NETWORK_ERROR');
    expect(classifyError(new Error('Network is unreachable'))).toBe('NETWORK_ERROR');
    expect(classifyError(new Error('Premature close'))).toBe('NETWORK_ERROR');
  });

  it('maps TIMEOUT-like messages to TIMEOUT', () => {
    expect(classifyError(new Error('Request timeout'))).toBe('TIMEOUT');
    expect(classifyError(new Error('operation timed out'))).toBe('TIMEOUT');
  });

  it('is case-insensitive on message heuristics', () => {
    expect(classifyError(new Error('TIMED OUT'))).toBe('TIMEOUT');
    expect(classifyError(new Error('FETCH FAILED'))).toBe('NETWORK_ERROR');
  });
});

describe('classifyError — fallback', () => {
  it('maps an unrelated error to UNKNOWN', () => {
    expect(classifyError(new Error('something totally unrelated'))).toBe('UNKNOWN');
  });

  it('maps non-Error values to UNKNOWN', () => {
    expect(classifyError('a string')).toBe('UNKNOWN');
    expect(classifyError(undefined)).toBe('UNKNOWN');
    expect(classifyError({ foo: 'bar' })).toBe('UNKNOWN');
  });
});

describe('RETRYABLE_ERRORS invariant', () => {
  it('includes the retryable codes', () => {
    expect(RETRYABLE_ERRORS.has('NETWORK_ERROR')).toBe(true);
    expect(RETRYABLE_ERRORS.has('TIMEOUT')).toBe(true);
    expect(RETRYABLE_ERRORS.has('RATE_LIMIT')).toBe(true);
    expect(RETRYABLE_ERRORS.has('SERVER_ERROR')).toBe(true);
  });

  it('excludes the non-retryable codes', () => {
    expect(RETRYABLE_ERRORS.has('AUTH_ERROR')).toBe(false);
    expect(RETRYABLE_ERRORS.has('INVALID_REQUEST')).toBe(false);
    expect(RETRYABLE_ERRORS.has('QUOTA_EXCEEDED')).toBe(false);
    expect(RETRYABLE_ERRORS.has('UNKNOWN')).toBe(false);
  });
});

describe('AiAdapterError', () => {
  it('sets code, message, name and is an Error', () => {
    const err = new AiAdapterError('RATE_LIMIT', 'too many requests');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('RATE_LIMIT');
    expect(err.message).toBe('too many requests');
    expect(err.name).toBe('AiAdapterError');
  });

  it('carries any AiErrorCode', () => {
    const err = new AiAdapterError('TIMEOUT', 'idle');
    expect(err.code).toBe('TIMEOUT');
  });
});

describe('idle-timeout → TIMEOUT mapping (classification-level regression guard)', () => {
  // AiAdapter.stream() 捕获 IdleTimeoutError 后抛出 AiAdapterError('TIMEOUT')，
  // 由上层重试机制处理。此处在分类层面固化该契约，防止 Phase 2 idle-watchdog 回归。
  it('TIMEOUT is retryable, so a wrapped idle timeout will be retried', () => {
    const idle = new IdleTimeoutError(90_000);
    expect(idle).toBeInstanceOf(Error);
    // 适配器映射目标：AiAdapterError('TIMEOUT')
    const wrapped = new AiAdapterError('TIMEOUT', idle.message);
    expect(wrapped.code).toBe('TIMEOUT');
    expect(RETRYABLE_ERRORS.has(wrapped.code)).toBe(true);
  });
});
