import React, { useState, useMemo } from 'react';
import type { ProcurementItem } from '../../../shared/types';
import { createMessage } from '../../../shared/types';
import vscodeApi from '../../shared/vscodeApi';
import { useReportStore } from '../store/reportStore';
import './ProcurementSection.css';

/** 兼容性配色 */
const COMPAT_CONFIG = {
  compatible:    { label: '兼容',   cls: 'compat-ok' },
  partial:       { label: '部分',   cls: 'compat-partial' },
  incompatible:  { label: '不兼容', cls: 'compat-bad' },
  unknown:       { label: '未知',   cls: 'compat-unknown' },
} as const;

export function ProcurementSection(): React.ReactElement {
  const items = useReportStore((s) => s.procurementItems);
  const [expandedAlt, setExpandedAlt] = useState<string | null>(null);

  // 统计
  const stats = useMemo(() => {
    const result = { compatible: 0, partial: 0, incompatible: 0, unknown: 0 };
    for (const item of items) result[item.jlcCompatibility]++;
    return result;
  }, [items]);

  if (items.length === 0) {
    return (
      <div className="proc-root">
        <div className="proc-empty">暂无采购数据，请先运行分析。</div>
      </div>
    );
  }

  const handleLinkClick = (url: string) => {
    vscodeApi.postMessage(createMessage('open_external_link', 'report', { url }));
  };

  return (
    <div className="proc-root">
      {/* 兼容性概要 */}
      <div className="proc-summary">
        <h3 className="proc-summary-title">JLCPCB 兼容性</h3>
        <div className="proc-summary-grid">
          {(Object.keys(COMPAT_CONFIG) as (keyof typeof COMPAT_CONFIG)[]).map((key) => (
            <div key={key} className={`proc-summary-item proc-summary-item--${COMPAT_CONFIG[key].cls}`}>
              <span className="proc-summary-count">{stats[key]}</span>
              <span className="proc-summary-label">{COMPAT_CONFIG[key].label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 器件列表 */}
      <div className="proc-list">
        {items.map((item) => (
          <div key={item.designator} className="proc-item">
            <div className="proc-item-header">
              <div className="proc-item-info">
                <span className="proc-designator">{item.designator}</span>
                <span className="proc-comment">{item.comment}</span>
                <span className="proc-footprint">{item.footprint}</span>
              </div>
              <div className="proc-item-badges">
                <span className={`proc-compat-badge ${COMPAT_CONFIG[item.jlcCompatibility].cls}`}>
                  {COMPAT_CONFIG[item.jlcCompatibility].label}
                </span>
                <span className="proc-match-type">{item.matchType}</span>
              </div>
            </div>

            {/* JLC 信息 */}
            {item.jlcPartNumber && (
              <div className="proc-item-jlc">
                <span
                  className="proc-link"
                  onClick={() => item.jlcProductUrl && handleLinkClick(item.jlcProductUrl)}
                >
                  {item.jlcPartNumber}
                </span>
                {item.jlcStock !== undefined && (
                  <span className="proc-stock">库存: {item.jlcStock}</span>
                )}
                {item.jlcPrice !== undefined && (
                  <span className="proc-price">¥{item.jlcPrice}</span>
                )}
                <span className={`proc-smt-badge proc-smt-badge--${item.smtReadiness}`}>
                  {item.smtReadiness === 'ready' ? 'SMT Ready' : item.smtReadiness}
                </span>
              </div>
            )}

            {/* 推荐 */}
            <div className="proc-recommendation">{item.recommendation}</div>

            {/* SMT 问题 */}
            {item.smtIssues.length > 0 && (
              <div className="proc-issues">
                {item.smtIssues.map((issue, i) => (
                  <span key={i} className="proc-issue-tag">{issue}</span>
                ))}
              </div>
            )}

            {/* 替代件 */}
            {item.alternatives.length > 0 && (
              <div className="proc-alternatives">
                <button
                  className="proc-alt-toggle"
                  onClick={() => setExpandedAlt(expandedAlt === item.designator ? null : item.designator)}
                >
                  {expandedAlt === item.designator ? '收起' : `${item.alternatives.length} 个替代件`}
                </button>
                {expandedAlt === item.designator && (
                  <div className="proc-alt-list">
                    {item.alternatives.map((alt) => (
                      <div key={alt.jlcPartNumber} className="proc-alt-item">
                        <span className="proc-alt-rank">#{alt.rank}</span>
                        <span
                          className="proc-link"
                          onClick={() => handleLinkClick(alt.jlcProductUrl)}
                        >
                          {alt.jlcPartNumber}
                        </span>
                        <span className="proc-alt-comment">{alt.comment}</span>
                        <span className="proc-alt-reason">{alt.reason}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
