/**
 * 硬性规则 HR-001 ~ HR-006 单元测试
 * 每条规则至少 1 个正面（触发）+ 1 个负面（不触发）用例
 */
import { describe, it, expect } from 'vitest';
import { hardRules } from './hardRules';
import type { RuleContext, BOMItem } from '@shared/types';

/** 构建最小 BOMItem */
function makeBom(overrides: Partial<BOMItem> = {}): BOMItem {
  return {
    designator: 'U1',
    comment: 'ESP32-S3',
    footprint: 'QFN-56',
    quantity: 1,
    category: 'MCU',
    subsystem: 'Core',
    source: 'user_provided',
    status: 'confirmed',
    confidence: 1,
    alternatives: [],
    validationFindings: [],
    ...overrides,
  };
}

function emptyCtx(bomItems: BOMItem[] = []): RuleContext {
  return { bomItems, schematicIntent: null, pcbLayoutPlan: null, procurementItems: [] };
}

function findRule(id: string) {
  return hardRules.find((r) => r.id === id)!;
}

describe('HR-001: 封装字段不可为空', () => {
  const rule = findRule('HR-001');

  it('封装为空时触发 critical', () => {
    const ctx = emptyCtx([makeBom({ footprint: '' })]);
    const findings = rule.check(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('critical');
  });

  it('封装存在时不触发', () => {
    const ctx = emptyCtx([makeBom({ footprint: 'QFN-56' })]);
    expect(rule.check(ctx)).toHaveLength(0);
  });
});

describe('HR-002: 位号不可重复', () => {
  const rule = findRule('HR-002');

  it('位号重复时触发 critical', () => {
    const ctx = emptyCtx([
      makeBom({ designator: 'U1' }),
      makeBom({ designator: 'U1', comment: 'STM32' }),
    ]);
    const findings = rule.check(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('critical');
    expect(findings[0].description).toContain('2 次');
  });

  it('位号唯一时不触发', () => {
    const ctx = emptyCtx([
      makeBom({ designator: 'U1' }),
      makeBom({ designator: 'U2' }),
    ]);
    expect(rule.check(ctx)).toHaveLength(0);
  });
});

describe('HR-003: 电源引脚必须有去耦电容', () => {
  const rule = findRule('HR-003');

  it('IC 多于去耦电容时触发', () => {
    const ctx = emptyCtx([
      makeBom({ designator: 'U1', category: 'MCU' }),
      makeBom({ designator: 'U2', category: 'Sensor' }),
    ]);
    const findings = rule.check(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('critical');
  });

  it('去耦电容充足时不触发', () => {
    const ctx = emptyCtx([
      makeBom({ designator: 'U1', category: 'MCU' }),
      makeBom({ designator: 'C1', comment: '100nF', footprint: '0402', category: 'Capacitor' }),
    ]);
    expect(rule.check(ctx)).toHaveLength(0);
  });

  it('无 IC 时不触发', () => {
    const ctx = emptyCtx([
      makeBom({ designator: 'R1', comment: '10K', category: 'Resistor' }),
    ]);
    expect(rule.check(ctx)).toHaveLength(0);
  });
});

describe('HR-004: MCU 复位引脚需要复位电路', () => {
  const rule = findRule('HR-004');

  it('有 MCU 但无复位连接时触发', () => {
    const ctx: RuleContext = {
      bomItems: [makeBom({ designator: 'U1', comment: 'STM32F103', category: 'MCU' })],
      schematicIntent: { modules: [], connections: [], networks: [], pinTable: [] },
      pcbLayoutPlan: null,
      procurementItems: [],
    };
    const findings = rule.check(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('critical');
  });

  it('有 MCU 且有复位连接时不触发', () => {
    const ctx: RuleContext = {
      bomItems: [makeBom({ designator: 'U1', comment: 'STM32F103', category: 'MCU' })],
      schematicIntent: {
        modules: [],
        connections: [{
          from: { designator: 'U1', pin: 'NRST' },
          to: { designator: 'R1', pin: '1' },
          netName: 'NRST',
          networkType: 'control',
        }],
        networks: [],
        pinTable: [],
      },
      pcbLayoutPlan: null,
      procurementItems: [],
    };
    expect(rule.check(ctx)).toHaveLength(0);
  });
});

describe('HR-005: 晶振需要配对负载电容', () => {
  const rule = findRule('HR-005');

  it('有晶振但负载电容不足时触发', () => {
    const ctx = emptyCtx([
      makeBom({ designator: 'Y1', comment: '8MHz Crystal', category: 'Crystal' }),
    ]);
    const findings = rule.check(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('critical');
  });

  it('晶振配有两个负载电容时不触发', () => {
    const ctx = emptyCtx([
      makeBom({ designator: 'Y1', comment: '8MHz Crystal', category: 'Crystal' }),
      makeBom({ designator: 'C10', comment: '20pF', footprint: '0402', category: 'Capacitor' }),
      makeBom({ designator: 'C11', comment: '20pF', footprint: '0402', category: 'Capacitor' }),
    ]);
    expect(rule.check(ctx)).toHaveLength(0);
  });
});

describe('HR-006: 电源走线宽度不低于安全阈值', () => {
  const rule = findRule('HR-006');

  it('有电源走线规则但无线宽约束时触发', () => {
    const ctx: RuleContext = {
      bomItems: [],
      schematicIntent: null,
      pcbLayoutPlan: {
        boardSize: { width: 60, height: 40, source: 'ai_inferred', status: 'pending_confirmation', confidence: 0.7 },
        layerCount: { value: 2, source: 'ai_inferred', status: 'pending_confirmation', confidence: 0.8, reasoning: 'test' },
        zones: [],
        placements: [],
        routingGuidelines: [
          { netName: 'VCC_3V3', guideline: 'Use direct path', category: 'power', severity: 'mandatory' },
        ],
        constraints: [],
      },
      procurementItems: [],
    };
    const findings = rule.check(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('critical');
  });

  it('电源走线含线宽约束时不触发', () => {
    const ctx: RuleContext = {
      bomItems: [],
      schematicIntent: null,
      pcbLayoutPlan: {
        boardSize: { width: 60, height: 40, source: 'ai_inferred', status: 'pending_confirmation', confidence: 0.7 },
        layerCount: { value: 2, source: 'ai_inferred', status: 'pending_confirmation', confidence: 0.8, reasoning: 'test' },
        zones: [],
        placements: [],
        routingGuidelines: [
          { netName: 'VCC_3V3', guideline: 'Width >= 0.5mm, direct path', category: 'power', severity: 'mandatory' },
        ],
        constraints: [],
      },
      procurementItems: [],
    };
    expect(rule.check(ctx)).toHaveLength(0);
  });
});
