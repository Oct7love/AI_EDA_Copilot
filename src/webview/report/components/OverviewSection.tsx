/** 概览板块，展示摘要/就绪度/模块/风险/开放问题 */
import React from 'react';
import type { FunctionalModule, OpenQuestion } from '../../../shared/types';
import { useReportStore } from '../store/reportStore';
import './OverviewSection.css';

function ModuleItem({ mod }: { mod: FunctionalModule }): React.ReactElement {
  return (
    <div className="overview-module-item">
      <span className={`overview-module-badge overview-module-badge--${mod.priority}`}>
        {mod.priority === 'core' ? 'Core' : 'Opt'}
      </span>
      <div className="overview-module-info">
        <div className="overview-module-name">{mod.name}</div>
        <div className="overview-module-desc">{mod.description}</div>
      </div>
    </div>
  );
}

function QuestionItem({ q }: { q: OpenQuestion }): React.ReactElement {
  return (
    <div className={`overview-question-item overview-question-item--${q.priority}`}>
      <span className={`overview-question-priority overview-question-priority--${q.priority}`}>
        {q.priority}
      </span>
      <span className="overview-question-text">{q.question}</span>
    </div>
  );
}

export function OverviewSection(): React.ReactElement {
  const overview = useReportStore((s) => s.overview);

  if (!overview) {
    return (
      <div className="overview-root">
        <div className="overview-empty">暂无概览数据，请先运行分析。</div>
      </div>
    );
  }

  const filledPct = overview.totalFields > 0
    ? Math.round((overview.filledFields / overview.totalFields) * 100)
    : 0;

  return (
    <div className="overview-root">
      {/* 项目摘要 */}
      <div className="overview-summary-card">
        <h2>{overview.projectSummary ? '项目摘要' : 'Project Overview'}</h2>
        <p className="overview-summary-text">{overview.projectSummary || '—'}</p>
      </div>

      {/* 就绪度 */}
      <div className="overview-readiness-card">
        <div className="overview-readiness-header">
          <h3>Readiness Score</h3>
          <span className="overview-readiness-score">{overview.readinessScore}%</span>
        </div>
        <div className="overview-progress-track">
          <div
            className="overview-progress-fill"
            style={{ width: `${overview.readinessScore}%` }}
            role="progressbar"
            aria-valuenow={overview.readinessScore}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
        <div className="overview-stats-grid">
          <div className="overview-stat-item">
            <span className="overview-stat-value">{overview.totalFields}</span>
            <span className="overview-stat-label">Total Fields</span>
          </div>
          <div className="overview-stat-item">
            <span className="overview-stat-value">{overview.filledFields}</span>
            <span className="overview-stat-label">Filled ({filledPct}%)</span>
          </div>
          <div className="overview-stat-item">
            <span className="overview-stat-value">{overview.userProvidedCount}</span>
            <span className="overview-stat-label">User Provided</span>
          </div>
          <div className="overview-stat-item">
            <span className="overview-stat-value">{overview.aiInferredCount}</span>
            <span className="overview-stat-label">AI Inferred</span>
          </div>
        </div>
      </div>

      {/* 功能模块 */}
      {overview.modules.length > 0 && (
        <div className="overview-section">
          <h3>Functional Modules</h3>
          <div className="overview-modules-list">
            {overview.modules.map((mod, i) => (
              <ModuleItem key={`${mod.name}-${i}`} mod={mod} />
            ))}
          </div>
        </div>
      )}

      {/* 关键组件 */}
      {overview.keyComponents.length > 0 && (
        <div className="overview-section">
          <h3>Key Components</h3>
          <div className="overview-tags">
            {overview.keyComponents.map((comp, i) => (
              <span key={i} className="overview-tag">{comp}</span>
            ))}
          </div>
        </div>
      )}

      {/* 开放问题 */}
      {overview.openQuestions.length > 0 && (
        <div className="overview-section">
          <h3>Open Questions</h3>
          <div className="overview-questions-list">
            {overview.openQuestions.map((q) => (
              <QuestionItem key={q.id} q={q} />
            ))}
          </div>
        </div>
      )}

      {/* 风险 */}
      {overview.risks.length > 0 && (
        <div className="overview-section">
          <h3>Risks</h3>
          <ul className="overview-list">
            {overview.risks.map((risk, i) => (
              <li key={i} className="overview-list-item overview-risk-item">{risk}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 下一步 */}
      {overview.nextSteps.length > 0 && (
        <div className="overview-section">
          <h3>Next Steps</h3>
          <ul className="overview-list">
            {overview.nextSteps.map((step, i) => (
              <li key={i} className="overview-list-item">{step}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
