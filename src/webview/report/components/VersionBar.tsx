/** Report 顶部版本栏：切换/删除/另存历史报告版本 */
import React from 'react';
import { createMessage } from '../../../shared/types';
import vscodeApi from '../../shared/vscodeApi';
import { useReportStore } from '../store/reportStore';
import './VersionBar.css';

export function VersionBar(): React.ReactElement | null {
  const versions = useReportStore((s) => s.versions);
  const currentVersionId = useReportStore((s) => s.currentVersionId);

  if (versions.length === 0) return null;

  const selectedId = currentVersionId ?? versions[versions.length - 1].id;

  const handleSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    vscodeApi.postMessage(
      createMessage('restore_version', 'report', { versionId: e.target.value }),
    );
  };

  const handleDelete = () => {
    if (!window.confirm('删除该版本？此操作不可撤销。')) return;
    vscodeApi.postMessage(
      createMessage('delete_version', 'report', { versionId: selectedId }),
    );
  };

  const handleExport = (format: 'csv' | 'markdown' | 'json') => {
    vscodeApi.postMessage(
      createMessage('export_version', 'report', { versionId: selectedId, format }),
    );
  };

  return (
    <div className="version-bar">
      <span className="version-bar__label">报告版本</span>
      <select
        className="version-bar__select"
        value={selectedId}
        onChange={handleSelect}
        aria-label="选择报告版本"
      >
        {versions.map((v) => (
          <option key={v.id} value={v.id}>{v.label}</option>
        ))}
      </select>
      <button className="version-bar__btn" onClick={() => handleExport('markdown')}>另存 MD</button>
      <button className="version-bar__btn" onClick={() => handleExport('json')}>另存 JSON</button>
      <button className="version-bar__btn" onClick={() => handleExport('csv')}>另存 CSV</button>
      <button className="version-bar__btn version-bar__btn--danger" onClick={handleDelete}>删除此版</button>
    </div>
  );
}
