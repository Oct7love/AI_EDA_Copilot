/**
 * 报告版本纯逻辑 — 版本数组的追加/淘汰/查找/移除/迁移/label 生成
 *
 * 全部为不可变纯函数，无 vscode 依赖，可独立单测。
 * SessionManager 仅做编排，版本逻辑集中于此。
 */
import type { ReportVersion, SessionData, SessionArtifacts } from '@shared/types';

/** 每个会话最多保留的版本数，超出淘汰最旧 */
export const MAX_VERSIONS = 10;

/** 追加一个版本并淘汰最旧（FIFO），返回新数组 */
export function appendVersion(
  versions: ReportVersion[],
  snapshot: ReportVersion,
  max: number = MAX_VERSIONS,
): ReportVersion[] {
  const next = [...versions, snapshot];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** 按 id 查找版本，未找到返回 undefined */
export function findVersion(
  versions: ReportVersion[],
  id: string,
): ReportVersion | undefined {
  return versions.find((v) => v.id === id);
}

/** 按 id 移除版本，返回新数组（未命中原样返回拷贝） */
export function removeVersion(
  versions: ReportVersion[],
  id: string,
): ReportVersion[] {
  return versions.filter((v) => v.id !== id);
}

/** 构造版本展示 label：v{n} · 本地化时间 */
export function buildVersionLabel(index: number, createdAt: string): string {
  const d = new Date(createdAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `v${index} · ${stamp}`;
}

/** 判断一套 artifacts 是否存在任意非空产物 */
function hasAnyArtifact(a: SessionArtifacts): boolean {
  return Boolean(
    a.requirementSpec ||
    a.overview ||
    (a.bomItems && a.bomItems.length > 0) ||
    (a.procurementItems && a.procurementItems.length > 0) ||
    a.schematicIntent ||
    a.pcbLayoutPlan ||
    a.designReviewResult,
  );
}

/**
 * 迁移规整：旧 SessionData 无 versions 字段时补齐。
 * - 已有 versions：原样返回（引用不变）
 * - 缺 versions 且 artifacts 非空：播种为单个 v1
 * - 缺 versions 且 artifacts 全空：返回 []
 * 仅在内存中规整，调用方负责后续正常写盘时落盘。
 */
export function migrateSessionVersions(data: SessionData): ReportVersion[] {
  if (Array.isArray(data.versions)) return data.versions;
  if (!data.artifacts || !hasAnyArtifact(data.artifacts)) return [];
  const createdAt = data.createdAt || data.updatedAt || new Date().toISOString();
  return [
    {
      id: `seed-${createdAt}`,
      createdAt,
      label: buildVersionLabel(1, createdAt),
      artifacts: data.artifacts,
    },
  ];
}
