/**
 * versionStore 单元测试 — 版本数组纯函数行为验证
 */
import { describe, it, expect } from 'vitest';
import {
  MAX_VERSIONS,
  appendVersion,
  findVersion,
  removeVersion,
  buildVersionLabel,
  migrateSessionVersions,
} from './versionStore';
import type { ReportVersion, SessionData, SessionArtifacts } from '@shared/types';

function emptyArtifacts(): SessionArtifacts {
  return {
    requirementSpec: null,
    overview: null,
    bomItems: [],
    procurementItems: [],
    schematicIntent: null,
    pcbLayoutPlan: null,
    designReviewResult: null,
  };
}

function makeVersion(id: string): ReportVersion {
  return { id, createdAt: '2026-05-18T00:00:00.000Z', label: `v-${id}`, artifacts: emptyArtifacts() };
}

describe('appendVersion', () => {
  it('空数组追加得到长度 1', () => {
    const out = appendVersion([], makeVersion('a'));
    expect(out.map(v => v.id)).toEqual(['a']);
  });

  it('未满时按顺序追加在末尾', () => {
    const out = appendVersion([makeVersion('a')], makeVersion('b'));
    expect(out.map(v => v.id)).toEqual(['a', 'b']);
  });

  it('恰好满 MAX_VERSIONS 后再追加淘汰最旧', () => {
    const full: ReportVersion[] = Array.from({ length: MAX_VERSIONS }, (_, i) => makeVersion(`v${i}`));
    const out = appendVersion(full, makeVersion('new'));
    expect(out).toHaveLength(MAX_VERSIONS);
    expect(out[0].id).toBe('v1');                 // v0 被淘汰
    expect(out[out.length - 1].id).toBe('new');
  });

  it('不修改入参数组（不可变）', () => {
    const input = [makeVersion('a')];
    appendVersion(input, makeVersion('b'));
    expect(input.map(v => v.id)).toEqual(['a']);
  });
});

describe('findVersion', () => {
  it('命中返回该版本', () => {
    expect(findVersion([makeVersion('a'), makeVersion('b')], 'b')?.id).toBe('b');
  });
  it('未命中返回 undefined', () => {
    expect(findVersion([makeVersion('a')], 'x')).toBeUndefined();
  });
});

describe('removeVersion', () => {
  it('命中移除', () => {
    const out = removeVersion([makeVersion('a'), makeVersion('b')], 'a');
    expect(out.map(v => v.id)).toEqual(['b']);
  });
  it('未命中原样返回新数组', () => {
    const out = removeVersion([makeVersion('a')], 'x');
    expect(out.map(v => v.id)).toEqual(['a']);
  });
  it('不修改入参数组（不可变）', () => {
    const input = [makeVersion('a'), makeVersion('b')];
    removeVersion(input, 'a');
    expect(input).toHaveLength(2);
    expect(input.map(v => v.id)).toEqual(['a', 'b']);
  });
});

describe('buildVersionLabel', () => {
  it('格式包含 v{n} · YYYY-MM-DD HH:mm 结构，月日补零', () => {
    // UTC midnight — 本地日期与 UTC 日期在任意时区都一致
    const label = buildVersionLabel(3, '2026-01-05T00:00:00.000Z');
    expect(label).toMatch(/^v3 · \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(label).toContain('2026');
    expect(label).toContain('-01-'); // 月补零：1月 = '01'
    expect(label).toContain('-05 '); // 日补零：5号 = '05'
  });
});

describe('migrateSessionVersions', () => {
  it('已有 versions 时原样返回', () => {
    const existing = [makeVersion('a')];
    const data = { artifacts: emptyArtifacts(), versions: existing } as unknown as SessionData;
    expect(migrateSessionVersions(data)).toBe(existing);
  });

  it('缺 versions 且 artifacts 全空 → 返回空数组', () => {
    const data = { artifacts: emptyArtifacts(), createdAt: '2026-05-18T00:00:00.000Z' } as unknown as SessionData;
    expect(migrateSessionVersions(data)).toEqual([]);
  });

  it('缺 versions 但 artifacts 非空 → 播种单个 v1', () => {
    const arts = emptyArtifacts();
    arts.bomItems = [{ designator: 'R1' } as never];
    const data = {
      artifacts: arts,
      createdAt: '2026-05-18T00:00:00.000Z',
      updatedAt: '2026-05-18T01:00:00.000Z',
    } as unknown as SessionData;
    const out = migrateSessionVersions(data);
    expect(out).toHaveLength(1);
    expect(out[0].label.startsWith('v1 · ')).toBe(true);
    expect(out[0].artifacts).toBe(arts);
  });
});
