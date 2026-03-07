import React, { useState, useCallback } from 'react';
import type { RequirementField, FunctionalModule, OpenQuestion, FieldStatus } from '../../../shared/types';
import { createMessage } from '../../../shared/types';
import vscodeApi from '../../shared/vscodeApi';
import { useReportStore } from '../store/reportStore';
import './RequirementsSection.css';

// ─── 工具组件 ────────────────────────────────────────

function SourceBadge({ source }: { source: 'user_provided' | 'ai_inferred' }): React.ReactElement {
  return (
    <span className={`requirements-source-badge requirements-source-badge--${source === 'user_provided' ? 'user' : 'ai'}`}>
      {source === 'user_provided' ? 'user' : 'ai'}
    </span>
  );
}

function StatusBadge({ status }: { status: FieldStatus }): React.ReactElement {
  return (
    <span className={`requirements-status-badge requirements-status-badge--${status}`}>
      {status === 'confirmed' ? '✓' : '?'}
    </span>
  );
}

function ArrayTags({ values }: { values: string[] }): React.ReactElement {
  if (!values || values.length === 0) {
    return <span className="requirements-field-value requirements-field-value--empty">未指定</span>;
  }
  return (
    <div className="requirements-tags">
      {values.map((v, i) => (
        <span key={i} className="requirements-tag">{v}</span>
      ))}
    </div>
  );
}

// ─── 可编辑字段行 ────────────────────────────────────

interface FieldRowProps {
  fieldKey: string;
  label: string;
  field: RequirementField<string> | RequirementField<string[]>;
  isArray?: boolean;
  readonly?: boolean;
}

function FieldRow({ fieldKey, label, field, isArray = false, readonly = false }: FieldRowProps): React.ReactElement {
  const { editingFields, setEditingField, clearEditingField } = useReportStore();
  const isEditing = fieldKey in editingFields;

  const displayValue = isArray
    ? null
    : ((field as RequirementField<string>).value ?? null);

  const commitEdit = useCallback(() => {
    if (!isEditing) return;
    const newValue = editingFields[fieldKey];
    vscodeApi.postMessage(createMessage('requirement_edit', 'report', { field: fieldKey, value: newValue }));
    clearEditingField(fieldKey);
  }, [isEditing, editingFields, fieldKey, clearEditingField]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commitEdit();
    if (e.key === 'Escape') clearEditingField(fieldKey);
  };

  const handleValueClick = () => {
    if (readonly || isArray) return;
    setEditingField(fieldKey, displayValue ?? '');
  };

  return (
    <div className="requirements-field-row">
      <span className="requirements-field-label">{label}</span>

      <div className="requirements-field-value-area">
        {isArray ? (
          <ArrayTags values={(field as RequirementField<string[]>).value ?? []} />
        ) : isEditing ? (
          <input
            className="requirements-field-input"
            value={editingFields[fieldKey]}
            onChange={(e) => setEditingField(fieldKey, e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            autoFocus
          />
        ) : (
          <span
            className={`requirements-field-value${displayValue == null ? ' requirements-field-value--empty' : ''}`}
            onClick={handleValueClick}
            title={readonly ? undefined : '点击编辑'}
          >
            {displayValue ?? '未指定'}
          </span>
        )}
      </div>

      <div className="requirements-source-meta">
        <SourceBadge source={field.source} />
        <StatusBadge status={field.status} />
        <span className="requirements-confidence">{Math.round(field.confidence * 100)}%</span>
      </div>
    </div>
  );
}

// ─── 折叠组 ─────────────────────────────────────────

interface FieldGroupProps {
  title: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  children: React.ReactNode;
}

function FieldGroup({ title, collapsible = false, defaultCollapsed = false, children }: FieldGroupProps): React.ReactElement {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div className="requirements-group">
      <div className="requirements-group-header">
        <h3 className="requirements-group-title">{title}</h3>
        {collapsible && (
          <button className="requirements-toggle-btn" onClick={() => setCollapsed((v) => !v)}>
            <i className={`requirements-toggle-icon${collapsed ? '' : ' requirements-toggle-icon--open'}`}>›</i>
            {collapsed ? '展开' : '收起'}
          </button>
        )}
      </div>
      {!collapsed && <div className="requirements-fields-list">{children}</div>}
    </div>
  );
}

// ─── 主组件 ──────────────────────────────────────────

export function RequirementsSection(): React.ReactElement {
  const spec = useReportStore((s) => s.requirementSpec);

  if (!spec) {
    return (
      <div className="requirements-root">
        <div className="requirements-empty">暂无需求数据，请先运行分析。</div>
      </div>
    );
  }

  return (
    <div className="requirements-root">
      {/* 核心字段 */}
      <FieldGroup title="Core Requirements">
        <FieldRow fieldKey="projectName" label="Project Name" field={spec.projectName} />
        <FieldRow fieldKey="projectDescription" label="Description" field={spec.projectDescription} />
        <FieldRow fieldKey="mcu" label="MCU" field={spec.mcu} />
        <FieldRow fieldKey="power" label="Power Supply" field={spec.power} />
        <FieldRow fieldKey="communication" label="Communication" field={spec.communication} isArray />
        <FieldRow fieldKey="display" label="Display" field={spec.display} />
        <FieldRow fieldKey="sensors" label="Sensors" field={spec.sensors} isArray />
      </FieldGroup>

      {/* 扩展字段（默认折叠） */}
      <FieldGroup title="Extended Requirements" collapsible defaultCollapsed>
        <FieldRow fieldKey="costRange" label="Cost Range" field={spec.costRange} />
        <FieldRow fieldKey="sizeLimit" label="Size Limit" field={spec.sizeLimit} />
        <FieldRow fieldKey="productionIntent" label="Production Intent" field={spec.productionIntent} />
        <FieldRow fieldKey="powerConsumption" label="Power Consumption" field={spec.powerConsumption} />
        <FieldRow fieldKey="precision" label="Precision" field={spec.precision} />
        <FieldRow fieldKey="additionalNotes" label="Additional Notes" field={spec.additionalNotes} />
      </FieldGroup>

      {/* 功能模块（只读） */}
      {spec.functionalModules.length > 0 && (
        <div className="requirements-group">
          <div className="requirements-group-header">
            <h3 className="requirements-group-title">Functional Modules</h3>
          </div>
          <div className="requirements-modules-list">
            {spec.functionalModules.map((mod: FunctionalModule, i: number) => (
              <div key={i} className="requirements-module-item">
                <span className={`requirements-module-badge requirements-module-badge--${mod.priority}`}>
                  {mod.priority === 'core' ? 'Core' : 'Opt'}
                </span>
                <span className="requirements-module-name">{mod.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 开放问题（只读） */}
      {spec.openQuestions.length > 0 && (
        <div className="requirements-group">
          <div className="requirements-group-header">
            <h3 className="requirements-group-title">Open Questions</h3>
          </div>
          <div className="requirements-questions-list">
            {spec.openQuestions.map((q: OpenQuestion) => (
              <div key={q.id} className={`requirements-question-item requirements-question-item--${q.priority}`}>
                <span className={`requirements-question-priority requirements-question-priority--${q.priority}`}>
                  {q.priority}
                </span>
                <span className="requirements-question-text">{q.question}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
