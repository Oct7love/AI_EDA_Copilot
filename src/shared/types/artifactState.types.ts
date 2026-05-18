/**
 * Artifact 状态管理类型定义
 * 用于跟踪各阶段产物的有效性（valid/stale/generating/error）
 * 对齐 BACKEND_STRUCTURE §7.2/§7.3
 */

/** 单个产物的状态 */
export type ArtifactStatus = 'valid' | 'stale' | 'generating' | 'error';

/** 产物键（对齐 PipelineStage，但使用 camelCase） */
export type ArtifactKey =
  | 'requirement'
  | 'bom'
  | 'schematic'
  | 'pcbLayout'
  | 'procurement'
  | 'designReview';

/** 所有产物的状态快照 */
export interface ArtifactState {
  requirement: ArtifactStatus;
  bom: ArtifactStatus;
  schematic: ArtifactStatus;
  pcbLayout: ArtifactStatus;
  procurement: ArtifactStatus;
  designReview: ArtifactStatus;
}

/**
 * 级联失效映射（BACKEND_STRUCTURE §7.2）
 * 修改某产物时，其所有下游产物都应标记为 stale
 */
export const DOWNSTREAM_MAP: Record<ArtifactKey, ArtifactKey[]> = {
  requirement: ['bom', 'schematic', 'pcbLayout', 'procurement', 'designReview'],
  bom: ['schematic', 'pcbLayout', 'procurement', 'designReview'],
  schematic: ['pcbLayout', 'designReview'],
  pcbLayout: ['designReview'],
  procurement: [],
  designReview: [],
};

/** 所有产物键列表 */
export const ALL_ARTIFACT_KEYS: ArtifactKey[] = [
  'requirement', 'bom', 'schematic', 'pcbLayout', 'procurement', 'designReview',
];

/** 创建初始状态（全部 valid） */
export function createInitialArtifactState(): ArtifactState {
  return {
    requirement: 'valid',
    bom: 'valid',
    schematic: 'valid',
    pcbLayout: 'valid',
    procurement: 'valid',
    designReview: 'valid',
  };
}
