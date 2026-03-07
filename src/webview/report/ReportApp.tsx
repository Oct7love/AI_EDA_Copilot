import React, { useEffect } from 'react';
import type { ExtensionToReport, ReportToExtension, ReportSection } from '../../shared/types';
import { createMessage } from '../../shared/types';
import vscodeApi from '../shared/vscodeApi';
import { useReportStore } from './store/reportStore';
import { OverviewSection } from './components/OverviewSection';
import { RequirementsSection } from './components/RequirementsSection';
import { BomSection } from './components/BomSection';
import { ProcurementSection } from './components/ProcurementSection';
import './ReportApp.css';

const TABS: { id: ReportSection; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'requirements', label: 'Requirements' },
  { id: 'bom', label: 'BOM' },
  { id: 'schematic_intent', label: 'Schematic' },
  { id: 'pcb_layout', label: 'PCB Layout' },
  { id: 'procurement', label: 'Procurement' },
];

export function ReportApp(): React.ReactElement {
  const [activeTab, setActiveTab] = React.useState<ReportSection>('overview');
  const {
    setRequirementSpec, setOverview, setBomItems, setProcurementItems,
    appendStreamContent, setIsStreaming, streamContent,
  } = useReportStore();

  useEffect(() => {
    const handler = (event: MessageEvent<ExtensionToReport>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'report_stream_chunk':
          appendStreamContent(msg.payload.content);
          break;
        case 'report_data': {
          const data = msg.payload.report as { requirementSpec?: unknown; overview?: unknown };
          if (data.requirementSpec) setRequirementSpec(data.requirementSpec as any);
          if (data.overview) setOverview(data.overview as any);
          setIsStreaming(false);
          break;
        }
        case 'bom_data': {
          const bomPayload = msg.payload as { bomItems?: unknown[] };
          if (bomPayload.bomItems) setBomItems(bomPayload.bomItems as any);
          break;
        }
        case 'procurement_data': {
          const procPayload = msg.payload as { procurementItems?: unknown[] };
          if (procPayload.procurementItems) setProcurementItems(procPayload.procurementItems as any);
          break;
        }
        case 'report_stream_end':
          setIsStreaming(false);
          break;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [setRequirementSpec, setOverview, setBomItems, setProcurementItems, appendStreamContent, setIsStreaming]);

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
      case 'procurement':
        return <ProcurementSection />;
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
