/**
 * 硬性规则 HR-001 ~ HR-006
 * severity: critical — 不满足时设计存在严重缺陷
 */
import type { Rule, RuleContext, DesignReviewFinding } from '@shared/types';

function finding(
  ruleId: string,
  title: string,
  description: string,
  suggestion: string,
  affected: string[],
  stage: DesignReviewFinding['stage'] = 'bom',
): DesignReviewFinding {
  return {
    id: `${ruleId}-${Date.now()}`,
    category: 'general',
    severity: 'critical',
    title,
    description,
    affectedComponents: affected,
    suggestion,
    stage,
    ruleSource: 'hard_rule',
    confidence: 1,
  };
}

/** HR-001: 封装字段不可为空 */
const HR001: Rule = {
  id: 'HR-001',
  category: 'hard',
  severity: 'critical',
  title: '封装字段不可为空',
  description: 'BOM 中每个元器件必须指定封装，否则无法进行 PCB 设计和制造',
  appliesTo: ['bom'],
  enabled: true,
  check(ctx: RuleContext): DesignReviewFinding[] {
    return ctx.bomItems
      .filter((item) => !item.footprint || item.footprint.trim() === '')
      .map((item) =>
        finding(
          'HR-001',
          `${item.designator} 缺少封装`,
          `元器件 ${item.designator}（${item.comment}）未指定封装，将无法进行 PCB 布局`,
          '请为该元器件指定合适的封装，如 0402、0603、LQFP-48 等',
          [item.designator],
        ),
      );
  },
};

/** HR-002: 位号不可重复 */
const HR002: Rule = {
  id: 'HR-002',
  category: 'hard',
  severity: 'critical',
  title: '位号不可重复',
  description: 'BOM 中位号（Designator）必须唯一，重复会导致装配和追溯混乱',
  appliesTo: ['bom'],
  enabled: true,
  check(ctx: RuleContext): DesignReviewFinding[] {
    const seen = new Map<string, number>();
    for (const item of ctx.bomItems) {
      seen.set(item.designator, (seen.get(item.designator) ?? 0) + 1);
    }
    const findings: DesignReviewFinding[] = [];
    for (const [designator, count] of seen) {
      if (count > 1) {
        findings.push(
          finding(
            'HR-002',
            `位号 ${designator} 重复出现 ${count} 次`,
            `位号 ${designator} 在 BOM 中出现了 ${count} 次，必须保持唯一`,
            '请检查 BOM 中的位号分配，确保每个位号唯一',
            [designator],
          ),
        );
      }
    }
    return findings;
  },
};

/** HR-003: 电源引脚必须有去耦电容 */
const HR003: Rule = {
  id: 'HR-003',
  category: 'hard',
  severity: 'critical',
  title: '电源引脚必须有去耦电容',
  description: 'IC 电源引脚附近必须配置去耦电容以抑制电源噪声',
  appliesTo: ['bom', 'schematic'],
  enabled: true,
  check(ctx: RuleContext): DesignReviewFinding[] {
    const icPrefixes = ['U', 'IC'];
    const icCount = ctx.bomItems.filter((item) =>
      icPrefixes.some((p) => item.designator.startsWith(p)),
    ).length;
    if (icCount === 0) return [];

    const capCount = ctx.bomItems.filter(
      (item) =>
        item.designator.startsWith('C') &&
        (item.comment.includes('100nF') ||
          item.comment.includes('0.1uF') ||
          item.comment.includes('100n') ||
          item.comment.includes('0.1u') ||
          item.comment.toLowerCase().includes('decoupling') ||
          item.comment.toLowerCase().includes('bypass')),
    ).length;

    if (capCount < icCount) {
      const ics = ctx.bomItems
        .filter((item) => icPrefixes.some((p) => item.designator.startsWith(p)))
        .map((item) => item.designator);
      return [
        finding(
          'HR-003',
          `去耦电容不足（${capCount} 个 / ${icCount} 个 IC）`,
          `检测到 ${icCount} 个 IC 但仅有 ${capCount} 个典型去耦电容（100nF/0.1uF），可能存在电源去耦不足`,
          '建议为每个 IC 电源引脚至少配置一个 100nF 去耦电容',
          ics,
          'cross_stage',
        ),
      ];
    }
    return [];
  },
};

