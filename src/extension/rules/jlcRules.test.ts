/**
 * 嘉立创兼容性规则 JR-001 ~ JR-005 单元测试
 */
import { describe, it, expect } from 'vitest';
import { jlcRules } from './jlcRules';
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

function emptyCtx(bomItems: BOMItem[] = [], pcb?: PCBLayoutPlan): RuleContext {
  return { bomItems, schematicIntent: null, pcbLayoutPlan: pcb ?? null, procurementItems: [] };
}

function findRule(id: string) {
  return jlcRules.find((r) => r.id === id)!;
}

describe('JR-001: 封装是否在嘉立创常见封装库中', () => {
  const rule = findRule('JR-001');

  it('非常见封装触发 info', () => {
    const ctx = emptyCtx([makeBom({ footprint: 'CUSTOM-WEIRD-PKG' })]);
    const findings = rule.check(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
  });

  it('常见封装不触发', () => {
    const ctx = emptyCtx([makeBom({ footprint: '0603' })]);
    expect(rule.check(ctx)).toHaveLength(0);
  });

  it('SOT-23 封装不触发', () => {
    const ctx = emptyCtx([makeBom({ footprint: 'SOT-23-5' })]);
    expect(rule.check(ctx)).toHaveLength(0);
  });
});

describe('JR-002: 器件缺少嘉立创料号', () => {
  const rule = findRule('JR-002');

  it('无料号时触发 warning', () => {
    const ctx = emptyCtx([makeBom({ jlcPartNumber: undefined })]);
    const findings = rule.check(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
  });

  it('有料号时不触发', () => {
    const ctx = emptyCtx([makeBom({ jlcPartNumber: 'C25804' })]);
    expect(rule.check(ctx)).toHaveLength(0);
  });
});

describe('JR-003: 嘉立创库存不足', () => {
  const rule = findRule('JR-003');

  it('库存低于 100 时触发', () => {
    const ctx = emptyCtx([makeBom({ jlcPartNumber: 'C12345', jlcStock: 50 })]);
    const findings = rule.check(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
  });

  it('库存充足时不触发', () => {
    const ctx = emptyCtx([makeBom({ jlcPartNumber: 'C12345', jlcStock: 5000 })]);
    expect(rule.check(ctx)).toHaveLength(0);
  });

  it('无料号时不触发（不检查库存）', () => {
    const ctx = emptyCtx([makeBom({ jlcPartNumber: undefined, jlcStock: 0 })]);
    expect(rule.check(ctx)).toHaveLength(0);
  });
});

describe('JR-004: 安全间距低于嘉立创工艺能力', () => {
  const rule = findRule('JR-004');

  it('间距 < 0.1mm 时触发', () => {
    const ctx = emptyCtx([], makePcb({
      constraints: [
        { type: 'clearance', description: 'Min clearance 0.05mm between pads', affectedComponents: ['U1'] },
      ],
    }));
    const findings = rule.check(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
  });

  it('间距 >= 0.1mm 时不触发', () => {
    const ctx = emptyCtx([], makePcb({
      constraints: [
        { type: 'clearance', description: 'Min clearance 0.15mm between pads', affectedComponents: ['U1'] },
      ],
    }));
    expect(rule.check(ctx)).toHaveLength(0);
  });
});

describe('JR-005: 最小线宽/线距低于嘉立创工艺', () => {
  const rule = findRule('JR-005');

  it('线宽 < 0.127mm 时触发', () => {
    const ctx = emptyCtx([], makePcb({
      routingGuidelines: [
        { netName: 'CLK', guideline: 'Trace width 0.1mm', category: 'signal', severity: 'mandatory' },
      ],
    }));
    const findings = rule.check(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
  });

  it('线宽 < 5mil 时触发', () => {
    const ctx = emptyCtx([], makePcb({
      routingGuidelines: [
        { netName: 'DATA', guideline: 'Trace width 3mil', category: 'signal', severity: 'mandatory' },
      ],
    }));
    expect(rule.check(ctx)).toHaveLength(1);
  });

  it('线宽 >= 0.127mm 时不触发', () => {
    const ctx = emptyCtx([], makePcb({
      routingGuidelines: [
        { netName: 'CLK', guideline: 'Trace width 0.15mm', category: 'signal', severity: 'mandatory' },
      ],
    }));
    expect(rule.check(ctx)).toHaveLength(0);
  });
});
