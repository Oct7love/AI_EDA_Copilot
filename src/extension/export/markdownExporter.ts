/**
 * Markdown 全报告导出
 * 将所有产物（Overview → Requirements → BOM → Schematic → PCB → Procurement → DesignReview）
 * 输出为一个结构化 Markdown 文件
 */
import * as vscode from 'vscode';
import type { SessionArtifacts } from '@shared/types';
import { generateExportFilename } from './exportUtils';

/** 导出完整报告为 Markdown 文件 */
export async function exportMarkdown(artifacts: SessionArtifacts, projectName: string): Promise<void> {
  const content = buildMarkdownReport(artifacts, projectName);
  const filename = generateExportFilename(projectName, 'report', 'md');

  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(filename),
    filters: { 'Markdown': ['md'] },
    title: 'Export Report Markdown',
  });

  if (!uri) return;

  await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
  vscode.window.showInformationMessage(`报告已导出到 ${uri.fsPath}`);
}

/** 纯函数：构建 Markdown 报告内容（可独立测试） */
export function buildMarkdownReport(artifacts: SessionArtifacts, projectName: string): string {
  const lines: string[] = [];
  const now = new Date().toISOString();

  lines.push(`# ${projectName || 'Untitled'} - AI EDA Design Report`);
  lines.push(`> Generated: ${now}`);
  lines.push('');

  // §1 Overview
  buildOverviewSection(lines, artifacts);

  // §2 Requirements
  buildRequirementsSection(lines, artifacts);

  // §3 BOM
  buildBomSection(lines, artifacts);

  // §4 Schematic Intent
  buildSchematicSection(lines, artifacts);

  // §5 PCB Layout Plan
  buildPcbSection(lines, artifacts);

  // §6 Procurement
  buildProcurementSection(lines, artifacts);

  // §7 Design Review
  buildDesignReviewSection(lines, artifacts);

  return lines.join('\n');
}

function buildOverviewSection(lines: string[], a: SessionArtifacts): void {
  lines.push('## 1. Overview');
  lines.push('');
  if (!a.overview) {
    lines.push('_No overview data available._');
    lines.push('');
    return;
  }
  lines.push(`**Summary:** ${a.overview.projectSummary}`);
  lines.push(`**Readiness:** ${a.overview.readinessScore}%`);
  lines.push('');

  if (a.overview.modules.length > 0) {
    lines.push('### Functional Modules');
    for (const m of a.overview.modules) {
      lines.push(`- **${m.name}**: ${m.description}`);
    }
    lines.push('');
  }

  if (a.overview.keyComponents.length > 0) {
    lines.push('### Key Components');
    for (const c of a.overview.keyComponents) {
      lines.push(`- ${c}`);
    }
    lines.push('');
  }

  if (a.overview.openQuestions.length > 0) {
    lines.push('### Open Questions');
    for (const q of a.overview.openQuestions) {
      const resolved = q.resolved ? ' (resolved)' : '';
      lines.push(`- [${q.priority}]${resolved} ${q.question}`);
    }
    lines.push('');
  }

  if (a.overview.risks.length > 0) {
    lines.push('### Risks');
    for (const r of a.overview.risks) {
      lines.push(`- ${r}`);
    }
    lines.push('');
  }
}

function buildRequirementsSection(lines: string[], a: SessionArtifacts): void {
  lines.push('## 2. Requirements');
  lines.push('');
  if (!a.requirementSpec) {
    lines.push('_No requirements data available._');
    lines.push('');
    return;
  }

  const spec = a.requirementSpec;
  const coreFields = [
    ['Project Name', spec.projectName],
    ['Description', spec.projectDescription],
    ['MCU', spec.mcu],
    ['Power', spec.power],
    ['Communication', spec.communication],
    ['Display', spec.display],
    ['Sensors', spec.sensors],
  ] as const;

  lines.push('### Core Requirements');
  lines.push('| Field | Value | Source | Confidence |');
  lines.push('|-------|-------|--------|------------|');
  for (const [label, field] of coreFields) {
    const val = formatFieldValue(field);
    lines.push(`| ${label} | ${val} | ${field.source} | ${Math.round(field.confidence * 100)}% |`);
  }
  lines.push('');

  const extFields = [
    ['Cost Range', spec.costRange],
    ['Size Limit', spec.sizeLimit],
    ['Production Intent', spec.productionIntent],
    ['Power Consumption', spec.powerConsumption],
    ['Precision', spec.precision],
  ] as const;

  const hasExtended = extFields.some(([, f]) => f.value !== null);
  if (hasExtended) {
    lines.push('### Extended Requirements');
    lines.push('| Field | Value | Source | Confidence |');
    lines.push('|-------|-------|--------|------------|');
    for (const [label, field] of extFields) {
      if (field.value === null) continue;
      const val = formatFieldValue(field);
      lines.push(`| ${label} | ${val} | ${field.source} | ${Math.round(field.confidence * 100)}% |`);
    }
    lines.push('');
  }

  if (spec.functionalModules.length > 0) {
    lines.push('### Functional Modules');
    for (const m of spec.functionalModules) {
      lines.push(`- **${m.name}**: ${m.description}`);
    }
    lines.push('');
  }
}

