/** jlcsearch API 相关类型 */

export interface JlcComponent {
  lcsc: number;
  mfr: string;
  package: string;
  description: string;
  stock: number;
  price: string;
}

export interface JlcSearchResponse {
  components: JlcComponent[];
}

export interface JlcSearchParams {
  query: string;
  limit?: number;
}

/** jlcsearch 查询失败原因（用于区分故障与「无结果」） */
export type JlcSearchFailureReason = 'network_error' | 'api_error' | 'parse_error' | 'timeout';

/** jlcsearch 查询结果：成功带 components，失败带 reason */
export type JlcSearchResult =
  | { ok: true; components: JlcComponent[] }
  | { ok: false; reason: JlcSearchFailureReason };
