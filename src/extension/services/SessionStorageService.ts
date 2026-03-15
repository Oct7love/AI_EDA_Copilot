/**
 * 会话存储服务 — 读写 .ai-eda/ 目录下的会话文件
 *
 * 有工作区时存到 {workspace}/.ai-eda/sessions/
 * 无工作区时回退到 context.globalState
 */
import * as vscode from 'vscode';
import type { SessionData, SessionIndexEntry } from '@shared/types';

const DIR_NAME = '.ai-eda';
const SESSIONS_DIR = 'sessions';
const INDEX_FILE = 'sessions.json';
const GS_INDEX_KEY = 'sessions.index';
const GS_DATA_PREFIX = 'sessions.data.';

export class SessionStorageService {
  /** 串行化写入队列，防止并发写入冲突 */
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly context: vscode.ExtensionContext) {}

  /** 获取工作区 .ai-eda/ 根路径，无工作区返回 null */
  private getStorageRoot(): vscode.Uri | null {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return null;
    return vscode.Uri.joinPath(folders[0].uri, DIR_NAME);
  }

  /** 确保目录存在 */
  private async ensureDir(uri: vscode.Uri): Promise<void> {
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      await vscode.workspace.fs.createDirectory(uri);
    }
  }

  /** 安全读取 JSON 文件，不存在返回 null */
  private async readJson<T>(uri: vscode.Uri): Promise<T | null> {
    try {
      const data = await vscode.workspace.fs.readFile(uri);
      return JSON.parse(Buffer.from(data).toString('utf-8')) as T;
    } catch {
      return null;
    }
  }

  /** 写 JSON 文件 */
  private async writeJson(uri: vscode.Uri, data: unknown): Promise<void> {
    const content = JSON.stringify(data, null, 2);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
  }

  /** 串行化执行写操作 */
  private enqueueWrite(fn: () => Promise<void>): Promise<void> {
    this.writeQueue = this.writeQueue.then(fn, fn);
    return this.writeQueue;
  }

  // ─── 公开 API ─────────────────────────────────────────

  async listSessions(): Promise<SessionIndexEntry[]> {
    const root = this.getStorageRoot();
    if (root) {
      const indexUri = vscode.Uri.joinPath(root, INDEX_FILE);
      return (await this.readJson<SessionIndexEntry[]>(indexUri)) ?? [];
    }
    return this.context.globalState.get<SessionIndexEntry[]>(GS_INDEX_KEY, []);
  }

  async loadSession(id: string): Promise<SessionData | null> {
    const root = this.getStorageRoot();
    if (root) {
      const fileUri = vscode.Uri.joinPath(root, SESSIONS_DIR, `${id}.json`);
      return this.readJson<SessionData>(fileUri);
    }
    return this.context.globalState.get<SessionData | null>(`${GS_DATA_PREFIX}${id}`, null);
  }

  async saveSession(data: SessionData): Promise<void> {
    return this.enqueueWrite(async () => {
      const root = this.getStorageRoot();
      if (root) {
        const sessionsDir = vscode.Uri.joinPath(root, SESSIONS_DIR);
        await this.ensureDir(root);
        await this.ensureDir(sessionsDir);

        // 写会话文件
        const fileUri = vscode.Uri.joinPath(sessionsDir, `${data.id}.json`);
        await this.writeJson(fileUri, data);

        // 更新索引
        const indexUri = vscode.Uri.joinPath(root, INDEX_FILE);
        const index = (await this.readJson<SessionIndexEntry[]>(indexUri)) ?? [];
        const entry: SessionIndexEntry = {
          id: data.id,
          name: data.name,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        };
        const existing = index.findIndex((e) => e.id === data.id);
        if (existing >= 0) {
          index[existing] = entry;
        } else {
          index.unshift(entry);
        }
        await this.writeJson(indexUri, index);
      } else {
        // globalState 回退
        await this.context.globalState.update(`${GS_DATA_PREFIX}${data.id}`, data);
        const index = this.context.globalState.get<SessionIndexEntry[]>(GS_INDEX_KEY, []);
        const entry: SessionIndexEntry = {
          id: data.id,
          name: data.name,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        };
        const existing = index.findIndex((e) => e.id === data.id);
        if (existing >= 0) {
          index[existing] = entry;
        } else {
          index.unshift(entry);
        }
        await this.context.globalState.update(GS_INDEX_KEY, index);
      }
    });
  }

  async deleteSession(id: string): Promise<void> {
    return this.enqueueWrite(async () => {
      const root = this.getStorageRoot();
      if (root) {
        // 删除会话文件
        const fileUri = vscode.Uri.joinPath(root, SESSIONS_DIR, `${id}.json`);
        try { await vscode.workspace.fs.delete(fileUri); } catch { /* 文件不存在可忽略 */ }

        // 更新索引
        const indexUri = vscode.Uri.joinPath(root, INDEX_FILE);
        const index = (await this.readJson<SessionIndexEntry[]>(indexUri)) ?? [];
        const filtered = index.filter((e) => e.id !== id);
        await this.writeJson(indexUri, filtered);
      } else {
        await this.context.globalState.update(`${GS_DATA_PREFIX}${id}`, undefined);
        const index = this.context.globalState.get<SessionIndexEntry[]>(GS_INDEX_KEY, []);
        await this.context.globalState.update(GS_INDEX_KEY, index.filter((e) => e.id !== id));
      }
    });
  }

  async renameSession(id: string, newName: string): Promise<void> {
    const data = await this.loadSession(id);
    if (data) {
      data.name = newName;
      data.updatedAt = new Date().toISOString();
      await this.saveSession(data);
    }
  }
}
