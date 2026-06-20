/**
 * 产物快照收集与规整 — 纯逻辑、可独立单测。
 *
 * - collectArtifacts: 从 pipeline 缓存收集完整产物（含 procurement / designReview / overview），
 *   修复此前快照恒丢 procurement / designReview 的问题。
 * - normalizeArtifacts: 规整从存储读到的产物，补齐缺失字段，旧/损坏快照安全 fallback（不抛错）。
 */
import type {
  SessionArtifacts,
  RequirementSpec,
  BOMItem,
  ProcurementItem,
  SchematicIntent,
  PCBLayoutPlan,
  DesignReviewResult,
} from '@shared/types';
import { deriveOverview } from './overviewDeriver';

/** pipeline 缓存视图（仅取构建快照所需字段） */
export interface ArtifactCaches {
  requirementSpec: RequirementSpec | null;
  bomItems: BOMItem[];
  procurementItems: ProcurementItem[];
  schematicIntent: SchematicIntent | null;
  pcbLayoutPlan: PCBLayoutPlan | null;
  designReviewResult: DesignReviewResult | null;
}

/** 从缓存收集完整产物快照（含 procurement / designReview / overview） */
export function collectArtifacts(c: ArtifactCaches): SessionArtifacts {
  return {
    requirementSpec: c.requirementSpec,
    overview: c.requirementSpec ? safeDeriveOverview(c.requirementSpec) : null,
    bomItems: c.bomItems ?? [],
    procurementItems: c.procurementItems ?? [],
    schematicIntent: c.schematicIntent,
    pcbLayoutPlan: c.pcbLayoutPlan,
    designReviewResult: c.designReviewResult,
  };
}

/**
 * 规整从存储读到的产物：补齐缺失字段，旧/损坏快照安全 fallback。
 * 任何字段缺失或类型异常都退回安全默认值，绝不抛错。
 */
export function normalizeArtifacts(a: Partial<SessionArtifacts> | null | undefined): SessionArtifacts {
  const spec = a?.requirementSpec ?? null;
  let overview = a?.overview ?? null;
  if (!overview && spec) overview = safeDeriveOverview(spec);
  return {
    requirementSpec: spec,
    overview,
    bomItems: Array.isArray(a?.bomItems) ? a!.bomItems : [],
    procurementItems: Array.isArray(a?.procurementItems) ? a!.procurementItems : [],
    schematicIntent: a?.schematicIntent ?? null,
    pcbLayoutPlan: a?.pcbLayoutPlan ?? null,
    designReviewResult: a?.designReviewResult ?? null,
  };
}

/** deriveOverview 对损坏 spec 可能抛错，此处兜底为 null */
function safeDeriveOverview(spec: RequirementSpec) {
  try {
    return deriveOverview(spec);
  } catch {
    return null;
  }
}
