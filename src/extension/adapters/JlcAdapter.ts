import type { JlcComponent, JlcSearchParams } from '@shared/types';

const BASE_URL = 'https://jlcsearch.tscircuit.com';
const DEFAULT_LIMIT = 5;
const REQUEST_TIMEOUT_MS = 8000;

export class JlcAdapter {
  /** 搜索元器件 */
  async searchComponents(params: JlcSearchParams): Promise<JlcComponent[]> {
    const { query, limit = DEFAULT_LIMIT } = params;
    if (!query.trim()) return [];

    const url = `${BASE_URL}/api/search?q=${encodeURIComponent(query)}&limit=${limit}`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'Accept': 'application/json' },
      });

      clearTimeout(timer);

      if (!res.ok) return [];

      const data = await res.json() as { components?: JlcComponent[] };
      return data.components ?? [];
    } catch {
      return [];
    }
  }

  /** 生成立创商城产品链接 */
  static productUrl(lcsc: number): string {
    return `https://www.lcsc.com/product-detail/C${lcsc}.html`;
  }
}
