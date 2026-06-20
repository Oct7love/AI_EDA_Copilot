/**
 * 警告规则 WR-001 ~ WR-006
 * severity: warning — 不满足时设计可能存在隐患
 */
import type { Rule, RuleContext, DesignReviewFinding } from '@shared/types';

// 单调递增序号，保证同一毫秒内多条 finding 的 id 唯一（修复 Date.now() 碰撞）
let seq = 0;

function finding(
  ruleId: string,
  title: string,
  description: string,
  suggestion: string,
  affected: string[],
  stage: DesignReviewFinding['stage'] = 'pcb_layout',
): DesignReviewFinding {
  return {
    id: `${ruleId}-${Date.now()}-${seq++}`,
    category: 'layout',
    severity: 'warning',
    title,
    description,
    affectedComponents: affected,
    suggestion,
    stage,
    ruleSource: 'warning_rule',
    confidence: 1,
  };
}

/** WR-001: 去耦电容应就近放置于电源引脚 */
const WR001: Rule = {
  id: 'WR-001',
  category: 'warning',
  severity: 'warning',
  title: '去耦电容应就近放置于电源引脚',
  description: '去耦电容需要尽可能靠近 IC 电源引脚放置以降低寄生电感',
  appliesTo: ['pcb_layout'],
  enabled: true,
  check(ctx: RuleContext): DesignReviewFinding[] {
    if (!ctx.pcbLayoutPlan) return [];

    const icPlacements = ctx.pcbLayoutPlan.placements.filter((p) =>
      p.designator.startsWith('U') || p.designator.startsWith('IC'),
    );
    const capPlacements = ctx.pcbLayoutPlan.placements.filter((p) =>
      p.designator.startsWith('C'),
    );

    const findings: DesignReviewFinding[] = [];
    for (const ic of icPlacements) {
      const nearbyDecap = capPlacements.some((cap) => cap.zone === ic.zone);
      if (!nearbyDecap) {
        findings.push(
          finding(
            'WR-001',
            `${ic.designator} 附近未发现去耦电容`,
            `IC ${ic.designator} 所在分区（${ic.zone}）中未发现电容，去耦电容应就近放置`,
            `请将 ${ic.designator} 的去耦电容放置在同一分区内，尽量靠近电源引脚`,
            [ic.designator],
          ),
        );
      }
    }
    return findings;
  },
};

/** WR-002: 高速信号走线建议等长匹配 */
const WR002: Rule = {
  id: 'WR-002',
  category: 'warning',
  severity: 'warning',
  title: '高速信号走线建议等长匹配',
  description: '高速信号（如 SPI、USB、DDR）走线应考虑等长匹配以保证信号完整性',
  appliesTo: ['pcb_layout'],
  enabled: true,
  check(ctx: RuleContext): DesignReviewFinding[] {
    if (!ctx.pcbLayoutPlan) return [];

    const signalGuidelines = ctx.pcbLayoutPlan.routingGuidelines.filter(
      (g) => g.category === 'signal' || g.category === 'differential',
    );

    const hasLengthMatching = signalGuidelines.some(
      (g) =>
        g.guideline.toLowerCase().includes('length match') ||
        g.guideline.includes('等长') ||
        g.guideline.toLowerCase().includes('matched'),
    );

    if (signalGuidelines.length > 0 && !hasLengthMatching) {
      return [
        finding(
          'WR-002',
          '高速信号走线缺少等长匹配建议',
          `检测到 ${signalGuidelines.length} 条高速信号走线规则，但均未提及等长匹配`,
          '建议高速信号（SPI CLK/DATA、USB D+/D-、DDR 数据组）添加等长匹配约束',
          [],
        ),
      ];
    }
    return [];
  },
};

/** WR-003: 天线区域应保持净空 */
const WR003: Rule = {
  id: 'WR-003',
  category: 'warning',
  severity: 'warning',
  title: '天线区域应保持净空',
  description: '含 RF/天线的设计需要在天线区域保持净空（keep-out），避免信号干扰',
  appliesTo: ['pcb_layout'],
  enabled: true,
  check(ctx: RuleContext): DesignReviewFinding[] {
    if (!ctx.pcbLayoutPlan) return [];

    const hasAntenna = ctx.bomItems.some(
      (item) =>
        item.comment.toLowerCase().includes('antenna') ||
        item.comment.includes('天线') ||
        item.category?.toLowerCase().includes('antenna') ||
        item.category?.toLowerCase().includes('rf'),
    );

    if (!hasAntenna) return [];

    const hasKeepOut = ctx.pcbLayoutPlan.constraints.some(
      (c) =>
        c.type === 'keep_out' &&
        (c.description.toLowerCase().includes('antenna') ||
          c.description.includes('天线') ||
          c.description.toLowerCase().includes('rf')),
    );

    if (!hasKeepOut) {
      return [
        finding(
          'WR-003',
          '天线区域缺少净空约束',
          '检测到天线/RF 器件但 PCB 布局中未定义天线区域的 keep-out 约束',
          '请在天线区域添加 keep-out 约束，避免走线和覆铜影响天线性能',
          [],
        ),
      ];
    }
    return [];
  },
};

