/** 原理图意图板块，三视图切换（文字/框图/引脚表） */
import React, { useState } from 'react';
import { useReportStore } from '../store/reportStore';
import { SchematicTextView } from './SchematicTextView';
import { PinConnectionTable } from './PinConnectionTable';
import { MermaidRenderer } from './MermaidRenderer';
import { StaleIndicator } from './StaleIndicator';
import './SchematicSection.css';

type SchematicView = 'text' | 'diagram' | 'pins';

/** 原理图意图板块 — 三种展示形式切换 */
export function SchematicSection(): React.ReactElement {
  const schematic = useReportStore((s) => s.schematicIntent);
  const artifactStatus = useReportStore((s) => s.artifactStatus);
  const [activeView, setActiveView] = useState<SchematicView>('text');

  if (!schematic) {
    return (
      <div className="schematic-root">
        <div className="schematic-empty">暂无原理图数据，请先运行分析。</div>
      </div>
    );
  }

  // 组合所有模块的 mermaidBlock 为完整图表
  const combinedMermaid = buildCombinedMermaid(schematic.modules);

  const views: { id: SchematicView; label: string }[] = [
    { id: 'text', label: '文字描述' },
    { id: 'diagram', label: '模块框图' },
    { id: 'pins', label: '引脚连接表' },
  ];

  return (
    <div className="schematic-root">
      <StaleIndicator stage="schematic" status={artifactStatus?.schematic ?? 'valid'} />
      {/* 摘要统计 */}
      <div className="schematic-header">
        <div className="schematic-stats">
          <span className="schematic-stat">{schematic.modules.length} 个模块</span>
          <span className="schematic-stat">{schematic.connections.length} 个连接</span>
          <span className="schematic-stat">{schematic.pinTable.length} 个引脚</span>
          <span className="schematic-stat">{schematic.networks.length} 个网络</span>
        </div>
      </div>

      {/* 视图切换 */}
      <div className="schematic-view-toggle">
        {views.map((v) => (
          <button
            key={v.id}
            className={`view-toggle-btn ${activeView === v.id ? 'view-toggle-btn--active' : ''}`}
            onClick={() => setActiveView(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="schematic-content">
        {activeView === 'text' && <SchematicTextView schematic={schematic} />}
        {activeView === 'diagram' && <MermaidRenderer source={combinedMermaid} />}
        {activeView === 'pins' && <PinConnectionTable pinTable={schematic.pinTable} />}
      </div>
    </div>
  );
}

/** 将各模块 mermaidBlock 合并为完整 flowchart */
function buildCombinedMermaid(modules: { mermaidBlock?: string; name: string }[]): string {
  const blocks = modules
    .filter((m) => m.mermaidBlock)
    .map((m) => m.mermaidBlock!);

  if (blocks.length === 0) return '';
  return 'flowchart TB\n' + blocks.join('\n');
}
