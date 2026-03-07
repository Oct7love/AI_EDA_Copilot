import React, { useCallback } from 'react';
import { useInputStore } from '../store/inputStore';
import vscodeApi from '../../shared/vscodeApi';
import { createMessage } from '../../../shared/types';
import type { PanelToExtension } from '../../../shared/types';
import './FormInput.css';

/** 表单模式输入：对齐 RequirementSpec 核心 + 扩展字段 */
export function FormInput(): React.ReactElement {
  const formData = useInputStore((s) => s.formData);
  const updateFormField = useInputStore((s) => s.updateFormField);
  const addMessage = useInputStore((s) => s.addMessage);
  const isGenerating = useInputStore((s) => s.isGenerating);

  const handleChange = useCallback(
    (key: keyof typeof formData, value: string) => {
      updateFormField(key, value as never);
    },
    [updateFormField]
  );

  const handleArrayChange = useCallback(
    (key: 'communication' | 'sensors', value: string) => {
      const items = value.split(',').map((s) => s.trim()).filter(Boolean);
      updateFormField(key, items);
    },
    [updateFormField]
  );

  const handleSubmit = useCallback(() => {
    const summary = formData.projectName || formData.mcu || 'Unnamed project';
    addMessage('user', `[Form] ${summary}`);

    const message: PanelToExtension = createMessage(
      'submit_requirement', 'panel', {
        text: JSON.stringify(formData),
        mode: 'form' as const,
      }
    );
    vscodeApi.postMessage(message);
  }, [formData, addMessage]);

  return (
    <div className="form-input">
      {/* 核心需求（优先展示） */}
      <fieldset className="form-section">
        <legend>Core Requirements</legend>
        <FormField label="Project Name" value={formData.projectName}
          onChange={(v) => handleChange('projectName', v)} />
        <FormField label="MCU / Main Controller" value={formData.mcu}
          onChange={(v) => handleChange('mcu', v)} placeholder="e.g. ESP32-WROOM-32" />
        <FormField label="Power" value={formData.power}
          onChange={(v) => handleChange('power', v)} placeholder="e.g. 3.3V LDO, USB powered" />
        <FormField label="Communication" value={formData.communication.join(', ')}
          onChange={(v) => handleArrayChange('communication', v)} placeholder="e.g. Wi-Fi, UART, I2C" />
        <FormField label="Display" value={formData.display}
          onChange={(v) => handleChange('display', v)} placeholder="e.g. SSD1306 OLED 0.96&quot;" />
        <FormField label="Sensors" value={formData.sensors.join(', ')}
          onChange={(v) => handleArrayChange('sensors', v)} placeholder="e.g. DHT22, BMP280" />
      </fieldset>

      {/* 扩展需求（折叠展示） */}
      <details className="form-section-collapsible">
        <summary>Extended Requirements</summary>
        <div className="form-section-body">
          <FormField label="Cost Range" value={formData.costRange}
            onChange={(v) => handleChange('costRange', v)} placeholder="e.g. < ¥50" />
          <FormField label="Size Limit" value={formData.sizeLimit}
            onChange={(v) => handleChange('sizeLimit', v)} placeholder="e.g. 50mm x 30mm" />
          <FormField label="Production Intent" value={formData.productionIntent}
            onChange={(v) => handleChange('productionIntent', v)} placeholder="prototype / small_batch / mass" />
          <FormField label="Power Consumption" value={formData.powerConsumption}
            onChange={(v) => handleChange('powerConsumption', v)} placeholder="e.g. < 100mA" />
          <FormField label="Precision" value={formData.precision}
            onChange={(v) => handleChange('precision', v)} placeholder="e.g. ±0.5°C" />
          <FormField label="Additional Notes" value={formData.additionalNotes}
            onChange={(v) => handleChange('additionalNotes', v)} multiline />
        </div>
      </details>

      <button className="btn-analyze" onClick={handleSubmit} disabled={isGenerating}>
        {isGenerating ? 'Generating...' : 'Analyze'}
      </button>
    </div>
  );
}

/** 通用表单字段 */
function FormField({
  label, value, onChange, placeholder, multiline,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
}): React.ReactElement {
  return (
    <label className="form-field">
      <span className="form-label">{label}</span>
      {multiline ? (
        <textarea className="form-textarea" value={value}
          onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={2} />
      ) : (
        <input className="form-text" type="text" value={value}
          onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      )}
    </label>
  );
}
