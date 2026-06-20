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

/**
 * CSV 字段转义（逗号、引号、换行）+ 公式注入防护。
 *
 * 安全：BOM 字段（comment/designator/footprint/料号）来自 AI 输出，可能以
 * = + - @ 或制表符/回车开头。这类单元格在 Excel / Google Sheets / WPS 打开时会被
 * 当作公式执行（DDE / 数据外泄）。导出的 CSV 正是面向嘉立创 SMT 的交付物，
 * 极可能被电子表格打开，因此对危险前缀加单引号守卫后再做标准引用。
 */
export function csvEscape(value: string): string {
  let v = value ?? '';
  if (/^[=+\-@\t\r]/.test(v)) {
    v = `'${v}`;
  }
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
