/**
 * withIdleTimeout 单元测试 — 正常成功 / 空闲超时 / 错误可读 / 状态正确结束
 */
import { describe, it, expect } from 'vitest';
import { withIdleTimeout, IdleTimeoutError } from './withIdleTimeout';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 每个 chunk 间隔 gapMs 产出 */
async function* paced(values: string[], gapMs: number): AsyncGenerator<string> {
  for (const v of values) {
    await delay(gapMs);
    yield v;
  }
}

/** 产出 first 后挂起 hangMs（模拟流中途停滞） */
async function* stalls(first: string, hangMs: number): AsyncGenerator<string> {
  yield first;
  await delay(hangMs);
  yield 'never-reached';
}

describe('withIdleTimeout', () => {
  it('正常成功：所有 chunk 在空闲阈值内产出', async () => {
    const out: string[] = [];
    for await (const c of withIdleTimeout(paced(['a', 'b', 'c'], 5), 100)) {
      out.push(c);
    }
    expect(out).toEqual(['a', 'b', 'c']);
  });

  it('空闲超时：中途停滞触发 IdleTimeoutError 并调用 onIdle', async () => {
    let aborted = false;
    const collected: string[] = [];
    const run = async () => {
      for await (const c of withIdleTimeout(stalls('a', 500), 40, () => { aborted = true; })) {
        collected.push(c);
      }
    };
    await expect(run()).rejects.toBeInstanceOf(IdleTimeoutError);
    expect(collected).toEqual(['a']); // 第一个产出成功，之后停滞被拦截
    expect(aborted).toBe(true);
  });

  it('首个 chunk 迟迟不来也会超时（覆盖连接后无响应）', async () => {
    const run = async () => {
      for await (const _ of withIdleTimeout(paced(['a'], 500), 30)) { /* noop */ }
    };
    await expect(run()).rejects.toBeInstanceOf(IdleTimeoutError);
  });

  it('错误信息可读且包含秒数', async () => {
    const run = async () => {
      for await (const _ of withIdleTimeout(stalls('a', 500), 2000)) { /* noop */ }
    };
    // 用较大阈值确保不在本用例触发；改为直接构造错误验证文案
    void run; // 不实际跑长用例
    const err = new IdleTimeoutError(90000);
    expect(err.message).toContain('90s');
    expect(err.name).toBe('IdleTimeoutError');
  });

  it('超时后生成器正确结束（可被 try/catch 捕获，不挂起）', async () => {
    let caught: unknown = null;
    try {
      for await (const _ of withIdleTimeout(stalls('a', 500), 30)) { /* noop */ }
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(IdleTimeoutError);
  });
});
