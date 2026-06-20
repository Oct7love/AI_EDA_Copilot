/**
 * JLCPCB 料号查询适配器，封装 jlcsearch API，隔离外部接口细节。
 *
 * 返回 JlcSearchResult 区分「成功（可能 0 结果）」与「故障」：
 * 网络失败 / 超时 / 接口非 2xx / 响应结构异常都返回 ok:false + reason，
 * 不再静默吞成空数组，避免上层把故障误判为「无此料号」。
 */
import type { JlcComponent, JlcSearchParams, JlcSearchResult } from '@shared/types';

const BASE_URL = 'https://jlcsearch.tscircuit.com';
const DEFAULT_LIMIT = 5;
const REQUEST_TIMEOUT_MS = 8000;

export class JlcAdapter {
  /**
   * 搜索元器件。
   * @param signal 可选外部 AbortSignal；与内部 8s 超时合并，任一触发即中止本次 fetch。
   *               外部中止与超时都映射为 reason:'timeout'（均表现为 AbortError），不抛异常。
   */
  async searchComponents(params: JlcSearchParams, signal?: AbortSignal): Promise<JlcSearchResult> {
    const { query, limit = DEFAULT_LIMIT } = params;
    if (!query.trim()) return { ok: true, components: [] };

    // 外部已中止：直接短路，不发请求
    if (signal?.aborted) return { ok: false, reason: 'timeout' };

    const url = `${BASE_URL}/api/search?q=${encodeURIComponent(query)}&limit=${limit}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    // 外部 signal 中止时，连带中止本次请求
    const onExternalAbort = () => controller.abort();
    signal?.addEventListener('abort', onExternalAbort, { once: true });

    let res: Response;
    try {
      res = await fetch(url, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      });
    } catch (err) {
      // abort（超时或外部中止）→ timeout；其它（DNS/连接/fetch failed）→ network_error
      const aborted = err instanceof Error && err.name === 'AbortError';
      return { ok: false, reason: aborted ? 'timeout' : 'network_error' };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onExternalAbort);
    }

    if (!res.ok) return { ok: false, reason: 'api_error' };

    let data: { components?: JlcComponent[] };
    try {
      data = (await res.json()) as { components?: JlcComponent[] };
    } catch {
      return { ok: false, reason: 'parse_error' };
    }

    if (!data || !Array.isArray(data.components)) {
      // 响应结构异常（缺 components 字段）
      return { ok: false, reason: 'parse_error' };
    }
    return { ok: true, components: data.components };
  }

  /** 生成立创商城产品链接 */
  static productUrl(lcsc: number): string {
    return `https://www.lcsc.com/product-detail/C${lcsc}.html`;
  }
}
