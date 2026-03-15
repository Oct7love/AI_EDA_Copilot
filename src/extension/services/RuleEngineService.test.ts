/**
 * RuleEngineService 综合测试 — 多规则同时执行 + 统计汇总
 */
import { describe, it, expect } from 'vitest';
import { runAllRules } from './RuleEngineService';
import type { RuleContext, BOMItem } from '@shared/types';

function makeBom(overrides: Partial<BOMItem> = {}): BOMItem {
  return {
    designator: 'U1', comment: 'ESP32', footprint: 'QFN-56', quantity: 1,
    category: 'MCU', subsystem: 'Core', source: 'user_provided',
    status: 'confirmed', confidence: 1, alternatives: [], validationFindings: [],
    ...overrides,
  };
}

describe('runAllRules', () => {
  it('空 BOM 不产生 BOM 相关 findings', () => {
    const ctx: RuleContext = {
      bomItems: [],
      schematicIntent: null,
      pcbLayoutPlan: null,
      procurementItems: [],
    };
    const result = runAllRules(ctx);
    expect(result.findings.length).toBe(0);
    expect(result.summary.criticalCount).toBe(0);
    expect(result.summary.warningCount).toBe(0);
    expect(result.summary.infoCount).toBe(0);
    expect(result.reviewedAt).toBeTruthy();
  });

  it('多条规则同时触发时正确统计', () => {
    const ctx: RuleContext = {
      bomItems: [
        makeBom({ designator: 'U1', footprint: '', category: 'MCU', comment: 'STM32F103' }), // HR-001 + HR-003
        makeBom({ designator: 'U1', footprint: 'LQFP-48', category: 'MCU', comment: 'STM32' }), // HR-002 (重复位号)
      ],
      schematicIntent: null,
      pcbLayoutPlan: null,
      procurementItems: [],
    };
    const result = runAllRules(ctx);
    // 至少应有 HR-001（空封装）+ HR-002（重复位号）+ HR-003（去耦不足）
    expect(result.summary.criticalCount).toBeGreaterThanOrEqual(3);
    expect(result.findings.some((f) => f.id.startsWith('HR-001'))).toBe(true);
    expect(result.findings.some((f) => f.id.startsWith('HR-002'))).toBe(true);
    expect(result.findings.some((f) => f.id.startsWith('HR-003'))).toBe(true);
  });

  it('JR-002 检测无料号器件', () => {
    const ctx: RuleContext = {
      bomItems: [
        makeBom({ designator: 'R1', comment: '10K', footprint: '0402', category: 'Resistor' }),
      ],
      schematicIntent: null,
      pcbLayoutPlan: null,
      procurementItems: [],
    };
    const result = runAllRules(ctx);
    expect(result.findings.some((f) => f.id.startsWith('JR-002'))).toBe(true);
  });

  it('summary 统计与 findings 数量一致', () => {
    const ctx: RuleContext = {
      bomItems: [makeBom({ footprint: '0603', jlcPartNumber: 'C12345', jlcStock: 5000 })],
      schematicIntent: null,
      pcbLayoutPlan: null,
      procurementItems: [],
    };
    const result = runAllRules(ctx);
    const criticals = result.findings.filter((f) => f.severity === 'critical').length;
    const warnings = result.findings.filter((f) => f.severity === 'warning').length;
    const infos = result.findings.filter((f) => f.severity === 'info').length;
    expect(result.summary.criticalCount).toBe(criticals);
    expect(result.summary.warningCount).toBe(warnings);
    expect(result.summary.infoCount).toBe(infos);
  });
});
