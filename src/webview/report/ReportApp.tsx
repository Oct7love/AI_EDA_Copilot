/** Report Tab 主组件，管理 6-Tab 导航和消息路由 */
import React, { useEffect } from 'react';
import type { ExtensionToReport, ReportToExtension, ReportSection } from '../../shared/types';
import { createMessage } from '../../shared/types';
import vscodeApi from '../shared/vscodeApi';
import { useReportStore } from './store/reportStore';
import { OverviewSection } from './components/OverviewSection';
import { RequirementsSection } from './components/RequirementsSection';
import { BomSection } from './components/BomSection';
import { ProcurementSection } from './components/ProcurementSection';
import { SchematicSection } from './components/SchematicSection';
import { PcbLayoutSection } from './components/PcbLayoutSection';
import { DesignReviewSection } from './components/DesignReviewSection';
import './ReportApp.css';

const TABS: { id: ReportSection; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'requirements', label: 'Requirements' },
  { id: 'bom', label: 'BOM' },
  { id: 'schematic_intent', label: 'Schematic' },
  { id: 'pcb_layout', label: 'PCB Layout' },
  { id: 'procurement', label: 'Procurement' },
  { id: 'design_review', label: 'Design Review' },
];

export function ReportApp(): React.ReactElement {
  const [activeTab, setActiveTab] = React.useState<ReportSection>('overview');
  const {
    setRequirementSpec, setOverview, setBomItems, setProcurementItems,
    setSchematicIntent, setPcbLayoutPlan, setDesignReviewResult,
    appendStreamContent, setIsStreaming, streamContent,
  } = useReportStore();

  useEffect(() => {
    const handler = (event: MessageEvent<ExtensionToReport>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'report_stream_chunk':
          appendStreamContent(msg.payload.content);
          break;
        case 'report_data':
          setRequirementSpec(msg.payload.report.requirementSpec);
          setOverview(msg.payload.report.overview);
          setIsStreaming(false);
          break;
        case 'bom_data':
          setBomItems(msg.payload.bomItems);
          break;
        case 'procurement_data':
          setProcurementItems(msg.payload.procurementItems);
          break;
        case 'schematic_data':
          setSchematicIntent(msg.payload.schematicIntent);
          break;
        case 'pcb_layout_data':
          setPcbLayoutPlan(msg.payload.pcbLayoutPlan);
          break;
        case 'design_review_data':
          setDesignReviewResult(msg.payload.designReviewResult);
          break;
        case 'report_stream_end':
          setIsStreaming(false);
          break;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [setRequirementSpec, setOverview, setBomItems, setProcurementItems, setSchematicIntent, setPcbLayoutPlan, setDesignReviewResult, appendStreamContent, setIsStreaming]);

  const handleExport = (format: 'csv' | 'markdown' | 'json') => {
    const message: ReportToExtension = createMessage('export_request', 'report', { format, section: activeTab });
    vscodeApi.postMessage(message);
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview':
        return <OverviewSection />;
      case 'requirements':
        return <RequirementsSection />;
      case 'bom':
        return <BomSection />;
      case 'schematic_intent':
        return <SchematicSection />;
      case 'pcb_layout':
        return <PcbLayoutSection />;
      case 'procurement':
        return <ProcurementSection />;
      case 'design_review':
        return <DesignReviewSection />;
      default:
        return (
          <div className="section-placeholder">
            <h2>{TABS.find(t => t.id === activeTab)?.label}</h2>
            {streamContent ? (
              <pre className="stream-output">{streamContent}</pre>
            ) : (
              <p className="empty-hint">Content will appear here after analysis.</p>
            )}
          </div>
        );
    }
  };

  return (
    <div className="report-container">
      <nav className="report-tabs" role="tablist">
        {TABS.map(tab => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`tab-button ${activeTab === tab.id ? 'tab-active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <main className="report-content" role="tabpanel">
        {renderTabContent()}
      </main>
      <footer className="report-footer">
        <button className="btn-export" onClick={() => handleExport('markdown')}>Export Markdown</button>
        <button className="btn-export" onClick={() => handleExport('json')}>Export JSON</button>
        <button className="btn-export" onClick={() => handleExport('csv')}>Export CSV</button>
      </footer>
    </div>
  );
}
