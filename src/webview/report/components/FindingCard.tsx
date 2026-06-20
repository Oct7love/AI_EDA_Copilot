/** 单条设计审查发现卡片 */
import React from 'react';
import type { DesignReviewFinding } from '../../../shared/types';

const SEVERITY_CONFIG = {
  critical: { label: '严重', cls: 'finding-critical' },
  warning:  { label: '警告', cls: 'finding-warning' },
  info:     { label: '提示', cls: 'finding-info' },
} as const;

const SOURCE_LABELS: Record<string, string> = {
  hard_rule: '硬性规则',
  warning_rule: '警告规则',
  jlc_rule: 'JLC 规则',
  ai_analysis: 'AI 审查',
};

interface FindingCardProps {
  finding: DesignReviewFinding;
}

export function FindingCard({ finding }: FindingCardProps): React.ReactElement {
  // 兜底：severity 来自 AI，可能漂移出枚举；缺省退回 info 样式，避免整页渲染抛错白屏
  const sevConf = SEVERITY_CONFIG[finding.severity] ?? { label: finding.severity, cls: 'finding-info' };

  return (
    <div className={`finding-card ${sevConf.cls}`}>
      <div className="finding-header">
        <span className={`finding-badge ${sevConf.cls}`}>{sevConf.label}</span>
        <span className="finding-title">{finding.title}</span>
        <span className="finding-source">{SOURCE_LABELS[finding.ruleSource] ?? finding.ruleSource}</span>
      </div>
      <p className="finding-desc">{finding.description}</p>
      {finding.affectedComponents.length > 0 && (
        <div className="finding-components">
          <span className="finding-label">受影响元件：</span>
          {finding.affectedComponents.map((c) => (
            <span key={c} className="finding-chip">{c}</span>
          ))}
        </div>
      )}
      <div className="finding-suggestion">
        <span className="finding-label">建议：</span>
        {finding.suggestion}
      </div>
      {finding.ruleSource === 'ai_analysis' && (
        <div className="finding-confidence">
          置信度：{Math.round(finding.confidence * 100)}%
        </div>
      )}
    </div>
  );
}
