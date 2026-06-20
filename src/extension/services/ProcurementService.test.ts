/**
 * ProcurementService 单元测试 — 查询状态区分 + 兼容性诚实化 + 数值解析
 */
import { describe, it, expect } from 'vitest';
import { ProcurementService } from './ProcurementService';
import type { JlcAdapter } from '../adapters/JlcAdapter';
import type { JlcSearchResult, BOMItem, JlcComponent } from '@shared/types';

/** 注入一个固定返回的假 adapter */
function fakeAdapter(result: JlcSearchResult): JlcAdapter {
  return { searchComponents: async () => result } as unknown as JlcAdapter;
}

function makeBom(overrides: Partial<BOMItem> = {}): BOMItem {
  return {
    designator: 'C1', comment: '100nF', footprint: '0402', quantity: 1,
    category: 'Capacitor', subsystem: 'Power', source: 'ai_inferred',
    status: 'pending_confirmation', confidence: 0.8, alternatives: [], validationFindings: [],
    ...overrides,
  };
}

function comp(stock: number, pkg = '0402', price = '0.01'): JlcComponent {
  return { lcsc: 12345, mfr: 'ACME', package: pkg, description: 'cap', stock, price };
}

describe('ProcurementService 查询状态区分', () => {
  it('有货 → in_stock / ready', async () => {
    const svc = new ProcurementService(fakeAdapter({ ok: true, components: [comp(500)] }));
    const [r] = await svc.matchAll([makeBom()]);
    expect(r.queryStatus).toBe('in_stock');
    expect(r.smtReadiness).toBe('ready');
    expect(r.jlcPartNumber).toBe('C12345');
  });

  it('匹配到但库存 0 → out_of_stock（非查询失败）', async () => {
    const svc = new ProcurementService(fakeAdapter({ ok: true, components: [comp(0)] }));
    const [r] = await svc.matchAll([makeBom()]);
    expect(r.queryStatus).toBe('out_of_stock');
  });

  it('接口正常但无结果 → not_found', async () => {
    const svc = new ProcurementService(fakeAdapter({ ok: true, components: [] }));
    const [r] = await svc.matchAll([makeBom()]);
    expect(r.queryStatus).toBe('not_found');
    expect(r.smtIssues).toContain('未找到匹配料号');
  });

  it('网络失败 → network_error，且不标成无货(missing_part)', async () => {
    const svc = new ProcurementService(fakeAdapter({ ok: false, reason: 'network_error' }));
    const [r] = await svc.matchAll([makeBom()]);
    expect(r.queryStatus).toBe('network_error');
    expect(r.smtReadiness).not.toBe('missing_part');
    expect(r.smtIssues.join('')).toContain('查询失败');
  });

  it('接口异常 → api_error', async () => {
    const svc = new ProcurementService(fakeAdapter({ ok: false, reason: 'api_error' }));
    const [r] = await svc.matchAll([makeBom()]);
    expect(r.queryStatus).toBe('api_error');
  });

  it('返回结构异常/解析失败 → parse_error', async () => {
    const svc = new ProcurementService(fakeAdapter({ ok: false, reason: 'parse_error' }));
    const [r] = await svc.matchAll([makeBom()]);
    expect(r.queryStatus).toBe('parse_error');
  });
});

describe('ProcurementService 诚实化与数值解析', () => {
  it('封装匹配只标 partial / footprint_compatible，不夸大为 compatible/exact', async () => {
    const svc = new ProcurementService(fakeAdapter({ ok: true, components: [comp(500, '0402')] }));
    const [r] = await svc.matchAll([makeBom({ footprint: '0402' })]);
    expect(r.jlcCompatibility).toBe('partial');
    expect(r.matchType).toBe('footprint_compatible');
  });

  it('价格 0 不被丢成 undefined', async () => {
    const svc = new ProcurementService(fakeAdapter({ ok: true, components: [comp(500, '0402', '0')] }));
    const [r] = await svc.matchAll([makeBom()]);
    expect(r.jlcPrice).toBe(0);
  });
});

/** 记录并发峰值 + 调用次数的可控 adapter，每次查询返回固定有货组件 */
function instrumentedAdapter(opts: { delayMs?: number } = {}) {
  const { delayMs = 5 } = opts;
  let inFlight = 0;
  let peak = 0;
  let calls = 0;
  const adapter = {
    async searchComponents(): Promise<JlcSearchResult> {
      calls += 1;
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, delayMs));
      inFlight -= 1;
      return { ok: true, components: [comp(500)] };
    },
  } as unknown as JlcAdapter;
  return {
    adapter,
    get peak() { return peak; },
    get calls() { return calls; },
  };
}

