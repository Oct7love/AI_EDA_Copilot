/**
 * Extension ↔ Webview 消息协议类型定义，所有 postMessage 必须遵循此格式
 */
import type { PipelineStage, ReportSection } from './pipeline.types';
import type { RequirementSpec, OverviewData } from './artifacts.types';
import type { BOMItem } from './bom.types';
import type { ProcurementItem } from './procurement.types';
import type { SchematicIntent } from './schematic.types';
import type { PCBLayoutPlan } from './pcb.types';
import type { DesignReviewResult } from './designReview.types';
import type { SessionIndexEntry, ChatMessage } from './session.types';
import type { FormInputData } from './input.types';
import type { ArtifactState, ArtifactKey } from './artifactState.types';

/** 消息方向标识 */
export type MessageSource = 'panel' | 'report' | 'extension';

/** 基础消息结构：所有 postMessage 必须遵循此格式 */
export interface BaseMessage<T extends string, P = void> {
  type: T;
  source: MessageSource;
  payload: P;
  timestamp: number;
}

// ─── 侧边栏 → Extension ─────────────────────────────

export type PanelToExtension =
  | BaseMessage<'submit_requirement', { text: string; mode: 'chat' | 'form' }>
  | BaseMessage<'analyze_workspace', { folderPath: string }>
  | BaseMessage<'select_template', { templateId: string }>
  | BaseMessage<'open_report', { projectId: string; schemeId: string }>
  | BaseMessage<'switch_mode', { mode: 'chat' | 'form' }>
  | BaseMessage<'regenerate', { projectId: string; schemeId: string; feedback: string }>
  | BaseMessage<'start_bom', void>
  | BaseMessage<'session_list', void>
  | BaseMessage<'session_save', { name?: string }>
  | BaseMessage<'session_new', void>
  | BaseMessage<'session_switch', { sessionId: string }>
  | BaseMessage<'session_delete', { sessionId: string }>
  | BaseMessage<'session_rename', { sessionId: string; name: string }>;

// ─── Extension → 侧边栏 ─────────────────────────────

export type ExtensionToPanel =
  | BaseMessage<'ai_chat_response', { content: string; isStreaming: boolean }>
  | BaseMessage<'ai_question', { question: string; options?: string[] }>
  | BaseMessage<'generation_status', { stage: PipelineStage; progress: number }>
  | BaseMessage<'error', { code: string; message: string }>
  | BaseMessage<'session_list_response', { sessions: SessionIndexEntry[] }>
  | BaseMessage<'session_loaded', { sessionId: string; name: string; conversation: ChatMessage[]; inputMode: 'chat' | 'form'; formData?: FormInputData }>
  | BaseMessage<'session_cleared', void>
  | BaseMessage<'session_saved', { sessionId: string; name: string }>;

// ─── Extension → 报告页 ──────────────────────────────

export type ExtensionToReport =
  | BaseMessage<'report_data', { report: { requirementSpec: RequirementSpec; overview: OverviewData }; isStreaming: boolean }>
  | BaseMessage<'report_stream_chunk', { section: ReportSection; content: string }>
  | BaseMessage<'report_stream_end', { report: unknown }>  // 未来流式结束回传，结构待定
  | BaseMessage<'comparison_data', { schemes: unknown[] }>  // Phase 7 方案对比，结构待定
  | BaseMessage<'bom_data', { bomItems: BOMItem[]; isStreaming: boolean }>
  | BaseMessage<'procurement_data', { procurementItems: ProcurementItem[] }>
  | BaseMessage<'schematic_data', { schematicIntent: SchematicIntent }>
  | BaseMessage<'pcb_layout_data', { pcbLayoutPlan: PCBLayoutPlan }>
  | BaseMessage<'design_review_data', { designReviewResult: DesignReviewResult }>
  | BaseMessage<'artifact_status', { state: ArtifactState }>
  | BaseMessage<'session_cleared', void>;

// ─── 报告页 → Extension ──────────────────────────────

export type ReportToExtension =
  | BaseMessage<'export_request', { format: 'csv' | 'markdown' | 'json'; section?: ReportSection }>
  | BaseMessage<'open_external_link', { url: string }>
  | BaseMessage<'requirement_edit', { field: string; value: unknown }>
  | BaseMessage<'regenerate_stage', { stage: ArtifactKey; mode: 'single' | 'cascade' }>
  | BaseMessage<'version_request', { projectId: string; version: number }>
  | BaseMessage<'bom_export', void>;

// ─── 工具函数类型 ────────────────────────────────────

/** 创建带时间戳的消息 */
export function createMessage<T extends string, P>(
  type: T,
  source: MessageSource,
  payload: P
): BaseMessage<T, P> {
  return { type, source, payload, timestamp: Date.now() };
}
