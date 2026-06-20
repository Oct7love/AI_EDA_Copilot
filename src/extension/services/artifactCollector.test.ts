/**
 * artifactCollector 单元测试 — 快照不再丢 procurement / designReview + 旧/损坏快照安全规整
 */
import { describe, it, expect } from 'vitest';
import { collectArtifacts, normalizeArtifacts } from './artifactCollector';

const proc = [{ designator: 'C1', queryStatus: 'in_stock' }] as any;
const review = {
  findings: [{ id: 'x' }],
  summary: { criticalCount: 0, warningCount: 1, infoCount: 0 },
  reviewedAt: '2026-01-01',
} as any;
const bom = [{ designator: 'U1' }] as any;

const baseCaches = {
  requirementSpec: null,
  bomItems: bom,
  procurementItems: proc,
  schematicIntent: null,
  pcbLayoutPlan: null,
  designReviewResult: review,
};

describe('collectArtifacts', () => {
  it('保留 procurement 与 designReview（修复快照恒丢）', () => {
    const a = collectArtifacts(baseCaches);
    expect(a.procurementItems).toEqual(proc);
    expect(a.designReviewResult).toEqual(review);
    expect(a.bomItems).toEqual(bom);
  });

  it('spec 为 null 时 overview 为 null', () => {
    const a = collectArtifacts({ ...baseCaches, requirementSpec: null });
    expect(a.overview).toBeNull();
  });

  it('保存再读取（序列化往返）关键字段一致', () => {
    const collected = collectArtifacts(baseCaches);
    const roundtrip = normalizeArtifacts(JSON.parse(JSON.stringify(collected)));
    expect(roundtrip.procurementItems).toEqual(proc);
    expect(roundtrip.designReviewResult).toEqual(review);
    expect(roundtrip.bomItems).toEqual(bom);
  });
});

describe('normalizeArtifacts', () => {
  it('旧快照缺字段不崩溃，补齐安全默认值', () => {
    const a = normalizeArtifacts({ requirementSpec: null } as any);
    expect(a.bomItems).toEqual([]);
    expect(a.procurementItems).toEqual([]);
    expect(a.designReviewResult).toBeNull();
    expect(a.schematicIntent).toBeNull();
  });

  it('null / undefined 输入安全返回空产物', () => {
    expect(normalizeArtifacts(null).bomItems).toEqual([]);
    expect(normalizeArtifacts(undefined).procurementItems).toEqual([]);
  });

  it('字段类型异常（非数组）退回空数组', () => {
    const a = normalizeArtifacts({ bomItems: 'oops', procurementItems: 42 } as any);
    expect(a.bomItems).toEqual([]);
    expect(a.procurementItems).toEqual([]);
  });
});
