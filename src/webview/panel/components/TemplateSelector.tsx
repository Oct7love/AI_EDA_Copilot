/** 模板选择器，卡片网格展示，点击预填表单 */
import React, { useCallback } from 'react';
import { PROJECT_TEMPLATES } from '../../../shared/constants/templates';
import { useInputStore } from '../store/inputStore';
import vscodeApi from '../../shared/vscodeApi';
import { createMessage } from '../../../shared/types';
import type { PanelToExtension } from '../../../shared/types';
import './TemplateSelector.css';

/** 模板快速选择 */
export function TemplateSelector(): React.ReactElement {
  const setFormData = useInputStore((s) => s.setFormData);
  const setMode = useInputStore((s) => s.setMode);
  const addMessage = useInputStore((s) => s.addMessage);

  const handleSelect = useCallback(
    (templateId: string) => {
      const template = PROJECT_TEMPLATES.find((t) => t.id === templateId);
      if (!template) return;

      // 预填表单数据
      setFormData({ projectName: template.name, ...template.prefilledData });

      // 切换到表单模式让用户审阅/修改
      setMode('form');

      addMessage('assistant', `Template "${template.name}" loaded. Review and modify the form, then click Analyze.`);

      // 通知 Extension
      const message: PanelToExtension = createMessage(
        'select_template', 'panel', { templateId }
      );
      vscodeApi.postMessage(message);
    },
    [setFormData, setMode, addMessage]
  );

  return (
    <div className="template-grid">
      {PROJECT_TEMPLATES.map((t) => (
        <button key={t.id} className="template-card" onClick={() => handleSelect(t.id)}>
          <span className="template-icon">{t.icon}</span>
          <span className="template-name">{t.name}</span>
          <span className="template-desc">{t.description}</span>
        </button>
      ))}
    </div>
  );
}
