/**
 * BOM CSV 导出，对齐嘉立创 SMT 模板格式
 */
import * as vscode from 'vscode';
import type { BOMItem } from '@shared/types';

/** 对齐嘉立创 SMT BOM 模板：Comment, Designator, Footprint, LCSC Part # */
export async function exportBomCsv(bomItems: BOMItem[]): Promise<void> {
  const header = 'Comment,Designator,Footprint,LCSC Part #';
  const rows = bomItems.map(item => {
    const comment = csvEscape(item.comment);
    const designator = csvEscape(item.designator);
    const footprint = csvEscape(item.footprint);
    const lcsc = csvEscape(item.jlcPartNumber ?? '');
    return `${comment},${designator},${footprint},${lcsc}`;
  });

  const content = [header, ...rows].join('\n');

  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file('bom.csv'),
    filters: { 'CSV': ['csv'] },
    title: 'Export BOM CSV',
  });

  if (!uri) return;

  await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
  vscode.window.showInformationMessage(`BOM 已导出到 ${uri.fsPath}`);
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
