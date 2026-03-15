/** 设计审查类型 — 对齐 BACKEND_STRUCTURE.md §4.7 + §8.3 */

import type { BOMItem } from './bom.types';
import type { SchematicIntent } from './schematic.types';
import type { PCBLayoutPlan } from './pcb.types';
import type { ProcurementItem } from './procurement.types';

/** 审查发现分类 */
export type FindingCategory =
  | 'power_ripple'
  | 'signal_integrity'
  | 'thermal'
  | 'footprint_match'
  | 'clearance'
  | 'layout'
  | 'general';

/** 严重程度 */
export type FindingSeverity = 'critical' | 'warning' | 'info';

/** 规则来源标识 */
export type RuleSource = 'hard_rule' | 'warning_rule' | 'jlc_rule' | 'ai_analysis';

/** 审查涉及的管线阶段 */
export type FindingStage = 'bom' | 'schematic' | 'pcb_layout' | 'cross_stage';

/** 单条设计审查发现 — Phase 6 核心产物 */
export interface DesignReviewFinding {
  id: string;
  category: FindingCategory;
  severity: FindingSeverity;
  title: string;
  description: string;
  affectedComponents: string[];
  suggestion: string;
  stage: FindingStage;
  ruleSource: RuleSource;
  /** AI findings 置信度 0-1，规则 findings 固定为 1 */
  confidence: number;
}

/** 设计审查汇总结果 */
export interface DesignReviewResult {
  findings: DesignReviewFinding[];
  summary: {
    criticalCount: number;
    warningCount: number;
    infoCount: number;
  };
  reviewedAt: string;
}

/** 规则检查上下文 — 传入所有上游产物供规则引擎消费 */
export interface RuleContext {
  bomItems: BOMItem[];
  schematicIntent: SchematicIntent | null;
  pcbLayoutPlan: PCBLayoutPlan | null;
  procurementItems: ProcurementItem[];
}

/** 规则分类 */
export type RuleCategory = 'hard' | 'warning' | 'jlc_compatibility';

/** 规则接口 — 规则引擎注册单元 */
export interface Rule {
  id: string;
  category: RuleCategory;
  severity: FindingSeverity;
  title: string;
  description: string;
  appliesTo: ('bom' | 'schematic' | 'pcb_layout')[];
  enabled: boolean;
  check: (ctx: RuleContext) => DesignReviewFinding[];
}
