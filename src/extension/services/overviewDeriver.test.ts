/**
 * overviewDeriver 单元测试 — deriveOverview 纯函数行为验证
 */
import { describe, it, expect } from 'vitest';
import { deriveOverview } from './overviewDeriver';
import type { RequirementSpec, RequirementField, OpenQuestion } from '@shared/types';

/** 构建最小 RequirementField */
function field<T = string>(value: T | null, source: 'user_provided' | 'ai_inferred' = 'user_provided'): RequirementField<T> {
  return { value, source, status: 'confirmed', confidence: 1 };
}

/** 构建最小合法 RequirementSpec */
function makeSpec(overrides: Partial<RequirementSpec> = {}): RequirementSpec {
  return {
    projectName: field('测试项目'),
    createdAt: new Date().toISOString(),
    source: 'natural_language',
    rawInput: '测试输入',
    projectDescription: field('一个测试项目'),
    mcu: field('STM32F103'),
    power: field('5V USB'),
    communication: field(['UART', 'SPI']),
    display: field('OLED 0.96"'),
    sensors: field(['温度', '湿度']),
    costRange: field('50-100 元'),
    sizeLimit: field('50x50mm'),
    productionIntent: field('原型验证'),
    powerConsumption: field('< 500mA'),
    precision: field(null),
    additionalNotes: field(null),
    functionalModules: [],
    openQuestions: [],
    ...overrides,
  };
}

describe('deriveOverview', () => {
  it('全字段填充时 readinessScore 接近 100', () => {
    const spec = makeSpec();
    // precision 和 additionalNotes 为 null，11/13 字段填充
    const overview = deriveOverview(spec);
    expect(overview.readinessScore).toBe(Math.round((11 / 13) * 100));
    expect(overview.filledFields).toBe(11);
    expect(overview.totalFields).toBe(13);
  });

  it('正确统计 userProvided vs aiInferred', () => {
    const spec = makeSpec({
      mcu: field('ESP32', 'ai_inferred'),
      power: field('3.3V LDO', 'ai_inferred'),
    });
    const overview = deriveOverview(spec);
    expect(overview.aiInferredCount).toBe(2);
    expect(overview.userProvidedCount).toBe(11 - 2); // 9 user + 2 null
  });

  it('MCU 未确定时生成风险提示', () => {
    const spec = makeSpec({ mcu: field(null) });
    const overview = deriveOverview(spec);
    expect(overview.risks).toContain('MCU 未确定，后续 BOM/原理图无法推进');
  });

  it('供电未确定时生成风险提示', () => {
    const spec = makeSpec({ power: field(null) });
    const overview = deriveOverview(spec);
    expect(overview.risks).toContain('供电方案未明确，影响整体设计');
  });

  it('关键开放问题生成风险提示', () => {
    const questions: OpenQuestion[] = [
      { id: 'q1', question: '使用什么通信协议？', context: '', priority: 'critical', resolved: false },
      { id: 'q2', question: '尺寸限制？', context: '', priority: 'optional', resolved: false },
    ];
    const spec = makeSpec({ openQuestions: questions });
    const overview = deriveOverview(spec);
    expect(overview.risks.some(r => r.includes('1 个关键待确认问题'))).toBe(true);
  });

  it('收集关键组件列表', () => {
    const spec = makeSpec();
    const overview = deriveOverview(spec);
    expect(overview.keyComponents).toContain('STM32F103');
    expect(overview.keyComponents).toContain('OLED 0.96"');
    expect(overview.keyComponents).toContain('UART');
    expect(overview.keyComponents).toContain('温度');
  });

  it('projectSummary 优先使用 projectDescription', () => {
    const spec = makeSpec();
    const overview = deriveOverview(spec);
    expect(overview.projectSummary).toBe('一个测试项目');
  });

  it('projectDescription 为空时回退 projectName', () => {
    const spec = makeSpec({ projectDescription: field(null) });
    const overview = deriveOverview(spec);
    expect(overview.projectSummary).toBe('测试项目');
  });

  it('全空时 projectSummary 为默认值', () => {
    const spec = makeSpec({ projectDescription: field(null), projectName: field(null) });
    const overview = deriveOverview(spec);
    expect(overview.projectSummary).toBe('未命名项目');
  });

  it('有开放问题时 nextSteps 包含回答提示', () => {
    const questions: OpenQuestion[] = [
      { id: 'q1', question: '什么协议？', context: '', priority: 'important', resolved: false },
    ];
    const spec = makeSpec({ openQuestions: questions });
    const overview = deriveOverview(spec);
    expect(overview.nextSteps).toContain('回答开放问题以提高需求完整度');
  });

  it('缺失字段时 nextSteps 包含补充提示', () => {
    const spec = makeSpec({ precision: field(null) });
    const overview = deriveOverview(spec);
    expect(overview.nextSteps).toContain('补充缺失的需求字段');
  });
});
