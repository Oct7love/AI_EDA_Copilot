import React from 'react';
import type { SchematicIntent } from '../../../shared/types';

interface SchematicTextViewProps {
  schematic: SchematicIntent;
}

/** 原理图意图 — 文字描述视图 */
export function SchematicTextView({ schematic }: SchematicTextViewProps): React.ReactElement {
  return (
    <div className="schematic-text-view">
      {/* 模块列表 */}
      <h3 className="section-subtitle">功能模块</h3>
      {schematic.modules.map((mod) => (
        <div key={mod.id} className="schematic-module-card">
          <div className="module-header">
            <strong>{mod.name}</strong>
            <span className="module-id">{mod.id}</span>
          </div>
          <p className="module-desc">{mod.description}</p>
          <div className="module-components">
            {mod.components.map((c) => (
              <span key={c} className="component-tag">{c}</span>
            ))}
          </div>
        </div>
      ))}

      {/* 网络分类 */}
      {schematic.networks.length > 0 && (
        <>
          <h3 className="section-subtitle">网络分类</h3>
          <div className="network-list">
            {schematic.networks.map((net, i) => (
              <div key={i} className="network-item">
                <span className={`network-type network-type--${net.type}`}>{net.type}</span>
                <span className="network-nets">{net.nets.join(', ')}</span>
                <span className="network-desc">{net.description}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 关键连接 */}
      {schematic.connections.length > 0 && (
        <>
          <h3 className="section-subtitle">关键连接 ({schematic.connections.length})</h3>
          <div className="connection-list">
            {schematic.connections.map((conn, i) => (
              <div key={i} className="connection-item">
                <span className="conn-from">{conn.from.designator}.{conn.from.pin}</span>
                <span className="conn-arrow">→</span>
                <span className="conn-to">{conn.to.designator}.{conn.to.pin}</span>
                <span className={`conn-net conn-net--${conn.networkType}`}>{conn.netName}</span>
                {conn.notes && <span className="conn-notes">{conn.notes}</span>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
