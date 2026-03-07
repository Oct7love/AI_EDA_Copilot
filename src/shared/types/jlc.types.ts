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
