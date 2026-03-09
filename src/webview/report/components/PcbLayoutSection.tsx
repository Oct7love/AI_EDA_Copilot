/** PCB 布局板块，板参数 + 分区图 + 约束 + 走线指南 */
import React from 'react';
import { useReportStore } from '../store/reportStore';
import { PcbZoneMap } from './PcbZoneMap';
import './PcbLayoutSection.css';

/** PCB 布局规划板块 */
export function PcbLayoutSection(): React.ReactElement {
  const plan = useReportStore((s) => s.pcbLayoutPlan);

  if (!plan) {
    return (
      <div className="pcb-root">
        <div className="pcb-empty">暂无 PCB 布局数据，请先运行分析。</div>
      </div>
    );
  }

  const { boardSize, layerCount } = plan;

  return (
    <div className="pcb-root">
      {/* 板级参数 */}
      <div className="pcb-params">
        <div className="pcb-param-card">
          <div className="param-label">板尺寸</div>
          <div className="param-value">{boardSize.width} x {boardSize.height} mm</div>
          <div className="param-meta">
            <span className={`param-source param-source--${boardSize.source}`}>
              {boardSize.source === 'user_provided' ? '用户提供' : 'AI 推断'}
            </span>
            {boardSize.status === 'pending_confirmation' && (
              <span className="param-pending">待确认</span>
            )}
          </div>
        </div>
        <div className="pcb-param-card">
          <div className="param-label">层数</div>
          <div className="param-value">{layerCount.value} 层</div>
          <div className="param-meta">
            <span className={`param-source param-source--${layerCount.source}`}>
              {layerCount.source === 'user_provided' ? '用户提供' : 'AI 推断'}
            </span>
          </div>
          <div className="param-reasoning">{layerCount.reasoning}</div>
        </div>
      </div>

      {/* 分区图 */}
      <h3 className="pcb-subtitle">功能分区</h3>
      <PcbZoneMap
        zones={plan.zones}
        boardWidth={boardSize.width}
        boardHeight={boardSize.height}
      />

      {/* 分区详情 */}
      <div className="pcb-zone-details">
        {plan.zones.map((zone) => (
          <div key={zone.id} className="zone-detail-card">
            <strong>{zone.name}</strong>
            <span className="zone-position">{zone.relativePosition}</span>
            <p className="zone-purpose">{zone.purpose}</p>
          </div>
        ))}
      </div>

      {/* 布局约束 */}
      {plan.constraints.length > 0 && (
        <>
          <h3 className="pcb-subtitle">布局约束 ({plan.constraints.length})</h3>
          <div className="pcb-constraints">
            {plan.constraints.map((c, i) => (
              <div key={i} className={`constraint-card constraint-card--${c.type}`}>
                <div className="constraint-header">
                  <span className="constraint-type">{c.type}</span>
                  {c.reference && <span className="constraint-ref">{c.reference}</span>}
                </div>
                <p className="constraint-desc">{c.description}</p>
                {c.affectedComponents.length > 0 && (
                  <div className="constraint-components">
                    {c.affectedComponents.map((comp) => (
                      <span key={comp} className="constraint-comp">{comp}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* 走线指南 */}
      {plan.routingGuidelines.length > 0 && (
        <>
          <h3 className="pcb-subtitle">走线指南 ({plan.routingGuidelines.length})</h3>
          <div className="pcb-routing">
            {plan.routingGuidelines.map((rg, i) => (
              <div key={i} className="routing-card">
                <div className="routing-header">
                  <span className="routing-net">{rg.netName}</span>
                  <span className={`routing-category routing-category--${rg.category}`}>{rg.category}</span>
                  <span className={`routing-severity routing-severity--${rg.severity}`}>{rg.severity}</span>
                </div>
                <p className="routing-guideline">{rg.guideline}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 元件布局列表 */}
      {plan.placements.length > 0 && (
        <>
          <h3 className="pcb-subtitle">元件布局 ({plan.placements.length})</h3>
          <div className="pcb-placements-wrapper">
            <table className="pcb-placements-table">
              <thead>
                <tr>
                  <th>Designator</th>
                  <th>Zone</th>
                  <th>Priority</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {plan.placements.map((p) => (
                  <tr key={p.designator}>
                    <td className="placement-des">{p.designator}</td>
                    <td>{p.zone}</td>
                    <td>
                      <span className={`placement-priority placement-priority--${p.priority}`}>
                        {p.priority}
                      </span>
                    </td>
                    <td className="placement-notes">{p.placementNotes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
