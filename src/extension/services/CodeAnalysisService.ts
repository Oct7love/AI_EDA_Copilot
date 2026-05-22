/**
 * 代码分析编排服务 — 遍历文件夹收集 Arduino 源码 → 调 arduinoAnalyzer。
 * 文件 I/O 与上限控制在此；纯提取逻辑在 analyzers/arduinoAnalyzer.ts。
 */
import * as vscode from 'vscode';
import type { CodeAnalysisResult } from '@shared/types';
import { analyzeArduinoCode, type SourceFile } from '../analyzers/arduinoAnalyzer';

/** Arduino 源码扩展名 */
const CODE_EXTENSIONS = ['.ino', '.c', '.cpp', '.cc', '.h', '.hpp'];
/** 遍历时跳过的目录 */
const SKIP_DIRS = new Set(['.git', 'node_modules', 'build', '.pio', 'out', 'dist']);
/** 扫描上限 */
const MAX_FILES = 200;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;

/** 文件夹内无 Arduino 源码 */
export class NoArduinoFilesError extends Error {
  constructor() {
    super('未在该文件夹找到 Arduino 代码文件（.ino/.c/.cpp/.h）');
    this.name = 'NoArduinoFilesError';
  }
}

export class CodeAnalysisService {
  /** 遍历文件夹 → 收集源码 → 分析；无源码时抛 NoArduinoFilesError；不可读的目录与文件会被静默跳过 */
  async analyze(folderUri: vscode.Uri): Promise<CodeAnalysisResult> {
    const files: SourceFile[] = [];
    let totalBytes = 0;
    // truncated 表示「确有文件因上限被跳过」：仅在 cap 触发的提前返回时置 true。
    // 最后一个文件超限但其后无条目 = 扫描完整，truncated 保持 false 是正确的。
    let truncated = false;

    const walk = async (dir: vscode.Uri): Promise<void> => {
      if (files.length >= MAX_FILES || totalBytes >= MAX_TOTAL_BYTES) {
        truncated = true;
        return;
      }
      let entries: [string, vscode.FileType][];
      try {
        entries = await vscode.workspace.fs.readDirectory(dir);
      } catch {
        return; // 不可读目录跳过
      }
      for (const [name, type] of entries) {
        if (files.length >= MAX_FILES || totalBytes >= MAX_TOTAL_BYTES) {
          truncated = true;
          return;
        }
        const child = vscode.Uri.joinPath(dir, name);
        if (type === vscode.FileType.Directory) {
          if (!SKIP_DIRS.has(name)) await walk(child);
        } else if (type === vscode.FileType.File) {
          const dot = name.lastIndexOf('.');
          const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
          if (!CODE_EXTENSIONS.includes(ext)) continue;
          try {
            const bytes = await vscode.workspace.fs.readFile(child);
            totalBytes += bytes.byteLength;
            files.push({ path: child.fsPath, content: Buffer.from(bytes).toString('utf-8') });
          } catch {
            // 单文件不可读 → 跳过续扫
          }
        }
      }
    };

    await walk(folderUri);

    if (files.length === 0) {
      throw new NoArduinoFilesError();
    }

    const analysis = analyzeArduinoCode(files);
    return { ...analysis, scannedFiles: files.length, truncated };
  }
}
