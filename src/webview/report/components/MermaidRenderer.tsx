/** Mermaid 源码格式化展示组件（MVP，预留 CDN 渲染接口） */
import React from 'react';

interface MermaidRendererProps {
  /** Mermaid flowchart 源码 */
  source: string;
}

/**
 * Mermaid 图表渲染器
 * Phase 5 MVP: 格式化源码展示，预留未来 CDN 渲染接口
 */
export function MermaidRenderer({ source }: MermaidRendererProps): React.ReactElement {
  if (!source) {
    return <div className="mermaid-empty">暂无框图数据</div>;
  }

  return (
    <div className="mermaid-container">
      <pre className="mermaid-source"><code>{source}</code></pre>
    </div>
  );
}
