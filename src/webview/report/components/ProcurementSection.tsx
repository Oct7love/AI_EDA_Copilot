/** 采购板块，兼容性概要 + 器件卡片 + 替代件 */
import React, { useState, useMemo } from 'react';
import { createMessage } from '../../../shared/types';
import vscodeApi from '../../shared/vscodeApi';
import { useReportStore } from '../store/reportStore';
import { StaleIndicator } from './StaleIndicator';
import './ProcurementSection.css';

/** 兼容性配色 */
const COMPAT_CONFIG = {
  compatible:    { label: '兼容',   cls: 'compat-ok' },
  partial:       { label: '部分',   cls: 'compat-partial' },
  incompatible:  { label: '不兼容', cls: 'compat-bad' },
  unknown:       { label: '未知',   cls: 'compat-unknown' },
} as const;

/** 查询/库存状态标签（仅对需要提示的状态展示；in_stock 不额外加徽章） */
const QUERY_STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  not_found:     { label: '未找到料号', cls: 'qs-warn' },
  out_of_stock:  { label: '缺货',       cls: 'qs-warn' },
  network_error: { label: '网络失败',   cls: 'qs-error' },
  api_error:     { label: '接口异常',   cls: 'qs-error' },
  parse_error:   { label: '数据异常',   cls: 'qs-error' },
  timeout:       { label: '查询超时',   cls: 'qs-error' },
  unknown:       { label: '未知',       cls: 'qs-warn' },
};

export function ProcurementSection(): React.ReactElement {
  const items = useReportStore((s) => s.procurementItems);
  const artifactStatus = useReportStore((s) => s.artifactStatus);
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
      <StaleIndicator stage="procurement" status={artifactStatus?.procurement ?? 'valid'} />
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
                {(() => {
                  const compat = COMPAT_CONFIG[item.jlcCompatibility] ?? COMPAT_CONFIG.unknown;
                  return (
                    <span className={`proc-compat-badge ${compat.cls}`}>{compat.label}</span>
                  );
                })()}
                <span className="proc-match-type">{item.matchType}</span>
                {QUERY_STATUS_LABELS[item.queryStatus] && (
                  <span className={`proc-query-status ${QUERY_STATUS_LABELS[item.queryStatus].cls}`}>
                    {QUERY_STATUS_LABELS[item.queryStatus].label}
                  </span>
                )}
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
                          onClick={() => alt.jlcProductUrl && handleLinkClick(alt.jlcProductUrl)}
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
