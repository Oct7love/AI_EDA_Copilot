/**
 * 导出共享工具函数
 * - 文件名生成（project-name + timestamp + type）
 * - CSV 转义
 */

/** 生成导出文件名，格式：{safeName}-{YYYYMMDD-HHmmss}-{type}.{ext} */
export function generateExportFilename(projectName: string, type: string, ext: string): string {
  const safeName = (projectName || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-|-$/g, '') || 'untitled';
  const now = new Date();
  const ts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '-',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  return `${safeName}-${ts}-${type}.${ext}`;
}

/** CSV 字段转义（逗号、引号、换行） */
export function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
