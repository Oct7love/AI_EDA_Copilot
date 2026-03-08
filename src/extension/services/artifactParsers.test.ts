/**
 * artifactParsers 单元测试
 * 覆盖 §14.6 要求：Prompt 解析测试 + 各阶段 JSON 解析行为
 */
import { describe, it, expect } from 'vitest';
import {
  extractJson,
  repairJson,
  parseJsonArtifact,
  parseSchematicIntent,
  parsePcbLayoutPlan,
  parseBomItems,
} from './artifactParsers';

// ── extractJson ───────────────────────────────────────

describe('extractJson', () => {
  it('提取 fenced json 代码块', () => {
    const text = 'Some text\n```json\n{"a":1}\n```\nMore text';
    expect(extractJson(text)).toBe('{"a":1}');
  });

  it('提取 fenced 无 json 标签', () => {
    const text = '```\n[1,2,3]\n```';
    expect(extractJson(text)).toBe('[1,2,3]');
  });

  it('提取裸 JSON 对象', () => {
    const text = 'Here is the result: {"key":"value"} done.';
    expect(extractJson(text)).toBe('{"key":"value"}');
  });

  it('提取裸 JSON 数组', () => {
    const text = 'Result: [{"a":1},{"b":2}] end';
    expect(extractJson(text)).toBe('[{"a":1},{"b":2}]');
  });

  it('数组出现在对象之前时优先提取数组', () => {
    const text = '[{"x":1}] and then {"y":2}';
    expect(extractJson(text)).toBe('[{"x":1}]');
  });

  it('无 JSON 时返回 trim 后的原文', () => {
    const text = '  no json here  ';
    expect(extractJson(text)).toBe('no json here');
  });
});

// ── repairJson ────────────────────────────────────────

describe('repairJson', () => {
  it('修复尾逗号', () => {
    expect(repairJson('{"a":1,}')).toBe('{"a":1}');
  });

  it('修复数组尾逗号', () => {
    expect(repairJson('[1,2,3,]')).toBe('[1,2,3]');
  });

  it('单引号替换为双引号', () => {
    expect(repairJson("{'a':'b'}")).toBe('{"a":"b"}');
  });
});

// ── parseJsonArtifact ─────────────────────────────────

describe('parseJsonArtifact', () => {
  it('正常 JSON 直接解析', () => {
    const text = '{"modules":[],"connections":[]}';
    const result = parseJsonArtifact<{ modules: unknown[] }>(text, (p) =>
      Array.isArray(p.modules) ? p : null
    );
    expect(result).toEqual({ modules: [], connections: [] });
  });

  it('需要修复的 JSON 也能解析', () => {
    const text = "{'value': 42,}";
    const result = parseJsonArtifact<{ value: number }>(text, (p) =>
      typeof p.value === 'number' ? p : null
    );
    expect(result).toEqual({ value: 42 });
  });

  it('validate 返回 null 时结果为 null', () => {
    const text = '{"wrong":"structure"}';
    const result = parseJsonArtifact<{ modules: unknown[] }>(text, (p) =>
      Array.isArray(p.modules) ? p : null
    );
    expect(result).toBeNull();
  });

  it('完全无效文本返回 null', () => {
    const result = parseJsonArtifact<unknown>('not json at all', () => ({}));
    // "not json at all" 无 JSON 结构，extractJson 返回原文，JSON.parse 报错
    // repairJson 也无法修复 → null
    expect(result).toBeNull();
  });
});

// ── parseSchematicIntent ──────────────────────────────

describe('parseSchematicIntent', () => {
  const validSchematic = JSON.stringify({
    modules: [{ id: 'power', name: 'Power', description: 'test', components: ['U1'] }],
    connections: [{ from: { designator: 'U1', pin: 'VCC' }, to: { designator: 'U2', pin: 'IN' }, netName: 'VCC_3V3', networkType: 'power' }],
    networks: [{ type: 'power', nets: ['VCC_3V3'], description: 'Power net' }],
    pinTable: [{ designator: 'U1', pin: 'VCC', netName: 'VCC_3V3', direction: 'power', description: 'Main power' }],
  });

  it('解析完整 SchematicIntent', () => {
    const result = parseSchematicIntent(validSchematic);
    expect(result).not.toBeNull();
    expect(result!.modules).toHaveLength(1);
    expect(result!.connections).toHaveLength(1);
    expect(result!.networks).toHaveLength(1);
    expect(result!.pinTable).toHaveLength(1);
  });

  it('缺少 networks 和 pinTable 时自动补空数组', () => {
    const partial = JSON.stringify({
      modules: [{ id: 'core', name: 'Core', description: 'MCU', components: [] }],
      connections: [],
    });
    const result = parseSchematicIntent(partial);
    expect(result).not.toBeNull();
    expect(result!.networks).toEqual([]);
    expect(result!.pinTable).toEqual([]);
  });

  it('缺少 modules 时返回 null', () => {
    const invalid = JSON.stringify({ connections: [] });
    expect(parseSchematicIntent(invalid)).toBeNull();
  });

  it('缺少 connections 时返回 null', () => {
    const invalid = JSON.stringify({ modules: [] });
    expect(parseSchematicIntent(invalid)).toBeNull();
  });

  it('从 fenced code block 中提取', () => {
    const text = `Here is the schematic:\n\`\`\`json\n${validSchematic}\n\`\`\`\nDone.`;
    const result = parseSchematicIntent(text);
    expect(result).not.toBeNull();
    expect(result!.modules).toHaveLength(1);
  });
});

