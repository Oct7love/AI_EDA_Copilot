/**
 * Markdown 导出器测试 — buildMarkdownReport 纯函数
 */
import { describe, it, expect, vi } from 'vitest';

// Mock vscode module（测试环境不可用）
vi.mock('vscode', () => ({}));

import { buildMarkdownReport } from './markdownExporter';
import type { SessionArtifacts } from '../../shared/types';

const emptyArtifacts: SessionArtifacts = {
  requirementSpec: null,
  overview: null,
  bomItems: [],
  procurementItems: [],
  schematicIntent: null,
  pcbLayoutPlan: null,
  designReviewResult: null,
};

describe('buildMarkdownReport', () => {
  it('空产物时仍输出完整 7 章结构', () => {
    const md = buildMarkdownReport(emptyArtifacts, 'Test Project');
    expect(md).toContain('# Test Project - AI EDA Design Report');
    expect(md).toContain('## 1. Overview');
    expect(md).toContain('## 2. Requirements');
    expect(md).toContain('## 3. Bill of Materials');
    expect(md).toContain('## 4. Schematic Intent');
    expect(md).toContain('## 5. PCB Layout Plan');
    expect(md).toContain('## 6. Procurement');
    expect(md).toContain('## 7. Design Review');
  });

  it('空产物各章显示 no data 提示', () => {
    const md = buildMarkdownReport(emptyArtifacts, 'Test');
    expect(md).toContain('_No overview data available._');
    expect(md).toContain('_No requirements data available._');
    expect(md).toContain('_No BOM data available._');
  });

  it('BOM 数据输出为表格', () => {
    const arts: SessionArtifacts = {
      ...emptyArtifacts,
      bomItems: [
        {
          designator: 'U1',
          comment: 'ESP32-S3',
          footprint: 'QFN-56',
          quantity: 1,
          jlcPartNumber: 'C123456',
          category: 'IC',
        } as never,
      ],
    };
    const md = buildMarkdownReport(arts, 'Test');
    expect(md).toContain('| 1 | U1 | ESP32-S3 | QFN-56 | 1 | C123456 |');
    expect(md).toContain('Total: 1 parts, 1 matched');
  });

  it('无项目名时使用 Untitled', () => {
    const md = buildMarkdownReport(emptyArtifacts, '');
    expect(md).toContain('# Untitled - AI EDA Design Report');
  });

  it('设计审查按 severity 分组', () => {
    const arts: SessionArtifacts = {
      ...emptyArtifacts,
      designReviewResult: {
        findings: [
          { severity: 'critical', title: 'Missing decap', description: 'No decoupling', suggestion: 'Add C1' } as never,
          { severity: 'warning', title: 'Wide trace', description: 'Too wide', suggestion: null } as never,
        ],
        summary: { criticalCount: 1, warningCount: 1, infoCount: 0 },
        reviewedAt: '2026-01-01',
      },
    };
    const md = buildMarkdownReport(arts, 'Test');
    expect(md).toContain('### Critical Findings');
    expect(md).toContain('**Missing decap**');
    expect(md).toContain('Suggestion: Add C1');
    expect(md).toContain('### Warning Findings');
  });
});
