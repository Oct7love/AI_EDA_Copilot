/** 设计审查板块，摘要统计 + 过滤器 + Finding 卡片列表 */
import React, { useState, useMemo } from 'react';
import type { FindingSeverity } from '../../../shared/types';
import { useReportStore } from '../store/reportStore';
import { FindingCard } from './FindingCard';
import { StaleIndicator } from './StaleIndicator';
import './DesignReviewSection.css';

type FilterKey = 'all' | FindingSeverity;

const FILTER_OPTIONS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'critical', label: '严重' },
  { key: 'warning', label: '警告' },
  { key: 'info', label: '提示' },
];

export function DesignReviewSection(): React.ReactElement {
  const result = useReportStore((s) => s.designReviewResult);
  const artifactStatus = useReportStore((s) => s.artifactStatus);
  const [filter, setFilter] = useState<FilterKey>('all');

  const filteredFindings = useMemo(() => {
    if (!result) return [];
    if (filter === 'all') return result.findings;
    return result.findings.filter((f) => f.severity === filter);
  }, [result, filter]);

  if (!result) {
    return (
      <div className="dr-empty">
        <p>暂无设计审查数据，请先运行完整分析。</p>
      </div>
    );
  }

  const { criticalCount, warningCount, infoCount } = result.summary;

  return (
    <div className="dr-root">
      <StaleIndicator stage="designReview" status={artifactStatus?.designReview ?? 'valid'} />
      {/* 摘要统计 */}
      <div className="dr-summary">
        <h3>设计审查结果</h3>
        <div className="dr-stats">
          <span className="dr-stat dr-stat-critical">{criticalCount} 严重</span>
          <span className="dr-stat dr-stat-warning">{warningCount} 警告</span>
          <span className="dr-stat dr-stat-info">{infoCount} 提示</span>
          <span className="dr-stat dr-stat-total">{result.findings.length} 项发现</span>
        </div>
        <div className="dr-time">审查时间：{new Date(result.reviewedAt).toLocaleString()}</div>
      </div>

      {/* 过滤器 */}
      <div className="dr-filters">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            className={`dr-filter-btn ${filter === opt.key ? 'dr-filter-active' : ''}`}
            onClick={() => setFilter(opt.key)}
          >
            {opt.label}
            {opt.key !== 'all' && (
              <span className="dr-filter-count">
                {opt.key === 'critical' ? criticalCount : opt.key === 'warning' ? warningCount : infoCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Finding 列表 */}
      <div className="dr-findings">
        {filteredFindings.length === 0 ? (
          <p className="dr-no-match">当前过滤条件下无匹配结果。</p>
        ) : (
          filteredFindings.map((f) => <FindingCard key={f.id} finding={f} />)
        )}
      </div>
    </div>
  );
}
