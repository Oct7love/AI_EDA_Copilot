/**
 * AI 产物 JSON 解析器 — 纯函数，可独立测试
 * 职责：从 AI 原始文本输出中提取、解析、校验、修复 JSON 产物
 * 不做：网络请求、状态管理、消息推送
 */
import type { RequirementSpec, BOMItem, SchematicIntent, PCBLayoutPlan, DesignReviewFinding } from '@shared/types';
import type { AnalysisRequest } from '@shared/types';

// ── 通用 JSON 提取 ────────────────────────────────────

/** 从 AI 文本输出中提取 JSON 块：支持 ```json ``` 包裹、对象 {} 和数组 [] */
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenced) return fenced[1].trim();

  const objStart = text.indexOf('{');
  const arrStart = text.indexOf('[');

  if (arrStart !== -1 && (objStart === -1 || arrStart < objStart)) {
    const arrEnd = text.lastIndexOf(']');
    if (arrEnd > arrStart) return text.slice(arrStart, arrEnd + 1);
  }

  if (objStart !== -1) {
    const objEnd = text.lastIndexOf('}');
    if (objEnd > objStart) return text.slice(objStart, objEnd + 1);
  }

  return text.trim();
}

/** 尝试修复常见 JSON 问题（尾逗号、单引号） */
export function repairJson(json: string): string {
  let repaired = json;
  repaired = repaired.replace(/,\s*([\]}])/g, '$1');
  repaired = repaired.replace(/'/g, '"');
  return repaired;
}

/**
 * 通用 JSON 产物解析：extractJson → JSON.parse → validate → 修复重试
 * validate 参数类型为 any 因为 JSON.parse 返回 any，由各回调负责结构校验
 */
export function parseJsonArtifact<T>(
  text: string,
  validate: (parsed: any) => T | null,
): T | null {
  const tryParse = (raw: string): T | null => {
    try {
      return validate(JSON.parse(raw));
    } catch {
      return null;
    }
  };

  const json = extractJson(text);
  const result = tryParse(json);
  if (result) return result;

  return tryParse(repairJson(json));
}

// ── 各阶段解析器 ──────────────────────────────────────

/** 解析 SchematicIntent JSON — 校验必需字段 modules + connections 存在 */
export function parseSchematicIntent(text: string): SchematicIntent | null {
  return parseJsonArtifact<SchematicIntent>(text, (parsed) => {
    if (!Array.isArray(parsed.modules) || !Array.isArray(parsed.connections)) return null;
    parsed.networks = parsed.networks ?? [];
    parsed.pinTable = parsed.pinTable ?? [];
    // JSON.parse → 结构校验通过后断言为目标类型
    return parsed as SchematicIntent;
  });
}

/** 解析 PCBLayoutPlan JSON — 校验必需字段 boardSize + zones 存在 */
export function parsePcbLayoutPlan(text: string): PCBLayoutPlan | null {
  return parseJsonArtifact<PCBLayoutPlan>(text, (parsed) => {
    if (!parsed.boardSize || !Array.isArray(parsed.zones)) return null;
    parsed.placements = parsed.placements ?? [];
    parsed.routingGuidelines = parsed.routingGuidelines ?? [];
    parsed.constraints = parsed.constraints ?? [];
    // JSON.parse → 结构校验通过后断言为目标类型
    return parsed as PCBLayoutPlan;
  });
}

/** 解析 BOMItem[] JSON — 支持数组或 { bomItems: [...] } 格式 */
export function parseBomItems(text: string): BOMItem[] | null {
  return parseJsonArtifact<BOMItem[]>(text, (parsed) => {
    const items = Array.isArray(parsed) ? parsed : parsed.bomItems ?? parsed.bom ?? null;
    if (!Array.isArray(items)) return null;
    for (const item of items) {
      item.alternatives = item.alternatives ?? [];
      item.validationFindings = item.validationFindings ?? [];
      item.status = item.status ?? 'pending_confirmation';
    }
    return items as BOMItem[];
  });
}

/** 解析 DesignReviewFinding[] JSON — AI 设计审查结果 */
export function parseDesignReviewFindings(text: string): DesignReviewFinding[] | null {
  return parseJsonArtifact<DesignReviewFinding[]>(text, (parsed) => {
    const items = Array.isArray(parsed) ? parsed : parsed.findings ?? null;
    if (!Array.isArray(items)) return null;
    for (const item of items) {
      item.affectedComponents = item.affectedComponents ?? [];
      item.confidence = item.confidence ?? 0.7;
      item.ruleSource = 'ai_analysis';
    }
    return items as DesignReviewFinding[];
  });
}

/** 解析 RequirementSpec JSON — 补充元数据字段 */
export function parseRequirementSpec(text: string, request?: AnalysisRequest): RequirementSpec | null {
  return parseJsonArtifact<RequirementSpec>(text, (parsed) => {
    parsed.createdAt = parsed.createdAt ?? new Date().toISOString();
    parsed.source = parsed.source ?? (request?.inputType ?? 'natural_language');
    parsed.rawInput = parsed.rawInput ?? (request?.rawText ?? '');
    if (Array.isArray(parsed.openQuestions)) {
      for (const q of parsed.openQuestions) {
        q.resolved = q.resolved ?? false;
      }
    }
    // RequirementSpec 无必需字段强校验（AI 输出结构可能不完整）
    return parsed as RequirementSpec;
  });
}
