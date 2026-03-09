/** 引脚连接表子组件，方向过滤器 + 色彩徽章 */
import React, { useState } from 'react';
import type { PinConnection } from '../../../shared/types';

interface PinConnectionTableProps {
  pinTable: PinConnection[];
}

type DirectionFilter = 'all' | 'input' | 'output' | 'bidirectional' | 'power';

/** 引脚连接表组件 */
export function PinConnectionTable({ pinTable }: PinConnectionTableProps): React.ReactElement {
  const [filter, setFilter] = useState<DirectionFilter>('all');

  const filtered = filter === 'all'
    ? pinTable
    : pinTable.filter((p) => p.direction === filter);

  return (
    <div className="pin-table-root">
      {/* 筛选栏 */}
      <div className="pin-filter-bar">
        {(['all', 'input', 'output', 'bidirectional', 'power'] as DirectionFilter[]).map((f) => (
          <button
            key={f}
            className={`pin-filter-btn ${filter === f ? 'pin-filter-btn--active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? '全部' : f}
          </button>
        ))}
        <span className="pin-count">{filtered.length} / {pinTable.length}</span>
      </div>

      {/* 表格 */}
      <div className="pin-table-wrapper">
        <table className="pin-table">
          <thead>
            <tr>
              <th>Designator</th>
              <th>Pin</th>
              <th>Net Name</th>
              <th>Direction</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((pin, i) => (
              <tr key={i}>
                <td className="pin-cell-des">{pin.designator}</td>
                <td className="pin-cell-pin">{pin.pin}</td>
                <td className="pin-cell-net">{pin.netName}</td>
                <td>
                  <span className={`pin-direction pin-direction--${pin.direction}`}>
                    {pin.direction}
                  </span>
                </td>
                <td className="pin-cell-desc">{pin.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