/** HR-004: MCU 复位引脚必须有正确的复位电路 */
const HR004: Rule = {
  id: 'HR-004',
  category: 'hard',
  severity: 'critical',
  title: 'MCU 复位引脚需要复位电路',
  description: 'MCU 的复位引脚必须有上/下拉电阻和滤波电容组成的复位电路',
  appliesTo: ['schematic'],
  enabled: true,
  check(ctx: RuleContext): DesignReviewFinding[] {
    if (!ctx.schematicIntent) return [];

    const hasResetConnection = ctx.schematicIntent.connections.some(
      (conn) =>
        conn.from.pin.toLowerCase().includes('rst') ||
        conn.from.pin.toLowerCase().includes('reset') ||
        conn.from.pin.toLowerCase().includes('nrst') ||
        conn.to.pin.toLowerCase().includes('rst') ||
        conn.to.pin.toLowerCase().includes('reset') ||
        conn.to.pin.toLowerCase().includes('nrst'),
    );

    const hasMcu = ctx.bomItems.some(
      (item) =>
        item.category?.toLowerCase().includes('mcu') ||
        item.category?.toLowerCase().includes('microcontroller') ||
        item.comment.toLowerCase().includes('stm32') ||
        item.comment.toLowerCase().includes('esp32') ||
        item.comment.toLowerCase().includes('atmega'),
    );

    if (hasMcu && !hasResetConnection) {
      const mcuDesignators = ctx.bomItems
        .filter(
          (item) =>
            item.category?.toLowerCase().includes('mcu') ||
            item.category?.toLowerCase().includes('microcontroller') ||
            item.comment.toLowerCase().includes('stm32') ||
            item.comment.toLowerCase().includes('esp32') ||
            item.comment.toLowerCase().includes('atmega'),
        )
        .map((item) => item.designator);
      return [
        finding(
          'HR-004',
          'MCU 缺少复位电路',
          '未检测到 MCU 复位引脚（RST/RESET/NRST）的连接，缺少复位电路可能导致 MCU 启动异常',
          '请为 MCU 复位引脚添加上拉电阻（10KΩ）+ 滤波电容（100nF）的复位电路',
          mcuDesignators,
          'schematic',
        ),
      ];
    }
    return [];
  },
};

/** HR-005: 晶振负载电容必须匹配 */
const HR005: Rule = {
  id: 'HR-005',
  category: 'hard',
  severity: 'critical',
  title: '晶振需要配对负载电容',
  description: '晶振（Crystal）需要两个匹配的负载电容才能正常起振',
  appliesTo: ['bom'],
  enabled: true,
  check(ctx: RuleContext): DesignReviewFinding[] {
    const crystals = ctx.bomItems.filter(
      (item) =>
        item.designator.startsWith('Y') ||
        item.category?.toLowerCase().includes('crystal') ||
        item.comment.toLowerCase().includes('crystal') ||
        item.comment.toLowerCase().includes('晶振'),
    );

    if (crystals.length === 0) return [];

    const loadCaps = ctx.bomItems.filter(
      (item) =>
        item.designator.startsWith('C') &&
        (item.comment.includes('pF') ||
          item.comment.includes('12p') ||
          item.comment.includes('15p') ||
          item.comment.includes('18p') ||
          item.comment.includes('20p') ||
          item.comment.includes('22p')),
    );

    if (loadCaps.length < crystals.length * 2) {
      return [
        finding(
          'HR-005',
          `晶振负载电容不足（${loadCaps.length} 个 / 需 ${crystals.length * 2} 个）`,
          `检测到 ${crystals.length} 个晶振但仅有 ${loadCaps.length} 个 pF 级电容，晶振通常需要两个匹配负载电容`,
          '请为每个晶振配置两个匹配的负载电容（典型值 12pF~22pF，需参考晶振数据手册）',
          crystals.map((c) => c.designator),
        ),
      ];
    }
    return [];
  },
};

/** HR-006: 电源走线宽度不低于安全阈值 */
const HR006: Rule = {
  id: 'HR-006',
  category: 'hard',
  severity: 'critical',
  title: '电源走线宽度不低于安全阈值',
  description: 'PCB 电源走线宽度应满足载流需求，过窄可能导致发热或烧毁',
  appliesTo: ['pcb_layout'],
  enabled: true,
  check(ctx: RuleContext): DesignReviewFinding[] {
    if (!ctx.pcbLayoutPlan) return [];

    const powerGuidelines = ctx.pcbLayoutPlan.routingGuidelines.filter(
      (g) => g.category === 'power',
    );

    const hasPowerWidthRule = powerGuidelines.some(
      (g) =>
        g.guideline.toLowerCase().includes('width') ||
        g.guideline.includes('线宽') ||
        g.guideline.toLowerCase().includes('mil') ||
        g.guideline.toLowerCase().includes('mm'),
    );

    if (powerGuidelines.length > 0 && !hasPowerWidthRule) {
      return [
        finding(
          'HR-006',
          '电源走线缺少线宽约束',
          '检测到电源走线规则但未包含明确的线宽要求，可能导致电源走线过窄',
          '建议电源走线宽度 ≥ 0.5mm（20mil），大电流路径 ≥ 1mm（40mil）',
          [],
          'pcb_layout',
        ),
      ];
    }
    return [];
  },
};

export const hardRules: Rule[] = [HR001, HR002, HR003, HR004, HR005, HR006];
