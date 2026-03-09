/**
 * pipelineStreamRunner 单元测试 — streamWithRetry 重试逻辑验证
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
  workspace: { getConfiguration: () => ({ get: () => '' }) },
  window: { showInputBox: vi.fn() },
  Uri: { file: (p: string) => ({ fsPath: p }) },
  SecretStorage: class {},
}));

// mock 短间隔重试，避免 fake timer 与 async 竞争
vi.mock('@shared/types', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createRetryState: () => ({ attempt: 0, maxAttempts: 3, intervalMs: 10, lastError: null }),
  };
});

import { streamWithRetry, type StreamRunnerDeps } from './pipelineStreamRunner';
import { AiAdapterError } from '../adapters/AiAdapter';

function makeDeps(streamFn: (...args: unknown[]) => AsyncGenerator<{ content: string }>): StreamRunnerDeps {
  return {
    adapter: { stream: streamFn } as unknown as StreamRunnerDeps['adapter'],
    panelProvider: { postMessage: vi.fn() } as unknown as StreamRunnerDeps['panelProvider'],
    outputChannel: { appendLine: vi.fn() } as unknown as StreamRunnerDeps['outputChannel'],
    sendPanelStatus: vi.fn(),
  };
}

async function* fakeStream(chunks: string[]): AsyncGenerator<{ content: string }> {
  for (const c of chunks) yield { content: c };
}

describe('streamWithRetry', () => {
  it('成功时返回完整拼接文本', async () => {
    const deps = makeDeps(() => fakeStream(['Hello', ' ', 'World']));
    const result = await streamWithRetry(deps, 'model', [{ role: 'user', content: 'test' }]);
    expect(result).toBe('Hello World');
  });

  it('不可重试错误直接抛出', async () => {
    let calls = 0;
    const deps = makeDeps(() => {
      calls++;
      throw new AiAdapterError('AUTH_ERROR', '认证失败');
    });

    await expect(
      streamWithRetry(deps, 'model', [{ role: 'user', content: 'test' }])
    ).rejects.toThrow('认证失败');
    expect(calls).toBe(1);
  });

  it('可重试错误会重试直到成功', async () => {
    let calls = 0;
    const deps = makeDeps(() => {
      calls++;
      if (calls < 3) throw new AiAdapterError('RATE_LIMIT', '限流');
      return fakeStream(['ok']);
    });

    const result = await streamWithRetry(deps, 'model', [{ role: 'user', content: 'test' }]);
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('重试耗尽后抛出最后一次错误', async () => {
    const deps = makeDeps(() => {
      throw new AiAdapterError('RATE_LIMIT', '持续限流');
    });

    await expect(
      streamWithRetry(deps, 'model', [{ role: 'user', content: 'test' }])
    ).rejects.toThrow('持续限流');
  });

  it('重试时发送状态通知到面板', async () => {
    let calls = 0;
    const deps = makeDeps(() => {
      calls++;
      if (calls < 2) throw new AiAdapterError('RATE_LIMIT', '限流');
      return fakeStream(['done']);
    });

    await streamWithRetry(deps, 'model', [{ role: 'user', content: 'test' }]);

    expect(deps.sendPanelStatus).toHaveBeenCalled();
    expect(deps.panelProvider.postMessage).toHaveBeenCalled();
  });
});
