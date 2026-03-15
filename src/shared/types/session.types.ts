/** 会话管理类型 — 历史对话 + 分析产物持久化 */

import type { RequirementSpec, OverviewData } from './artifacts.types';
import type { BOMItem } from './bom.types';
import type { ProcurementItem } from './procurement.types';
import type { SchematicIntent } from './schematic.types';
import type { PCBLayoutPlan } from './pcb.types';
import type { DesignReviewResult } from './designReview.types';
import type { FormInputData } from './input.types';

/** 对话消息（从 inputStore 提升为共享类型） */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

/** 会话中保存的全部分析产物 */
export interface SessionArtifacts {
  requirementSpec: RequirementSpec | null;
  overview: OverviewData | null;
  bomItems: BOMItem[];
  procurementItems: ProcurementItem[];
  schematicIntent: SchematicIntent | null;
  pcbLayoutPlan: PCBLayoutPlan | null;
  designReviewResult: DesignReviewResult | null;
}

/** 完整会话数据（存储到 JSON 文件） */
export interface SessionData {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  conversation: ChatMessage[];
  artifacts: SessionArtifacts;
  inputMode: 'chat' | 'form';
  formData?: FormInputData;
}

/** 会话索引条目（轻量，用于列表展示） */
export interface SessionIndexEntry {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}
