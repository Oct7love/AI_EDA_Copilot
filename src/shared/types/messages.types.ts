import type { PipelineStage, ReportSection } from './pipeline.types';

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
  | BaseMessage<'start_bom', void>;

// ─── Extension → 侧边栏 ─────────────────────────────

export type ExtensionToPanel =
  | BaseMessage<'ai_chat_response', { content: string; isStreaming: boolean }>
  | BaseMessage<'ai_question', { question: string; options?: string[] }>
  | BaseMessage<'generation_status', { stage: PipelineStage; progress: number }>
  | BaseMessage<'error', { code: string; message: string }>;

// ─── Extension → 报告页 ──────────────────────────────

export type ExtensionToReport =
  | BaseMessage<'report_data', { report: unknown; isStreaming: boolean }>
  | BaseMessage<'report_stream_chunk', { section: ReportSection; content: string }>
  | BaseMessage<'report_stream_end', { report: unknown }>
  | BaseMessage<'comparison_data', { schemes: unknown[] }>
  | BaseMessage<'bom_data', { bomItems: unknown[]; isStreaming: boolean }>
  | BaseMessage<'procurement_data', { procurementItems: unknown[] }>;

// ─── 报告页 → Extension ──────────────────────────────

export type ReportToExtension =
  | BaseMessage<'export_request', { format: 'csv' | 'markdown' | 'json'; section?: ReportSection }>
  | BaseMessage<'open_external_link', { url: string }>
  | BaseMessage<'requirement_edit', { field: string; value: unknown }>
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
