/**
 * 警告规则 WR-001 ~ WR-006 单元测试
 */
import { describe, it, expect } from 'vitest';
import { warningRules } from './warningRules';
import type { RuleContext, BOMItem, PCBLayoutPlan } from '@shared/types';

function makeBom(overrides: Partial<BOMItem> = {}): BOMItem {
  return {
    designator: 'U1', comment: 'ESP32', footprint: 'QFN-56', quantity: 1,
    category: 'MCU', subsystem: 'Core', source: 'user_provided',
    status: 'confirmed', confidence: 1, alternatives: [], validationFindings: [],
    ...overrides,
  };
}

function makePcb(overrides: Partial<PCBLayoutPlan> = {}): PCBLayoutPlan {
  return {
    boardSize: { width: 60, height: 40, source: 'ai_inferred', status: 'pending_confirmation', confidence: 0.7 },
    layerCount: { value: 2, source: 'ai_inferred', status: 'pending_confirmation', confidence: 0.8, reasoning: 'test' },
    zones: [], placements: [], routingGuidelines: [], constraints: [],
    ...overrides,
  };
}

function findRule(id: string) {
  return warningRules.find((r) => r.id === id)!;
}

describe('WR-001: 去耦电容应就近放置', () => {
  const rule = findRule('WR-001');

  it('IC 所在分区无电容时触发', () => {
    const ctx: RuleContext = {
      bomItems: [],
      schematicIntent: null,
      pcbLayoutPlan: makePcb({
        placements: [
          { designator: 'U1', zone: 'zone-mcu', placementNotes: '', priority: 'critical' },
        ],
      }),
      procurementItems: [],
    };
    const findings = rule.check(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
  });

  it('IC 所在分区有电容时不触发', () => {
    const ctx: RuleContext = {
      bomItems: [],
      schematicIntent: null,
      pcbLayoutPlan: makePcb({
        placements: [
          { designator: 'U1', zone: 'zone-mcu', placementNotes: '', priority: 'critical' },
          { designator: 'C1', zone: 'zone-mcu', placementNotes: '', priority: 'important' },
        ],
      }),
      procurementItems: [],
    };
    expect(rule.check(ctx)).toHaveLength(0);
  });
});

describe('WR-002: 高速信号走线等长匹配', () => {
  const rule = findRule('WR-002');

  it('有高速信号但无等长匹配时触发', () => {
    const ctx: RuleContext = {
      bomItems: [],
      schematicIntent: null,
      pcbLayoutPlan: makePcb({
        routingGuidelines: [
          { netName: 'SPI_CLK', guideline: 'Short trace recommended', category: 'signal', severity: 'recommended' },
        ],
      }),
      procurementItems: [],
    };
    expect(rule.check(ctx)).toHaveLength(1);
  });

  it('走线规则含等长匹配时不触发', () => {
    const ctx: RuleContext = {
      bomItems: [],
      schematicIntent: null,
      pcbLayoutPlan: makePcb({
        routingGuidelines: [
          { netName: 'SPI_CLK', guideline: 'Length match with SPI_MOSI', category: 'signal', severity: 'recommended' },
        ],
      }),
      procurementItems: [],
    };
    expect(rule.check(ctx)).toHaveLength(0);
  });
});

describe('WR-003: 天线区域应保持净空', () => {
  const rule = findRule('WR-003');

  it('有天线但无 keep-out 时触发', () => {
    const ctx: RuleContext = {
      bomItems: [makeBom({ designator: 'ANT1', comment: 'PCB Antenna', category: 'Antenna' })],
      schematicIntent: null,
      pcbLayoutPlan: makePcb({ constraints: [] }),
      procurementItems: [],
    };
    expect(rule.check(ctx)).toHaveLength(1);
  });

  it('有天线且有 keep-out 时不触发', () => {
    const ctx: RuleContext = {
      bomItems: [makeBom({ designator: 'ANT1', comment: 'PCB Antenna', category: 'Antenna' })],
      schematicIntent: null,
      pcbLayoutPlan: makePcb({
        constraints: [{ type: 'keep_out', description: 'Antenna keep-out zone', affectedComponents: ['ANT1'] }],
      }),
      procurementItems: [],
    };
    expect(rule.check(ctx)).toHaveLength(0);
  });
});

describe('WR-004: 大功率器件散热', () => {
  const rule = findRule('WR-004');

  it('有功率器件但无散热约束时触发', () => {
    const ctx: RuleContext = {
      bomItems: [makeBom({ designator: 'U2', comment: 'AMS1117-3.3 LDO', category: 'Power Regulator' })],
      schematicIntent: null,
      pcbLayoutPlan: makePcb({ constraints: [] }),
      procurementItems: [],
    };
    expect(rule.check(ctx)).toHaveLength(1);
  });

  it('有散热约束时不触发', () => {
    const ctx: RuleContext = {
      bomItems: [makeBom({ designator: 'U2', comment: 'AMS1117-3.3 LDO', category: 'Power Regulator' })],
      schematicIntent: null,
      pcbLayoutPlan: makePcb({
        constraints: [{ type: 'thermal', description: 'Thermal via array under U2', affectedComponents: ['U2'] }],
      }),
      procurementItems: [],
    };
    expect(rule.check(ctx)).toHaveLength(0);
  });
});

describe('WR-005: 差分对间距', () => {
  const rule = findRule('WR-005');

  it('有差分走线但无间距规则时触发', () => {
    const ctx: RuleContext = {
      bomItems: [],
      schematicIntent: null,
      pcbLayoutPlan: makePcb({
        routingGuidelines: [
          { netName: 'USB_D+/D-', guideline: 'Route as differential pair', category: 'differential', severity: 'mandatory' },
        ],
      }),
      procurementItems: [],
    };
    expect(rule.check(ctx)).toHaveLength(1);
  });

  it('差分走线含间距规则时不触发', () => {
    const ctx: RuleContext = {
      bomItems: [],
      schematicIntent: null,
      pcbLayoutPlan: makePcb({
        routingGuidelines: [
          { netName: 'USB_D+/D-', guideline: '90Ω differential, spacing 0.15mm', category: 'differential', severity: 'mandatory' },
        ],
      }),
      procurementItems: [],
    };
    expect(rule.check(ctx)).toHaveLength(0);
  });
});

describe('WR-006: 精密模拟器件在板边', () => {
  const rule = findRule('WR-006');

  it('模拟器件在板边区域时触发', () => {
    const ctx: RuleContext = {
      bomItems: [makeBom({ designator: 'U3', comment: 'ADS1115 ADC', category: 'ADC' })],
      schematicIntent: null,
      pcbLayoutPlan: makePcb({
        placements: [
          { designator: 'U3', zone: 'edge-connector', placementNotes: '', priority: 'important' },
        ],
      }),
      procurementItems: [],
    };
    expect(rule.check(ctx)).toHaveLength(1);
  });

  it('模拟器件不在板边时不触发', () => {
    const ctx: RuleContext = {
      bomItems: [makeBom({ designator: 'U3', comment: 'ADS1115 ADC', category: 'ADC' })],
      schematicIntent: null,
      pcbLayoutPlan: makePcb({
        placements: [
          { designator: 'U3', zone: 'zone-sensor', placementNotes: '', priority: 'important' },
        ],
      }),
      procurementItems: [],
    };
    expect(rule.check(ctx)).toHaveLength(0);
  });
});
