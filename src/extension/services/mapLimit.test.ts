/**
 * mapLimit 单元测试 — 并发上限 / 输入顺序 / 边界 / 错误隔离
 */
import { describe, it, expect } from 'vitest';
import { mapLimit } from './mapLimit';

/** 手动控制 resolve 时机的延迟工具 */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('mapLimit', () => {
  it('同一时刻在飞数量不超过 limit', async () => {
    const items = Array.from({ length: 12 }, (_, i) => i);
    let inFlight = 0;
    let peak = 0;

    const results = await mapLimit(items, 3, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return n * 2;
    });

    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1); // 确实并发了，不是退化成串行
    expect(results).toEqual(items.map((n) => n * 2));
  });

  it('结果按输入顺序返回，与完成先后无关', async () => {
    // 让靠后的项先完成、靠前的项后完成
    const defs = [deferred<string>(), deferred<string>(), deferred<string>()];
    const items = ['a', 'b', 'c'];

    const promise = mapLimit(items, 3, async (item, i) => {
      return defs[i].promise.then(() => `${item}!`);
    });

    // 逆序兑现
    defs[2].resolve('');
    defs[0].resolve('');
    defs[1].resolve('');

    const results = await promise;
    expect(results).toEqual(['a!', 'b!', 'c!']);
  });

  it('空输入返回空数组', async () => {
    let called = 0;
    const results = await mapLimit([], 5, async () => {
      called += 1;
      return 1;
    });
    expect(results).toEqual([]);
    expect(called).toBe(0);
  });

  it('limit >= 长度时一次性全部并发', async () => {
    const items = [1, 2, 3];
    let inFlight = 0;
    let peak = 0;
    const results = await mapLimit(items, 10, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return n + 1;
    });
    expect(peak).toBe(3);
    expect(results).toEqual([2, 3, 4]);
  });

  it('某项抛错不影响其它项执行，但整体最终 reject（第一个出错的 index）', async () => {
    const ran: number[] = [];
    await expect(
      mapLimit([0, 1, 2, 3], 2, async (n) => {
        ran.push(n);
        if (n === 1) throw new Error('boom-1');
        if (n === 3) throw new Error('boom-3');
        return n;
      }),
    ).rejects.toThrow('boom-1');
    // 所有项都被执行过（错误被隔离，未提前短路其它槽位）
    expect(ran.sort()).toEqual([0, 1, 2, 3]);
  });
});
