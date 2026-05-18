/**
 * JSON 导出器测试 — buildJsonReport 纯函数
 */
import { describe, it, expect, vi } from 'vitest';

// Mock vscode module（测试环境不可用）
vi.mock('vscode', () => ({}));

import { buildJsonReport } from './jsonExporter';
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

describe('buildJsonReport', () => {
  it('输出有效 JSON', () => {
    const json = buildJsonReport(emptyArtifacts, 'Test');
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('包含 projectName 和 generatedAt', () => {
    const json = buildJsonReport(emptyArtifacts, 'My Project');
    const parsed = JSON.parse(json);
    expect(parsed.projectName).toBe('My Project');
    expect(parsed.generatedAt).toBeTruthy();
  });

  it('包含所有产物字段', () => {
    const json = buildJsonReport(emptyArtifacts, 'Test');
    const parsed = JSON.parse(json);
    expect(parsed.artifacts).toHaveProperty('requirementSpec');
    expect(parsed.artifacts).toHaveProperty('bomItems');
    expect(parsed.artifacts).toHaveProperty('schematicIntent');
    expect(parsed.artifacts).toHaveProperty('pcbLayoutPlan');
    expect(parsed.artifacts).toHaveProperty('designReviewResult');
  });

  it('空项目名使用 Untitled', () => {
    const json = buildJsonReport(emptyArtifacts, '');
    const parsed = JSON.parse(json);
    expect(parsed.projectName).toBe('Untitled');
  });
});