/** WR-004: 大功率器件建议增加散热过孔 */
const WR004: Rule = {
  id: 'WR-004',
  category: 'warning',
  severity: 'warning',
  title: '大功率器件建议增加散热过孔',
  description: '电源转换器、功率 MOS 等大功率器件应有散热设计',
  appliesTo: ['pcb_layout'],
  enabled: true,
  check(ctx: RuleContext): DesignReviewFinding[] {
    if (!ctx.pcbLayoutPlan) return [];

    const powerDevices = ctx.bomItems.filter(
      (item) =>
        item.category?.toLowerCase().includes('power') ||
        item.category?.toLowerCase().includes('regulator') ||
        item.comment.toLowerCase().includes('ldo') ||
        item.comment.toLowerCase().includes('dc-dc') ||
        item.comment.toLowerCase().includes('buck') ||
        item.comment.toLowerCase().includes('boost'),
    );

    if (powerDevices.length === 0) return [];

    const hasThermalConstraint = ctx.pcbLayoutPlan.constraints.some(
      (c) => c.type === 'thermal',
    );

    if (!hasThermalConstraint) {
      return [
        finding(
          'WR-004',
          '大功率器件缺少散热设计',
          `检测到 ${powerDevices.length} 个电源/功率器件，但 PCB 布局中未定义散热约束`,
          '建议为大功率器件添加散热过孔（thermal via）和散热铜皮',
          powerDevices.map((d) => d.designator),
        ),
      ];
    }
    return [];
  },
};

/** WR-005: 差分对建议保持间距一致 */
const WR005: Rule = {
  id: 'WR-005',
  category: 'warning',
  severity: 'warning',
  title: '差分对建议保持间距一致',
  description: '差分对走线应保持固定间距以维持阻抗匹配',
  appliesTo: ['pcb_layout'],
  enabled: true,
  check(ctx: RuleContext): DesignReviewFinding[] {
    if (!ctx.pcbLayoutPlan) return [];

    const diffGuidelines = ctx.pcbLayoutPlan.routingGuidelines.filter(
      (g) => g.category === 'differential',
    );

    if (diffGuidelines.length === 0) return [];

    const hasSpacingRule = diffGuidelines.some(
      (g) =>
        g.guideline.toLowerCase().includes('spacing') ||
        g.guideline.includes('间距') ||
        g.guideline.toLowerCase().includes('gap'),
    );

    if (!hasSpacingRule) {
      return [
        finding(
          'WR-005',
          '差分对走线缺少间距约束',
          `检测到 ${diffGuidelines.length} 条差分走线规则，但未包含间距一致性要求`,
          '建议差分对走线保持固定间距（通常根据阻抗计算器确定）',
          [],
        ),
      ];
    }
    return [];
  },
};

/** WR-006: 板边不建议放置精密模拟器件 */
const WR006: Rule = {
  id: 'WR-006',
  category: 'warning',
  severity: 'warning',
  title: '板边不建议放置精密模拟器件',
  description: '精密模拟器件（ADC、运放、传感器）应远离板边以减少应力和噪声',
  appliesTo: ['pcb_layout'],
  enabled: true,
  check(ctx: RuleContext): DesignReviewFinding[] {
    if (!ctx.pcbLayoutPlan) return [];

    const analogDevices = ctx.bomItems.filter(
      (item) =>
        item.category?.toLowerCase().includes('analog') ||
        item.category?.toLowerCase().includes('adc') ||
        item.category?.toLowerCase().includes('sensor') ||
        item.comment.toLowerCase().includes('op-amp') ||
        item.comment.toLowerCase().includes('opamp') ||
        item.comment.toLowerCase().includes('adc'),
    );

    if (analogDevices.length === 0) return [];

    const edgeZoneNames = ['edge', '边缘', 'connector', '接口'];
    const edgePlacements = ctx.pcbLayoutPlan.placements.filter((p) => {
      const isAnalog = analogDevices.some((d) => d.designator === p.designator);
      const inEdgeZone = edgeZoneNames.some((name) =>
        p.zone.toLowerCase().includes(name),
      );
      return isAnalog && inEdgeZone;
    });

    if (edgePlacements.length > 0) {
      return [
        finding(
          'WR-006',
          '精密模拟器件位于板边区域',
          `${edgePlacements.map((p) => p.designator).join(', ')} 被放置在板边区域，可能受到机械应力和噪声影响`,
          '建议将精密模拟器件移至板中心区域，远离板边和连接器',
          edgePlacements.map((p) => p.designator),
        ),
      ];
    }
    return [];
  },
};

export const warningRules: Rule[] = [WR001, WR002, WR003, WR004, WR005, WR006];
