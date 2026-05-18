/**
 * JSON 全报告导出
 * 将所有产物导出为格式化的 JSON 文件
 */
import * as vscode from 'vscode';
import type { SessionArtifacts } from '@shared/types';
import { generateExportFilename } from './exportUtils';

/** 导出完整报告为 JSON 文件 */
export async function exportJson(artifacts: SessionArtifacts, projectName: string): Promise<void> {
  const content = buildJsonReport(artifacts, projectName);
  const filename = generateExportFilename(projectName, 'report', 'json');

  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(filename),
    filters: { 'JSON': ['json'] },
    title: 'Export Report JSON',
  });

  if (!uri) return;

  await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
  vscode.window.showInformationMessage(`报告已导出到 ${uri.fsPath}`);
}

/** 纯函数：构建 JSON 报告内容（可独立测试） */
export function buildJsonReport(artifacts: SessionArtifacts, projectName: string): string {
  const report = {
    projectName: projectName || 'Untitled',
    generatedAt: new Date().toISOString(),
    artifacts: {
      requirementSpec: artifacts.requirementSpec,
      overview: artifacts.overview,
      bomItems: artifacts.bomItems,
      procurementItems: artifacts.procurementItems,
      schematicIntent: artifacts.schematicIntent,
      pcbLayoutPlan: artifacts.pcbLayoutPlan,
      designReviewResult: artifacts.designReviewResult,
    },
  };

  return JSON.stringify(report, null, 2);
}
