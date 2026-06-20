/**
 * JlcAdapter 单元测试 — 区分成功/无结果与各类故障（不再静默吞成空数组）
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { JlcAdapter } from './JlcAdapter';

const adapter = new JlcAdapter();

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('JlcAdapter.searchComponents', () => {
  it('空查询直接返回 ok 空结果（不发请求）', async () => {
    const r = await adapter.searchComponents({ query: '   ' });
    expect(r).toEqual({ ok: true, components: [] });
  });

  it('正常返回组件 → ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        components: [{ lcsc: 1, mfr: 'X', package: '0402', description: 'd', stock: 100, price: '0.1' }],
      }),
    }));
    const r = await adapter.searchComponents({ query: '100nF 0402' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.components).toHaveLength(1);
  });

  it('HTTP 非 2xx → api_error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    expect(await adapter.searchComponents({ query: 'x' })).toEqual({ ok: false, reason: 'api_error' });
  });

  it('网络异常 → network_error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')));
    expect(await adapter.searchComponents({ query: 'x' })).toEqual({ ok: false, reason: 'network_error' });
  });

  it('AbortError（超时）→ timeout', async () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err));
    expect(await adapter.searchComponents({ query: 'x' })).toEqual({ ok: false, reason: 'timeout' });
  });

  it('JSON 解析抛错 → parse_error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => { throw new Error('bad json'); },
    }));
    expect(await adapter.searchComponents({ query: 'x' })).toEqual({ ok: false, reason: 'parse_error' });
  });

  it('响应缺 components 字段（结构异常）→ parse_error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ foo: 1 }) }));
    expect(await adapter.searchComponents({ query: 'x' })).toEqual({ ok: false, reason: 'parse_error' });
  });

  it('外部 signal 预先 abort → timeout，且不发起请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort();
    const r = await adapter.searchComponents({ query: 'x' }, controller.signal);
    expect(r).toEqual({ ok: false, reason: 'timeout' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('外部 signal 在请求期间 abort → fetch 因 AbortError 拒绝 → timeout（无真实网络）', async () => {
    const controller = new AbortController();
    // 模拟 fetch：响应传入的 signal，被 abort 时以 AbortError 拒绝
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
      ),
    );
    const promise = adapter.searchComponents({ query: 'x' }, controller.signal);
    controller.abort(); // 触发外部中止 → 连带中止内部 fetch
    expect(await promise).toEqual({ ok: false, reason: 'timeout' });
  });
});