// ── parsePcbLayoutPlan ────────────────────────────────

describe('parsePcbLayoutPlan', () => {
  const validPlan = JSON.stringify({
    boardSize: { width: 60, height: 40, source: 'ai_inferred', status: 'pending_confirmation', confidence: 0.7 },
    layerCount: { value: 2, source: 'ai_inferred', status: 'pending_confirmation', confidence: 0.8, reasoning: '2 layer sufficient' },
    zones: [{ id: 'zone-power', name: 'Power', purpose: 'Power distribution', relativePosition: 'top-left', components: ['U2'] }],
    placements: [{ designator: 'U1', zone: 'zone-mcu', placementNotes: 'Center', priority: 'critical' }],
    routingGuidelines: [{ netName: 'VCC_3V3', guideline: 'Wide traces', category: 'power', severity: 'mandatory' }],
    constraints: [{ type: 'keep_out', description: 'Antenna area', affectedComponents: ['U1'] }],
  });

  it('解析完整 PCBLayoutPlan', () => {
    const result = parsePcbLayoutPlan(validPlan);
    expect(result).not.toBeNull();
    expect(result!.boardSize.width).toBe(60);
    expect(result!.zones).toHaveLength(1);
    expect(result!.placements).toHaveLength(1);
    expect(result!.routingGuidelines).toHaveLength(1);
    expect(result!.constraints).toHaveLength(1);
  });

  it('缺少可选字段时自动补空数组', () => {
    const minimal = JSON.stringify({
      boardSize: { width: 50, height: 30, source: 'user_provided', status: 'confirmed', confidence: 1 },
      layerCount: { value: 4, source: 'user_provided', status: 'confirmed', confidence: 1, reasoning: 'User specified' },
      zones: [],
    });
    const result = parsePcbLayoutPlan(minimal);
    expect(result).not.toBeNull();
    expect(result!.placements).toEqual([]);
    expect(result!.routingGuidelines).toEqual([]);
    expect(result!.constraints).toEqual([]);
  });

  it('缺少 boardSize 时返回 null', () => {
    expect(parsePcbLayoutPlan(JSON.stringify({ zones: [] }))).toBeNull();
  });

  it('缺少 zones 时返回 null', () => {
    expect(parsePcbLayoutPlan(JSON.stringify({
      boardSize: { width: 60, height: 40, source: 'ai_inferred', status: 'pending_confirmation', confidence: 0.7 },
    }))).toBeNull();
  });

  it('修复含尾逗号的 JSON', () => {
    const broken = `{"boardSize":{"width":60,"height":40,"source":"ai_inferred","status":"pending_confirmation","confidence":0.7,},"layerCount":{"value":2,"source":"ai_inferred","status":"pending_confirmation","confidence":0.8,"reasoning":"test",},"zones":[],}`;
    const result = parsePcbLayoutPlan(broken);
    expect(result).not.toBeNull();
    expect(result!.boardSize.width).toBe(60);
  });
});

// ── parseBomItems ─────────────────────────────────────

describe('parseBomItems', () => {
  it('解析数组格式 BOM', () => {
    const text = JSON.stringify([
      { designator: 'U1', comment: 'ESP32-S3', footprint: 'QFN-56', quantity: 1 },
    ]);
    const result = parseBomItems(text);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result![0].designator).toBe('U1');
  });

  it('解析 { bomItems: [...] } 格式', () => {
    const text = JSON.stringify({
      bomItems: [{ designator: 'C1', comment: '100nF', footprint: '0402', quantity: 10 }],
    });
    const result = parseBomItems(text);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
  });

  it('自动补充默认字段', () => {
    const text = JSON.stringify([{ designator: 'R1', comment: '10K', footprint: '0402', quantity: 4 }]);
    const result = parseBomItems(text);
    expect(result![0].alternatives).toEqual([]);
    expect(result![0].validationFindings).toEqual([]);
    expect(result![0].status).toBe('pending_confirmation');
  });

  it('非数组结构返回 null', () => {
    expect(parseBomItems('{"notBom": true}')).toBeNull();
  });
});