describe('ProcurementService 并发匹配', () => {
  it('大 BOM 结果顺序与输入顺序一致', async () => {
    // 每个 designator 唯一，结果按 designator 校验顺序
    const inst = instrumentedAdapter();
    const svc = new ProcurementService(inst.adapter);
    const bom = Array.from({ length: 12 }, (_, i) =>
      makeBom({ designator: `D${i}`, comment: `c${i}` }),
    );
    const results = await svc.matchAll(bom);
    expect(results.map((r) => r.designator)).toEqual(bom.map((b) => b.designator));
  });

  it('并发被限制在 <= 5', async () => {
    const inst = instrumentedAdapter();
    const svc = new ProcurementService(inst.adapter);
    const bom = Array.from({ length: 12 }, (_, i) => makeBom({ designator: `D${i}` }));
    await svc.matchAll(bom);
    expect(inst.peak).toBeLessThanOrEqual(5);
    expect(inst.peak).toBeGreaterThan(1); // 确实并发了
  });

  it('onProgress 在每项完成时累进触发，最终 = total', async () => {
    const inst = instrumentedAdapter();
    const svc = new ProcurementService(inst.adapter);
    const bom = Array.from({ length: 6 }, (_, i) => makeBom({ designator: `D${i}` }));
    const seen: number[] = [];
    await svc.matchAll(bom, (current, total) => {
      expect(total).toBe(6);
      seen.push(current);
    });
    expect(seen).toHaveLength(6);
    expect(Math.max(...seen)).toBe(6);
    expect(new Set(seen).size).toBe(6); // 单调唯一计数
  });

  it('单项查询失败不拖垮整批，仍返回全长结果且其它项完好', async () => {
    // 第 3 项（index 2）返回网络故障，其它有货
    const adapter = {
      async searchComponents(params: { query: string }): Promise<JlcSearchResult> {
        if (params.query.startsWith('FAIL')) return { ok: false, reason: 'network_error' };
        return { ok: true, components: [comp(500)] };
      },
    } as unknown as JlcAdapter;
    const svc = new ProcurementService(adapter);
    const bom = [
      makeBom({ designator: 'D0', comment: 'ok0' }),
      makeBom({ designator: 'D1', comment: 'ok1' }),
      makeBom({ designator: 'D2', comment: 'FAIL' }),
      makeBom({ designator: 'D3', comment: 'ok3' }),
    ];
    const results = await svc.matchAll(bom);
    expect(results).toHaveLength(4);
    expect(results.map((r) => r.designator)).toEqual(['D0', 'D1', 'D2', 'D3']);
    expect(results[2].queryStatus).toBe('network_error');
    expect(results[0].queryStatus).toBe('in_stock');
    expect(results[3].queryStatus).toBe('in_stock');
  });
});

describe('ProcurementService 中止（AbortSignal）', () => {
  it('开始前已 abort → 不再发起任何 adapter 调用，全部良性 timeout', async () => {
    const inst = instrumentedAdapter();
    const svc = new ProcurementService(inst.adapter);
    const bom = Array.from({ length: 6 }, (_, i) => makeBom({ designator: `D${i}` }));
    const controller = new AbortController();
    controller.abort();

    const results = await svc.matchAll(bom, undefined, controller.signal);
    expect(inst.calls).toBe(0); // 没有任何查询发起
    expect(results).toHaveLength(6);
    for (const r of results) {
      expect(r.queryStatus).toBe('timeout');
      expect(r.smtReadiness).not.toBe('missing_part'); // 中止 ≠ 无货
    }
  });

  it('中途 abort → abort 后不再发起新查询（调用次数受限），结果保持有效状态', async () => {
    // 每次查询前检查：第一项完成后触发 abort，后续项应短路
    let calls = 0;
    const controller = new AbortController();
    const adapter = {
      async searchComponents(): Promise<JlcSearchResult> {
        calls += 1;
        // 第一项查询期间触发中止
        if (calls === 1) controller.abort();
        await new Promise((r) => setTimeout(r, 5));
        return { ok: true, components: [comp(500)] };
      },
    } as unknown as JlcAdapter;
    const svc = new ProcurementService(adapter);
    // 串行可控：concurrency=5，但只有已在飞的会继续；abort 后未开始的会短路
    const bom = Array.from({ length: 20 }, (_, i) => makeBom({ designator: `D${i}` }));

    const results = await svc.matchAll(bom, undefined, controller.signal);
    expect(results).toHaveLength(20);
    // abort 后未发起的查询应被短路，调用次数远小于 20（至多 ~并发数）
    expect(calls).toBeLessThanOrEqual(5);
    // 每项 queryStatus 必须是合法状态（中止项为 timeout）
    const valid = new Set([
      'in_stock', 'out_of_stock', 'not_found', 'api_error', 'network_error', 'timeout', 'parse_error', 'unknown',
    ]);
    for (const r of results) expect(valid.has(r.queryStatus)).toBe(true);
    expect(results.some((r) => r.queryStatus === 'timeout')).toBe(true);
  });
});
