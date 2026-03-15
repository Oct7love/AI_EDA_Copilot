/**
 * 嘉立创兼容性规则 JR-001 ~ JR-005
 * severity: warning / info — 影响 JLCPCB 制造和贴装
 */
import type { Rule, RuleContext, DesignReviewFinding } from '@shared/types';

/** 嘉立创常见封装前缀列表（不完整，V1 启发式匹配） */
const JLC_COMMON_FOOTPRINTS = [
  '0201', '0402', '0603', '0805', '1206', '1210', '2512',
  'SOT-23', 'SOT-223', 'SOT-363', 'SOT-89',
  'SOP-8', 'SOP-16', 'SSOP-', 'TSSOP-', 'MSOP-',
  'QFP-', 'LQFP-', 'TQFP-',
  'QFN-', 'DFN-',
  'BGA-',
  'TO-252', 'TO-263', 'TO-220',
  'USB-', 'TYPE-C',
  'SMD', 'SMT',
];

function finding(
  ruleId: string,
  severity: DesignReviewFinding['severity'],
  title: string,
  description: string,
  suggestion: string,
  affected: string[],
  stage: DesignReviewFinding['stage'] = 'bom',
): DesignReviewFinding {
  return {
    id: `${ruleId}-${Date.now()}`,
    category: 'footprint_match',
    severity,
    title,
    description,
    affectedComponents: affected,
    suggestion,
    stage,
    ruleSource: 'jlc_rule',
    confidence: 1,
  };
}

/** JR-001: 封装是否在嘉立创常见封装库中 */
const JR001: Rule = {
  id: 'JR-001',
  category: 'jlc_compatibility',
  severity: 'info',
  title: '封装是否在嘉立创封装库中',
  description: '检查元器件封装是否属于嘉立创常见封装，非常见封装可能无法贴装',
  appliesTo: ['bom'],
  enabled: true,
  check(ctx: RuleContext): DesignReviewFinding[] {
    const nonStandard = ctx.bomItems.filter((item) => {
      if (!item.footprint) return false;
      const fp = item.footprint.toUpperCase();
      return !JLC_COMMON_FOOTPRINTS.some((prefix) => fp.includes(prefix.toUpperCase()));
    });

    if (nonStandard.length === 0) return [];

    return nonStandard.map((item) =>
      finding(
        'JR-001',
        'info',
        `${item.designator} 使用非常见封装 ${item.footprint}`,
        `元器件 ${item.designator}（${item.comment}）封装 ${item.footprint} 不在嘉立创常见封装列表中`,
        '请确认该封装在嘉立创封装库中可用，或考虑更换为标准封装',
        [item.designator],
      ),
    );
  },
};

/** JR-002: 器件是否有嘉立创料号 */
const JR002: Rule = {
  id: 'JR-002',
  category: 'jlc_compatibility',
  severity: 'warning',
  title: '器件缺少嘉立创料号',
  description: '无嘉立创料号的器件无法通过 JLCPCB SMT 服务贴装',
  appliesTo: ['bom'],
  enabled: true,
  check(ctx: RuleContext): DesignReviewFinding[] {
    const missing = ctx.bomItems.filter(
      (item) => !item.jlcPartNumber || item.jlcPartNumber.trim() === '',
    );

    if (missing.length === 0) return [];

    return [
      finding(
        'JR-002',
        'warning',
        `${missing.length} 个器件缺少嘉立创料号`,
        `以下器件未匹配到嘉立创料号：${missing.map((i) => i.designator).join(', ')}`,
        '请在嘉立创商城搜索兼容料号，或考虑替换为有料号的替代器件',
        missing.map((i) => i.designator),
      ),
    ];
  },
};

