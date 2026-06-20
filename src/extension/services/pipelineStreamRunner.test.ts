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

import { streamWithRetry, StreamStageError, type StreamRunnerDeps } from './pipelineStreamRunner';
import { AiAdapterError } from '../adapters/AiAdapter';
import { RETRYABLE_ERRORS } from '@shared/types';

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

  it('重试时透传当前阶段到状态通知（非 requirement）', async () => {
    let calls = 0;
    const deps = makeDeps(() => {
      calls++;
      if (calls < 2) throw new AiAdapterError('RATE_LIMIT', '限流');
      return fakeStream(['done']);
    });

    await streamWithRetry(deps, 'model', [{ role: 'user', content: 'x' }], 'bom');
    expect(deps.sendPanelStatus).toHaveBeenCalledWith('bom', 0);
  });

  it('重试耗尽抛出 StreamStageError，携带 stage 与 code，并保留原始错误为 cause', async () => {
    const original = new AiAdapterError('SERVER_ERROR', '服务器错误');
    const deps = makeDeps(() => { throw original; });

    let thrown: unknown;
    try {
      await streamWithRetry(deps, 'model', [{ role: 'user', content: 'x' }], 'pcb_layout');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(StreamStageError);
    const se = thrown as StreamStageError;
    expect(se.stage).toBe('pcb_layout');
    expect(se.code).toBe('SERVER_ERROR');
    expect(se.message).toContain('服务器错误');
    expect(se.cause).toBe(original);
  });

  // === Agent 9：可观测性加强（不新增功能，仅覆盖现有行为）===

  // 目标 1：非 requirement 阶段（schematic）的错误路径中，阶段被完整保留：
  // sendPanelStatus 收到精确阶段（不是 requirement），且面板重试文案带阶段标签（@schematic）。
  it('错误路径中保留 schematic 阶段：状态与面板文案均带该阶段标签', async () => {
    let calls = 0;
    const deps = makeDeps(() => {
      calls++;
      if (calls < 2) throw new AiAdapterError('RATE_LIMIT', '限流');
      return fakeStream(['done']);
    });

    await streamWithRetry(deps, 'model', [{ role: 'user', content: 'x' }], 'schematic');

    // 状态透传精确阶段，绝不回退到 requirement
    expect(deps.sendPanelStatus).toHaveBeenCalledWith('schematic', 0);
    expect(deps.sendPanelStatus).not.toHaveBeenCalledWith('requirement', 0);

    // 面板重试文案带阶段标签 @schematic
    const postMessage = deps.panelProvider.postMessage as ReturnType<typeof vi.fn>;
    const retryCall = postMessage.mock.calls.find(
      ([msg]) => typeof msg?.payload?.content === 'string' && msg.payload.content.includes('@schematic')
    );
    expect(retryCall).toBeTruthy();
    expect(retryCall?.[0].payload.content).toContain('RATE_LIMIT');
  });

  // 目标 1（补充）：另一个非 requirement 阶段 design_review，确认阶段透传不是硬编码 schematic/bom
  it('错误路径中保留 design_review 阶段：状态与面板文案均带该阶段标签', async () => {
    let calls = 0;
    const deps = makeDeps(() => {
      calls++;
      if (calls < 2) throw new AiAdapterError('NETWORK_ERROR', '网络抖动');
      return fakeStream(['ok']);
    });

    await streamWithRetry(deps, 'model', [{ role: 'user', content: 'x' }], 'design_review');

    expect(deps.sendPanelStatus).toHaveBeenCalledWith('design_review', 0);
    const postMessage = deps.panelProvider.postMessage as ReturnType<typeof vi.fn>;
    const retryCall = postMessage.mock.calls.find(
      ([msg]) => typeof msg?.payload?.content === 'string' && msg.payload.content.includes('@design_review')
    );
    expect(retryCall).toBeTruthy();
  });

  // 目标 2：重试成功后恢复正常流程 —— 失败两次（可重试）后成功，返回拼接文本，
  // 最终结果为成功内容（状态已恢复，不残留错误）。
  it('失败两次后成功：恢复正常流程并返回拼接成功文本', async () => {
    let calls = 0;
    const deps = makeDeps(() => {
      calls++;
      if (calls < 3) throw new AiAdapterError('SERVER_ERROR', '临时不可用');
      return fakeStream(['recov', 'ered', '!']);
    });

    const result = await streamWithRetry(deps, 'model', [{ role: 'user', content: 'x' }], 'schematic');

    // 第 3 次成功，返回成功内容（拼接），原错误未污染结果
    expect(result).toBe('recovered!');
    expect(calls).toBe(3);
  });

  // 目标 3：重试耗尽时保留「原始 error 对象」为 cause（身份相等，未被覆盖/丢失）；
  // 且 message 包含原始 message，stage/code 正确。
  it('重试耗尽：cause 严格等于原始抛出的 error 对象（原错误未丢失）', async () => {
    const original = new AiAdapterError('TIMEOUT', '上游超时');
    let calls = 0;
    const deps = makeDeps(() => {
      calls++;
      throw original;
    });

    let thrown: unknown;
    try {
      await streamWithRetry(deps, 'model', [{ role: 'user', content: 'x' }], 'bom');
    } catch (e) {
      thrown = e;
    }

    const se = thrown as StreamStageError;
    expect(se).toBeInstanceOf(StreamStageError);
    // cause 严格 === 原始对象（同一引用，未被新 Error 包装覆盖）
    expect(se.cause).toBe(original);
    expect(se.message).toContain('上游超时');
    expect(se.stage).toBe('bom');
    expect(se.code).toBe('TIMEOUT');
    // maxAttempts=3，确认确实重试到耗尽
    expect(calls).toBe(3);
  });

  // 目标 4：阶段化失败码映射 —— 不可重试 AiAdapterError（AUTH_ERROR）直接抛出，
  // 不被包装为 StreamStageError，且 call 次数 == 1（无重试）。
  // 与「耗尽重试会包装」路径形成对照。
  it('不可重试错误（AUTH_ERROR）直接抛原始错误，不包装为 StreamStageError 且无重试', async () => {
    const original = new AiAdapterError('AUTH_ERROR', '密钥无效');
    let calls = 0;
    const deps = makeDeps(() => {
      calls++;
      throw original;
    });

    let thrown: unknown;
    try {
      await streamWithRetry(deps, 'model', [{ role: 'user', content: 'x' }], 'schematic');
    } catch (e) {
      thrown = e;
    }

    // 关键区分：不可重试 → 不包装；耗尽重试 → 才包装
    expect(thrown).not.toBeInstanceOf(StreamStageError);
    expect(thrown).toBe(original);
    expect((thrown as AiAdapterError).code).toBe('AUTH_ERROR');
    expect(calls).toBe(1);
    // 不可重试时不应发送重试状态
    expect(deps.sendPanelStatus).not.toHaveBeenCalled();
  });

  // 目标 5：区分 TIMEOUT（可重试）与不可重试错误 —— TIMEOUT 会被重试。
  // 保护 Phase 2「watchdog 空闲超时（adapter 内映射为 TIMEOUT）→ runner 重试」契约。
  it('TIMEOUT 属于可重试：runner 会重试（保护 watchdog→retry 契约）', async () => {
    let calls = 0;
    const deps = makeDeps(() => {
      calls++;
      if (calls < 2) throw new AiAdapterError('TIMEOUT', '空闲超时');
      return fakeStream(['after-timeout']);
    });

    const result = await streamWithRetry(deps, 'model', [{ role: 'user', content: 'x' }], 'requirement');

    // 第一次 TIMEOUT 被重试，第二次成功
    expect(result).toBe('after-timeout');
    expect(calls).toBe(2);
    expect(deps.sendPanelStatus).toHaveBeenCalledWith('requirement', 0);
  });

  // 目标 6（取消注意）：当前 streamWithRetry 不接受 AbortSignal，也不建模取消/中止。
  // 此测试刻意「不发明」取消能力，只记录该缺口并断言【现有契约】：
  //   - 不可重试错误立即抛出（无重试）
  //   - 可重试错误会重试
  // 若将来引入取消，应替换本测试为真实取消断言。
  it('（缺口记录）当前未建模取消/AbortSignal —— 仅断言现有重试契约', async () => {
    // 不可重试：立即抛，无重试（不存在「取消中断」这条路径）
    let nonRetryableCalls = 0;
    const nonRetryableDeps = makeDeps(() => {
      nonRetryableCalls++;
      throw new AiAdapterError('INVALID_REQUEST', '参数错误');
    });
    await expect(
      streamWithRetry(nonRetryableDeps, 'model', [{ role: 'user', content: 'x' }], 'bom')
    ).rejects.toThrow('参数错误');
    expect(nonRetryableCalls).toBe(1);

    // 可重试：会重试（亦无法被「取消」提前打断，因为未建模）
    let retryableCalls = 0;
    const retryableDeps = makeDeps(() => {
      retryableCalls++;
      if (retryableCalls < 2) throw new AiAdapterError('RATE_LIMIT', '限流');
      return fakeStream(['ok']);
    });
    const result = await streamWithRetry(retryableDeps, 'model', [{ role: 'user', content: 'x' }], 'bom');
    expect(result).toBe('ok');
    expect(retryableCalls).toBe(2);
  });
});

