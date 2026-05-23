/** 代码分析 — 文件夹选择入口（idle / scanning / failed 状态） */
import React, { useCallback } from 'react';
import { useInputStore } from '../store/inputStore';
import vscodeApi from '../../shared/vscodeApi';
import { createMessage } from '../../../shared/types';
import type { PanelToExtension } from '../../../shared/types';
import './CodeFolderPicker.css';

/** 代码文件夹选择入口 */
export function CodeFolderPicker(): React.ReactElement {
  const status = useInputStore((s) => s.codeAnalysisStatus);
  const error = useInputStore((s) => s.codeAnalysisError);
  const setScanning = useInputStore((s) => s.setCodeAnalysisScanning);

  const handlePick = useCallback(() => {
    setScanning();
    const message: PanelToExtension = createMessage('pick_code_folder', 'panel', undefined);
    vscodeApi.postMessage(message);
  }, [setScanning]);

  return (
    <div className="code-picker">
      <p className="code-picker__hint">
        选择一个 Arduino/ESP32 固件代码文件夹，自动提取 GPIO、库与外设。
      </p>
      <button
        className="code-picker__btn"
        onClick={handlePick}
        disabled={status === 'scanning'}
      >
        {status === 'scanning' ? '扫描中…' : '选择代码文件夹'}
      </button>
      {status === 'failed' && error && <p className="code-picker__error">{error}</p>}
    </div>
  );
}
