/** 产物状态横幅：stale 显示黄色提示 + Regenerate 按钮，generating 显示加载动画 */
import React from 'react';
import type { ArtifactKey, ArtifactStatus } from '../../../shared/types';
import { createMessage } from '../../../shared/types';
import vscodeApi from '../../shared/vscodeApi';
import './StaleIndicator.css';

interface StaleIndicatorProps {
  stage: ArtifactKey;
  status: ArtifactStatus;
}

const STAGE_LABELS: Record<ArtifactKey, string> = {
  requirement: '需求',
  bom: 'BOM',
  schematic: '原理图',
  pcbLayout: 'PCB 布局',
  procurement: '采购',
  designReview: '设计审查',
};

export function StaleIndicator({ stage, status }: StaleIndicatorProps): React.ReactElement | null {
  if (status === 'valid') return null;

  const handleRegenerate = () => {
    vscodeApi.postMessage(
      createMessage('regenerate_stage', 'report', { stage, mode: 'cascade' as const })
    );
  };

  if (status === 'generating') {
    return (
      <div className="stale-banner stale-banner--generating">
        <span className="stale-icon">⟳</span>
        <span>正在重新生成{STAGE_LABELS[stage]}...</span>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="stale-banner stale-banner--error">
        <span className="stale-icon">!</span>
        <span>{STAGE_LABELS[stage]}生成失败</span>
        <button className="stale-regen-btn" onClick={handleRegenerate}>重试</button>
      </div>
    );
  }

  // status === 'stale'
  return (
    <div className="stale-banner stale-banner--stale">
      <span className="stale-icon">!</span>
      <span>上游数据已变更，{STAGE_LABELS[stage]}内容可能已过期</span>
      <button className="stale-regen-btn" onClick={handleRegenerate}>重新生成</button>
    </div>
  );
}
