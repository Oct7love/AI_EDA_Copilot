/**
 * 符号冲突展示层的纯函数（无 React / 无 DOM，便于 node 环境单测）。
 *
 * 把 CodeAnalysisResult.symbolConflicts 转成可直接渲染的行数据：
 * 每行包含符号名、人类可读的冲突类型标签、各定义出处（file:line = value）、复核问题。
 *
 * 注意：这是启发式静态扫描的结果，不是编译器解析，行数据仅供人工复核。
 */
import type { SymbolConflict } from '../../../shared/types';

/** 单个符号冲突的展示行（已格式化，可直接渲染） */
export interface ConflictRow {
  /** 冲突的标识符名（如 LED_PIN） */
  symbol: string;
  /** 人类可读的冲突类型标签（如 '重复定义'） */
  kind: string;
  /** 各定义出处，每条形如 `path:line = value` */
  locations: string[];
  /** 建议向用户提出的复核问题 */
  question: string;
}

/** conflictType -> 人类可读标签 */
const CONFLICT_KIND_LABELS: Record<SymbolConflict['conflictType'], string> = {
  redefinition: '重复定义',
};

/** 把 conflictType 映射为人类可读标签，未知类型回退为原始值 */
function kindLabel(conflictType: SymbolConflict['conflictType']): string {
  return CONFLICT_KIND_LABELS[conflictType] ?? conflictType;
}

/**
 * 把符号冲突列表转成展示行。
 * @param conflicts 可选的符号冲突列表（来自 CodeAnalysisResult.symbolConflicts）
 * @returns 展示行数组；当输入为 undefined / 空数组时返回 []
 */
export function buildConflictRows(conflicts: SymbolConflict[] | undefined): ConflictRow[] {
  if (!conflicts || conflicts.length === 0) return [];

  return conflicts.map((conflict) => ({
    symbol: conflict.symbol,
    kind: kindLabel(conflict.conflictType),
    locations: conflict.definitions.map((d) => `${d.file}:${d.line} = ${d.value}`),
    question: conflict.question,
  }));
}
