/** 管线阶段标识（内部逻辑用） */
export type PipelineStage =
  | 'requirement'
  | 'bom'
  | 'schematic'
  | 'pcb_layout'
  | 'procurement'
  | 'design_review';

/** 报告板块标识（UI 展示用） */
export type ReportSection =
  | 'overview'
  | 'requirements'
  | 'bom'
  | 'schematic_intent'
  | 'pcb_layout'
  | 'procurement';