function buildBomSection(lines: string[], a: SessionArtifacts): void {
  lines.push('## 3. Bill of Materials');
  lines.push('');
  if (a.bomItems.length === 0) {
    lines.push('_No BOM data available._');
    lines.push('');
    return;
  }

  lines.push(`Total: ${a.bomItems.length} parts, ${a.bomItems.filter(b => b.jlcPartNumber).length} matched`);
  lines.push('');
  lines.push('| # | Designator | Comment | Footprint | Qty | LCSC Part # |');
  lines.push('|---|-----------|---------|-----------|-----|-------------|');
  a.bomItems.forEach((item, i) => {
    lines.push(`| ${i + 1} | ${item.designator} | ${item.comment} | ${item.footprint} | ${item.quantity} | ${item.jlcPartNumber ?? '—'} |`);
  });
  lines.push('');
}

function buildSchematicSection(lines: string[], a: SessionArtifacts): void {
  lines.push('## 4. Schematic Intent');
  lines.push('');
  if (!a.schematicIntent) {
    lines.push('_No schematic data available._');
    lines.push('');
    return;
  }

  const s = a.schematicIntent;
  lines.push(`Modules: ${s.modules.length} | Connections: ${s.connections.length} | Pins: ${s.pinTable.length}`);
  lines.push('');

  if (s.modules.length > 0) {
    lines.push('### Modules');
    for (const m of s.modules) {
      lines.push(`- **${m.name}**: ${m.description}`);
    }
    lines.push('');
  }

  if (s.connections.length > 0) {
    lines.push('### Connections');
    for (const c of s.connections) {
      lines.push(`- ${c.from.designator}.${c.from.pin} → ${c.to.designator}.${c.to.pin} (${c.netName})`);
    }
    lines.push('');
  }
}

function buildPcbSection(lines: string[], a: SessionArtifacts): void {
  lines.push('## 5. PCB Layout Plan');
  lines.push('');
  if (!a.pcbLayoutPlan) {
    lines.push('_No PCB layout data available._');
    lines.push('');
    return;
  }

  const p = a.pcbLayoutPlan;
  lines.push(`Board: ${p.boardSize.width} x ${p.boardSize.height} mm | Layers: ${p.layerCount}`);
  lines.push('');

  if (p.zones.length > 0) {
    lines.push('### Zones');
    for (const z of p.zones) {
      lines.push(`- **${z.name}** (${z.relativePosition}): ${z.purpose}`);
    }
    lines.push('');
  }

  if (p.constraints.length > 0) {
    lines.push('### Constraints');
    for (const c of p.constraints) {
      lines.push(`- [${c.type}] ${c.description}`);
    }
    lines.push('');
  }
}

function buildProcurementSection(lines: string[], a: SessionArtifacts): void {
  lines.push('## 6. Procurement');
  lines.push('');
  if (a.procurementItems.length === 0) {
    lines.push('_No procurement data available._');
    lines.push('');
    return;
  }

  lines.push('| Designator | Compatibility | JLC Part # | Stock | Match Type |');
  lines.push('|-----------|--------------|------------|-------|------------|');
  for (const item of a.procurementItems) {
    lines.push(`| ${item.designator} | ${item.jlcCompatibility} | ${item.jlcPartNumber ?? '—'} | ${item.jlcStock ?? '—'} | ${item.matchType} |`);
  }
  lines.push('');
}

function buildDesignReviewSection(lines: string[], a: SessionArtifacts): void {
  lines.push('## 7. Design Review');
  lines.push('');
  if (!a.designReviewResult) {
    lines.push('_No design review data available._');
    lines.push('');
    return;
  }

  const r = a.designReviewResult;
  lines.push(`Summary: ${r.summary.criticalCount} critical, ${r.summary.warningCount} warnings, ${r.summary.infoCount} info`);
  lines.push('');

  for (const severity of ['critical', 'warning', 'info'] as const) {
    const findings = r.findings.filter(f => f.severity === severity);
    if (findings.length === 0) continue;
    lines.push(`### ${severity.charAt(0).toUpperCase() + severity.slice(1)} Findings`);
    for (const f of findings) {
      lines.push(`- **${f.title}**: ${f.description}`);
      if (f.suggestion) lines.push(`  - Suggestion: ${f.suggestion}`);
    }
    lines.push('');
  }
}

function formatFieldValue(field: { value: unknown }): string {
  if (field.value === null || field.value === undefined) return '—';
  if (Array.isArray(field.value)) return field.value.join(', ');
  return String(field.value);
}
