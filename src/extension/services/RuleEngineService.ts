/**
 * 规则引擎服务 — 遍历所有已启用规则，收集设计审查发现
 *
 * 纯逻辑层，不依赖 VS Code API，便于单元测试
 */
import type { RuleContext, DesignReviewFinding, DesignReviewResult } from '@shared/types';
import { getEnabledRules } from '../rules/ruleRegistry';

/** 执行所有已启用规则，返回汇总结果 */
export function runAllRules(ctx: RuleContext): DesignReviewResult {
  const findings: DesignReviewFinding[] = [];

  for (const rule of getEnabledRules()) {
    try {
      const results = rule.check(ctx);
      findings.push(...results);
    } catch {
      // 单条规则执行失败不影响其他规则
      findings.push({
        id: `${rule.id}-error-${Date.now()}`,
        category: 'general',
        severity: 'info',
        title: `规则 ${rule.id} 执行异常`,
        description: `规则 ${rule.title} 执行时发生错误，已跳过`,
        affectedComponents: [],
        suggestion: '请检查输入数据完整性',
        stage: 'cross_stage',
        ruleSource: rule.category === 'hard' ? 'hard_rule' : rule.category === 'jlc_compatibility' ? 'jlc_rule' : 'warning_rule',
        confidence: 1,
      });
    }
  }

  const summary = {
    criticalCount: findings.filter((f) => f.severity === 'critical').length,
    warningCount: findings.filter((f) => f.severity === 'warning').length,
    infoCount: findings.filter((f) => f.severity === 'info').length,
  };

  return {
    findings,
    summary,
    reviewedAt: new Date().toISOString(),
  };
}
