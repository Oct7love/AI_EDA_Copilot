import React, { useState } from 'react';
import type { BOMItem } from '../../../shared/types';
import { createMessage } from '../../../shared/types';
import vscodeApi from '../../shared/vscodeApi';
import { useReportStore } from '../store/reportStore';
import { BomRowDetail } from './BomRowDetail';
import './BomSection.css';

export function BomSection(): React.ReactElement {
  const bomItems = useReportStore((s) => s.bomItems);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  if (bomItems.length === 0) {
    return (
      <div className="bom-root">
        <div className="bom-empty">暂无 BOM 数据，请先运行分析。</div>
      </div>
    );
  }

  const handleExportCsv = () => {
    vscodeApi.postMessage(createMessage('bom_export', 'report', undefined as never));
  };

  const toggleRow = (designator: string) => {
    setExpandedRow((prev) => (prev === designator ? null : designator));
  };

  // 统计
  const totalParts = bomItems.length;
  const matchedParts = bomItems.filter((b) => b.jlcPartNumber).length;

  return (
    <div className="bom-root">
      {/* 摘要 + 导出 */}
      <div className="bom-header">
        <div className="bom-stats">
          <span className="bom-stat">{totalParts} 项器件</span>
          <span className="bom-stat">{matchedParts} 已匹配料号</span>
        </div>
        <button className="bom-export-btn" onClick={handleExportCsv}>
          导出 CSV
        </button>
      </div>

      {/* 表格 */}
      <div className="bom-table-wrapper">
        <table className="bom-table">
          <thead>
            <tr>
              <th>Designator</th>
              <th>Comment</th>
              <th>Footprint</th>
              <th>Qty</th>
              <th>LCSC Part #</th>
            </tr>
          </thead>
          <tbody>
            {bomItems.map((item) => (
              <React.Fragment key={item.designator}>
                <tr
                  className={`bom-row ${expandedRow === item.designator ? 'bom-row--expanded' : ''}`}
                  onClick={() => toggleRow(item.designator)}
                >
                  <td className="bom-cell-designator">{item.designator}</td>
                  <td className="bom-cell-comment">{item.comment}</td>
                  <td className="bom-cell-footprint">{item.footprint}</td>
                  <td className="bom-cell-qty">{item.quantity}</td>
                  <td className="bom-cell-lcsc">
                    {item.jlcPartNumber ? (
                      <span className="bom-lcsc-matched">{item.jlcPartNumber}</span>
                    ) : (
                      <span className="bom-lcsc-none">—</span>
                    )}
                  </td>
                </tr>
                {expandedRow === item.designator && (
                  <tr className="bom-detail-row-wrapper">
                    <td colSpan={5}>
                      <BomRowDetail item={item} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
