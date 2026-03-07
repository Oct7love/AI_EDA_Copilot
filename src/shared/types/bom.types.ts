/** BOM 领域类型 — 对齐 BACKEND_STRUCTURE.md §4.3 */

import type { FieldSource, FieldStatus } from './artifacts.types';

export interface AlternativePart {
  comment: string;
  footprint: string;
  jlcPartNumber?: string;
  jlcProductUrl?: string;
  reason: string;
  rank: number;
}

export interface ValidationFinding {
  ruleId: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  suggestion?: string;
}

export interface BOMItem {
  // 核心必填（对齐嘉立创 BOM 规范）
  designator: string;
  comment: string;
  footprint: string;
  quantity: number;

  // JLC 集成（由 ProcurementService 回填）
  jlcPartNumber?: string;
  jlcProductUrl?: string;
  jlcStock?: number;
  jlcPrice?: number;

  // 扩展详情
  description?: string;
  category: string;
  manufacturer?: string;
  mpn?: string;
  subsystem: string;

  // AI 标注
  source: FieldSource;
  status: FieldStatus | 'rejected';
  confidence: number;
  reasoning?: string;

  // 替代件
  alternatives: AlternativePart[];

  // 规则校验（Phase 6 填充）
  validationFindings: ValidationFinding[];
}
