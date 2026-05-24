/** 代码分析结果预览 — 用户确认后注入管线 */
import React, { useState, useCallback } from 'react';
import { useInputStore } from '../store/inputStore';
import vscodeApi from '../../shared/vscodeApi';
import { createMessage } from '../../../shared/types';
import type { PanelToExtension } from '../../../shared/types';
import './CodeAnalysisPreview.css';

/** 扫描结果预览 + 补充说明 + 确认/取消 */
export function CodeAnalysisPreview(): React.ReactElement | null {
  const result = useInputStore((s) => s.codeAnalysisResult);
  const resetCodeAnalysis = useInputStore((s) => s.resetCodeAnalysis);
  const addMessage = useInputStore((s) => s.addMessage);
  const setIsGenerating = useInputStore((s) => s.setIsGenerating);
  const [notes, setNotes] = useState('');

  const handleConfirm = useCallback(() => {
    if (!result) return;
    addMessage('user', `[代码分析] 已导入固件代码，扫描 ${result.scannedFiles} 个文件`);
    setIsGenerating(true);
    const message: PanelToExtension = createMessage(
      'submit_code_analysis', 'panel', { result, notes },
    );
    vscodeApi.postMessage(message);
    resetCodeAnalysis();
  }, [result, notes, addMessage, setIsGenerating, resetCodeAnalysis]);

  if (!result) return null;

  return (
    <div className="code-preview">
      <div className="code-preview__summary">
        扫描了 {result.scannedFiles} 个文件
        {result.truncated ? '（已达上限，仅扫描部分文件）' : ''}
      </div>

      <div className="code-preview__section">
        <span className="code-preview__label">检测到的库 ({result.detectedLibraries.length})</span>
        {result.detectedLibraries.length > 0 ? (
          <div className="code-preview__tags">
            {result.detectedLibraries.map((l) => (
              <span key={l} className="code-preview__tag">{l}</span>
            ))}
          </div>
        ) : <span className="code-preview__empty">无</span>}
      </div>

      <div className="code-preview__section">
        <span className="code-preview__label">检测到的外设 ({result.detectedPeripherals.length})</span>
        {result.detectedPeripherals.length > 0 ? (
          <div className="code-preview__tags">
            {result.detectedPeripherals.map((p) => (
              <span key={p} className="code-preview__tag">{p}</span>
            ))}
          </div>
        ) : <span className="code-preview__empty">无</span>}
      </div>

      <div className="code-preview__section">
        <span className="code-preview__label">GPIO 使用 ({result.detectedGpios.length})</span>
        {result.detectedGpios.length > 0 ? (
          <ul className="code-preview__list">
            {result.detectedGpios.map((g) => (
              <li key={g.pin}>引脚 {g.pin} · {g.direction} · {g.usage}</li>
            ))}
          </ul>
        ) : <span className="code-preview__empty">无</span>}
      </div>

      {result.ambiguousReferences.length > 0 && (
        <div className="code-preview__section code-preview__section--ambiguous">
          <span className="code-preview__label">
            模糊引用 ({result.ambiguousReferences.length})
          </span>
          <ul className="code-preview__list">
            {result.ambiguousReferences.map((a) => (
              <li key={a.reference}>{a.reference}: {a.question}</li>
            ))}
          </ul>
        </div>
      )}

      <textarea
        className="code-preview__notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="补充说明（可选）：项目用途、代码未体现的需求…"
        rows={2}
      />

      <div className="code-preview__actions">
        <button className="code-preview__btn-secondary" onClick={resetCodeAnalysis}>
          重选文件夹
        </button>
        <button className="code-preview__btn-primary" onClick={handleConfirm}>
          用此分析生成报告
        </button>
      </div>
    </div>
  );
}
