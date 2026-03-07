import React from 'react';
import type { BOMItem } from '../../../shared/types';
import { createMessage } from '../../../shared/types';
import vscodeApi from '../../shared/vscodeApi';

interface Props {
  item: BOMItem;
}

export function BomRowDetail({ item }: Props): React.ReactElement {
  const handleLinkClick = (url: string) => {
    vscodeApi.postMessage(createMessage('open_external_link', 'report', { url }));
  };

  return (
    <div className="bom-detail">
      {/* 描述 + 分类 */}
      <div className="bom-detail-row">
        <span className="bom-detail-label">描述</span>
        <span className="bom-detail-value">{item.description ?? '—'}</span>
      </div>
      <div className="bom-detail-row">
        <span className="bom-detail-label">分类 / 子系统</span>
        <span className="bom-detail-value">{item.category} / {item.subsystem}</span>
      </div>

      {/* 制造商 */}
      {(item.manufacturer || item.mpn) && (
        <div className="bom-detail-row">
          <span className="bom-detail-label">制造商 / MPN</span>
          <span className="bom-detail-value">{item.manufacturer ?? '—'} / {item.mpn ?? '—'}</span>
        </div>
      )}

      {/* AI 标注 */}
      <div className="bom-detail-row">
        <span className="bom-detail-label">AI 标注</span>
        <span className="bom-detail-value">
          <span className={`bom-source-badge bom-source-badge--${item.source === 'user_provided' ? 'user' : 'ai'}`}>
            {item.source === 'user_provided' ? 'USER' : 'AI'}
          </span>
          <span className="bom-confidence">{Math.round(item.confidence * 100)}%</span>
        </span>
      </div>
      {item.reasoning && (
        <div className="bom-detail-row">
          <span className="bom-detail-label">推理</span>
          <span className="bom-detail-value bom-detail-reasoning">{item.reasoning}</span>
        </div>
      )}

      {/* JLC 信息 */}
      {item.jlcPartNumber && (
        <div className="bom-detail-row">
          <span className="bom-detail-label">LCSC</span>
          <span className="bom-detail-value">
            <span
              className="bom-link"
              onClick={() => item.jlcProductUrl && handleLinkClick(item.jlcProductUrl)}
            >
              {item.jlcPartNumber}
            </span>
            {item.jlcStock !== undefined && (
              <span className="bom-stock">库存: {item.jlcStock}</span>
            )}
            {item.jlcPrice !== undefined && (
              <span className="bom-price">¥{item.jlcPrice}</span>
            )}
          </span>
        </div>
      )}

      {/* 替代件 */}
      {item.alternatives.length > 0 && (
        <div className="bom-detail-alternatives">
          <span className="bom-detail-label">替代件</span>
          <div className="bom-alt-list">
            {item.alternatives.map((alt, i) => (
              <div key={i} className="bom-alt-item">
                <span className="bom-alt-rank">#{alt.rank}</span>
                <span className="bom-alt-comment">{alt.comment}</span>
                <span className="bom-alt-footprint">{alt.footprint}</span>
                {alt.jlcPartNumber && (
                  <span
                    className="bom-link"
                    onClick={() => alt.jlcProductUrl && handleLinkClick(alt.jlcProductUrl)}
                  >
                    {alt.jlcPartNumber}
                  </span>
                )}
                <span className="bom-alt-reason">{alt.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
