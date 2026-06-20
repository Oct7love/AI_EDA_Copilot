/**
 * AI 产物 JSON 解析器 — 纯函数，可独立测试
 * 职责：从 AI 原始文本输出中提取、解析、校验、修复 JSON 产物
 * 不做：网络请求、状态管理、消息推送
 */
import type { RequirementSpec, BOMItem, SchematicIntent, PCBLayoutPlan, DesignReviewFinding } from '@shared/types';
import type { AnalysisRequest } from '@shared/types';

// ── 通用 JSON 提取 ────────────────────────────────────

/** 从 AI 文本输出中提取 JSON 块：返回首个候选；无候选时返回 trim 后原文 */
export function extractJson(text: string): string {
  const candidates = extractJsonCandidates(text);
  return candidates.length > 0 ? candidates[0] : text.trim();
}

/**
 * 枚举文本中所有顶层 JSON 候选（按出现顺序）。
 * - 优先 ```json fenced``` 代码块（可多个）
 * - 否则用括号配平扫描：正确忽略字符串内部的 {}[] 与转义字符，
 *   支持对象 {} 与数组 []、多段候选、以及不完整 JSON（返回到结尾的片段交给解析/修复兜底）
 */
export function extractJsonCandidates(text: string): string[] {
  const out: string[] = [];

  const fenceRe = /```(?:json)?\s*\n?([\s\S]*?)\n?```/gi;
  let fence: RegExpExecArray | null;
  while ((fence = fenceRe.exec(text)) !== null) {
    const inner = fence[1].trim();
    const scanned = scanBalanced(inner, 0);
    out.push(scanned ? scanned.json : inner);
  }
  if (out.length > 0) return out;

  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '{' || ch === '[') {
      const scanned = scanBalanced(text, i);
      if (scanned) {
        out.push(scanned.json);
        i = scanned.end + 1;
        continue;
      }
    }
    i++;
  }
  return out;
}

/**
 * 从 start（必须是 { 或 [）开始括号配平扫描，返回 { json, end }。
 * 跟踪双引号字符串状态与 \ 转义，忽略字符串内部的括号。
 * 深度未归零（不完整）时返回 start 到结尾的片段，end 指向末字符。
 */
function scanBalanced(text: string, start: number): { json: string; end: number } | null {
  const open = text[start];
  if (open !== '{' && open !== '[') return null;
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === '\\') {
        i++; // 跳过被转义的字符
        continue;
      }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) return { json: text.slice(start, i + 1), end: i };
    }
  }
  return { json: text.slice(start), end: text.length - 1 };
}

/** 尝试修复常见 JSON 问题（单引号字符串字面量、尾逗号） */
export function repairJson(json: string): string {
  let repaired = convertSingleQuotedStrings(json);
  repaired = repaired.replace(/,\s*([\]}])/g, '$1');
  return repaired;
}

/**
 * 仅把"单引号字符串字面量"转换为双引号，保留双引号字符串内部的撇号。
 *
 * 旧实现用全局 /'/g 替换，会把形如 "LDO's output" / "don't place" 的合法值
 * 中的撇号也换成双引号，导致字符串提前终止、把可修复的解析变成不可修复。
 * 这里用状态机逐字符扫描：处于双引号字符串内时原样保留（含撇号），
 * 仅在字符串外遇到单引号时才将其作为单引号字面量转为双引号。
 */
function convertSingleQuotedStrings(input: string): string {
  let out = '';
  let inDouble = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inDouble) {
      if (ch === '\\') {
        out += ch;
        i++;
        if (i < input.length) out += input[i];
      } else {
        out += ch;
        if (ch === '"') inDouble = false;
      }
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      out += ch;
      continue;
    }
    if (ch === "'") {
      // 收集到下一个未转义的单引号，作为字符串体
      let body = '';
      i++;
      while (i < input.length && input[i] !== "'") {
        if (input[i] === '\\' && i + 1 < input.length) {
          const next = input[i + 1];
          body += next === "'" ? "'" : '\\' + next; // \' → '，其余转义保留
          i += 2;
        } else {
          body += input[i];
          i++;
        }
      }
      body = body.replace(/"/g, '\\"'); // 内部裸双引号需转义
      out += `"${body}"`;
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * 通用 JSON 产物解析：extractJson → JSON.parse → validate → 修复重试
 * validate 参数类型为 any 因为 JSON.parse 返回 any，由各回调负责结构校验与窄化
 */
export function parseJsonArtifact<T>(
  text: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON.parse 返回 any，校验/窄化由各回调内部负责
  validate: (parsed: any) => T | null,
): T | null {
  const candidates = extractJsonCandidates(text);
  // 无结构化候选时仍尝试一次 trim 后的原文（与旧行为兼容）
  const toTry = candidates.length > 0 ? candidates : [text.trim()];

  for (const cand of toTry) {
    try {
      const r = validate(JSON.parse(cand));
      if (r) return r;
    } catch {
      /* 原样解析失败，尝试修复 */
    }
    try {
      const r = validate(JSON.parse(repairJson(cand)));
      if (r) return r;
    } catch {
      /* 该候选不可用，尝试下一个 */
    }
  }
  return null;
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

/** 合法的 severity 枚举值（与 FindingSeverity 对齐） */
const VALID_SEVERITIES = new Set(['critical', 'warning', 'info']);

/** 解析 DesignReviewFinding[] JSON — AI 设计审查结果 */
export function parseDesignReviewFindings(text: string): DesignReviewFinding[] | null {
  return parseJsonArtifact<DesignReviewFinding[]>(text, (parsed) => {
    const items = Array.isArray(parsed) ? parsed : parsed.findings ?? null;
    if (!Array.isArray(items)) return null;
    for (const item of items) {
      item.affectedComponents = item.affectedComponents ?? [];
      item.confidence = item.confidence ?? 0.7;
      item.ruleSource = 'ai_analysis';
      // 归一化 severity：AI 可能漂移出枚举（如 'high'/'major'），下游 UI 据此查表，
      // 非枚举值会使 FindingCard 渲染抛错并白屏，故在边界处兜底为 'warning'
      if (!VALID_SEVERITIES.has(item.severity)) item.severity = 'warning';
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
