/** PCB 分区可视化子组件，CSS Grid 3×3 色彩分区 */
import React from 'react';
import type { LayoutZone } from '../../../shared/types';

interface PcbZoneMapProps {
  zones: LayoutZone[];
  boardWidth: number;
  boardHeight: number;
}

/** 位置映射：将 relativePosition 文字转为 CSS Grid 区域 */
const POSITION_MAP: Record<string, { row: number; col: number }> = {
  'top-left':     { row: 1, col: 1 },
  'top':          { row: 1, col: 2 },
  'top-center':   { row: 1, col: 2 },
  'top-right':    { row: 1, col: 3 },
  'left':         { row: 2, col: 1 },
  'center-left':  { row: 2, col: 1 },
  'center':       { row: 2, col: 2 },
  'right':        { row: 2, col: 3 },
  'center-right': { row: 2, col: 3 },
  'bottom-left':  { row: 3, col: 1 },
  'bottom':       { row: 3, col: 2 },
  'bottom-center':{ row: 3, col: 2 },
  'bottom-right': { row: 3, col: 3 },
};

const DEFAULT_COLORS = [
  'var(--eda-cat-power, #e74c3c)',
  'var(--eda-cat-signal, #3498db)',
  'var(--eda-cat-control, #2ecc71)',
  'var(--eda-cat-analog, #f39c12)',
  'var(--eda-cat-differential, #9b59b6)',
  'var(--eda-cat-misc-1, #1abc9c)',
  'var(--eda-cat-misc-2, #e67e22)',
  'var(--eda-cat-misc-3, #34495e)',
];

/** PCB 分区可视化 — CSS Grid 布局 */
export function PcbZoneMap({ zones, boardWidth, boardHeight }: PcbZoneMapProps): React.ReactElement {
  // 按 position 分配到 3x3 Grid
  const gridCells = zones.map((zone, i) => {
    const pos = POSITION_MAP[zone.relativePosition] ?? { row: 2, col: 2 };
    const color = zone.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length];
    return { zone, pos, color };
  });

  return (
    <div className="pcb-zone-map">
      <div className="pcb-board-label">
        {boardWidth}mm x {boardHeight}mm
      </div>
      <div className="pcb-grid">
        {gridCells.map(({ zone, pos, color }) => (
          <div
            key={zone.id}
            className="pcb-zone-cell"
            style={{
              gridRow: pos.row,
              gridColumn: pos.col,
              borderColor: color,
              backgroundColor: `${color}15`,
            }}
          >
            <div className="zone-name" style={{ color }}>{zone.name}</div>
            <div className="zone-components">
              {zone.components.slice(0, 5).map((c) => (
                <span key={c} className="zone-comp-tag">{c}</span>
              ))}
              {zone.components.length > 5 && (
                <span className="zone-comp-more">+{zone.components.length - 5}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