/** JR-003: 器件库存是否充足 */
const JR003: Rule = {
  id: 'JR-003',
  category: 'jlc_compatibility',
  severity: 'warning',
  title: '嘉立创库存不足',
  description: '库存低于 100 的器件可能影响批量生产',
  appliesTo: ['bom'],
  enabled: true,
  check(ctx: RuleContext): DesignReviewFinding[] {
    const lowStock = ctx.bomItems.filter(
      (item) =>
        item.jlcPartNumber &&
        item.jlcStock !== undefined &&
        item.jlcStock < 100,
    );

    if (lowStock.length === 0) return [];

    return lowStock.map((item) =>
      finding(
        'JR-003',
        'warning',
        `${item.designator} 嘉立创库存仅 ${item.jlcStock}`,
        `元器件 ${item.designator}（${item.jlcPartNumber}）当前库存 ${item.jlcStock}，低于 100 可能影响生产`,
        '建议确认库存或准备替代料号',
        [item.designator],
      ),
    );
  },
};

/** JR-004: 安全间距是否满足嘉立创工艺能力 */
const JR004: Rule = {
  id: 'JR-004',
  category: 'jlc_compatibility',
  severity: 'warning',
  title: '安全间距低于嘉立创工艺能力',
  description: '嘉立创 PCB 制造最小安全间距为 0.1mm（4mil）',
  appliesTo: ['pcb_layout'],
  enabled: true,
  check(ctx: RuleContext): DesignReviewFinding[] {
    if (!ctx.pcbLayoutPlan) return [];

    const clearanceConstraints = ctx.pcbLayoutPlan.constraints.filter(
      (c) => c.type === 'clearance',
    );

    const tooSmall = clearanceConstraints.filter((c) => {
      const match = c.description.match(/(\d+\.?\d*)\s*mm/);
      if (match) {
        return parseFloat(match[1]) < 0.1;
      }
      const milMatch = c.description.match(/(\d+\.?\d*)\s*mil/);
      if (milMatch) {
        return parseFloat(milMatch[1]) < 4;
      }
      return false;
    });

    if (tooSmall.length > 0) {
      return [
        finding(
          'JR-004',
          'warning',
          '安全间距低于嘉立创工艺极限',
          `检测到间距约束低于 0.1mm（4mil），超出嘉立创标准工艺能力`,
          '请将最小安全间距调整为 ≥ 0.1mm（4mil），或使用嘉立创高精度工艺',
          tooSmall.flatMap((c) => c.affectedComponents),
          'pcb_layout',
        ),
      ];
    }
    return [];
  },
};

/** JR-005: 最小线宽/线距是否满足嘉立创工艺 */
const JR005: Rule = {
  id: 'JR-005',
  category: 'jlc_compatibility',
  severity: 'warning',
  title: '线宽/线距低于嘉立创工艺能力',
  description: '嘉立创标准工艺最小线宽/线距为 0.127mm（5mil）',
  appliesTo: ['pcb_layout'],
  enabled: true,
  check(ctx: RuleContext): DesignReviewFinding[] {
    if (!ctx.pcbLayoutPlan) return [];

    const findings: DesignReviewFinding[] = [];

    for (const guideline of ctx.pcbLayoutPlan.routingGuidelines) {
      const mmMatch = guideline.guideline.match(/(\d+\.?\d*)\s*mm/);
      if (mmMatch && parseFloat(mmMatch[1]) < 0.127) {
        findings.push(
          finding(
            'JR-005',
            'warning',
            `走线 ${guideline.netName} 线宽/线距低于 0.127mm`,
            `走线规则 "${guideline.guideline}" 中指定的尺寸 ${mmMatch[1]}mm 低于嘉立创标准工艺 0.127mm`,
            '请调整至 ≥ 0.127mm（5mil），或使用嘉立创高精度工艺（最小 0.09mm/3.5mil）',
            [],
            'pcb_layout',
          ),
        );
      }

      const milMatch = guideline.guideline.match(/(\d+\.?\d*)\s*mil/);
      if (milMatch && parseFloat(milMatch[1]) < 5) {
        findings.push(
          finding(
            'JR-005',
            'warning',
            `走线 ${guideline.netName} 线宽/线距低于 5mil`,
            `走线规则 "${guideline.guideline}" 中指定的尺寸 ${milMatch[1]}mil 低于嘉立创标准工艺 5mil`,
            '请调整至 ≥ 5mil（0.127mm），或使用嘉立创高精度工艺（最小 3.5mil）',
            [],
            'pcb_layout',
          ),
        );
      }
    }
    return findings;
  },
};

export const jlcRules: Rule[] = [JR001, JR002, JR003, JR004, JR005];
