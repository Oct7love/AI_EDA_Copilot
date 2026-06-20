/** 采购领域类型 — 对齐 BACKEND_STRUCTURE.md §4.6 */

export interface ProcurementAlternative {
  jlcPartNumber: string;
  jlcProductUrl: string;
  comment: string;
  footprint: string;
  reason: string;
  rank: number;
}

/** JLC 查询/库存状态：区分真实无货与接口/网络/解析故障 */
export type ProcurementQueryStatus =
  | 'in_stock'
  | 'out_of_stock'
  | 'not_found'
  | 'api_error'
  | 'network_error'
  | 'timeout'
  | 'parse_error'
  | 'unknown';

export interface ProcurementItem {
  designator: string;
  comment: string;
  footprint: string;

  jlcCompatibility: 'compatible' | 'partial' | 'incompatible' | 'unknown';
  matchType: 'exact' | 'footprint_compatible' | 'functionally_similar' | 'unknown';
  /** 查询/库存状态：区分真实无货与查询故障，避免把接口失败显示成无货 */
  queryStatus: ProcurementQueryStatus;
  jlcPartNumber?: string;
  jlcProductUrl?: string;
  jlcStock?: number;
  jlcPrice?: number;
  jlcStockQueryTime?: string;

  smtReadiness: 'ready' | 'missing_footprint' | 'missing_part' | 'manual_only';
  smtIssues: string[];

  alternatives: ProcurementAlternative[];
  recommendation: string;
}
