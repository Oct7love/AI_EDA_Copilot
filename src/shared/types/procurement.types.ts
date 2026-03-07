/** 采购领域类型 — 对齐 BACKEND_STRUCTURE.md §4.6 */

export interface ProcurementAlternative {
  jlcPartNumber: string;
  jlcProductUrl: string;
  comment: string;
  footprint: string;
  reason: string;
  rank: number;
}

export interface ProcurementItem {
  designator: string;
  comment: string;
  footprint: string;

  jlcCompatibility: 'compatible' | 'partial' | 'incompatible' | 'unknown';
  matchType: 'exact' | 'footprint_compatible' | 'functionally_similar' | 'unknown';
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