// === Phase 4：用户取消（AbortSignal）===
describe('streamWithRetry 取消（AbortSignal）', () => {
  it('已 abort 的 signal → 立即 CANCELLED，不调用 adapter', async () => {
    let calls = 0;
    const deps = makeDeps(() => { calls++; return fakeStream(['x']); });
    const controller = new AbortController();
    controller.abort();

    let thrown: unknown;
    try {
      await streamWithRetry(deps, 'model', [{ role: 'user', content: 'x' }], 'bom', false, controller.signal);
    } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(AiAdapterError);
    expect((thrown as AiAdapterError).code).toBe('CANCELLED');
    expect(calls).toBe(0); // 取消应在发起流之前短路
  });

  it('CANCELLED 不可重试：直接抛出，calls=1（区别于 timeout 会重试）', async () => {
    let calls = 0;
    const deps = makeDeps(() => { calls++; throw new AiAdapterError('CANCELLED', '分析已取消'); });

    let thrown: unknown;
    try {
      await streamWithRetry(deps, 'model', [{ role: 'user', content: 'x' }], 'bom');
    } catch (e) { thrown = e; }
    expect((thrown as AiAdapterError).code).toBe('CANCELLED');
    expect(calls).toBe(1);
  });

  it('重试间隙 abort → CANCELLED，不再跑满重试', async () => {
    let calls = 0;
    const controller = new AbortController();
    const deps = makeDeps(() => {
      calls++;
      controller.abort(); // 第一次失败时取消
      throw new AiAdapterError('RATE_LIMIT', '限流');
    });

    let thrown: unknown;
    try {
      await streamWithRetry(deps, 'model', [{ role: 'user', content: 'x' }], 'bom', false, controller.signal);
    } catch (e) { thrown = e; }
    expect((thrown as AiAdapterError).code).toBe('CANCELLED');
    expect(calls).toBeLessThan(3); // maxAttempts=3，但取消后不应跑满
  });

  it('CANCELLED 不在可重试集合（与 TIMEOUT 区分）', () => {
    expect(RETRYABLE_ERRORS.has('CANCELLED')).toBe(false);
    expect(RETRYABLE_ERRORS.has('TIMEOUT')).toBe(true);
  });
});
