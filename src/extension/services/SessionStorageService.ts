/**
 * 会话存储服务 — 读写 .ai-eda/ 目录下的会话文件
 *
 * 有工作区时存到 {workspace}/.ai-eda/sessions/
 * 无工作区时回退到 context.globalState
 */
import * as vscode from 'vscode';
import type { SessionData, SessionIndexEntry } from '@shared/types';
import { migrateSessionVersions } from './versionStore';

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

  /** 构造同目录下的 `${name}.tmp` 兄弟 URI（用 joinPath 派生父目录，避免依赖 Uri.with） */
  private tmpSibling(uri: vscode.Uri): vscode.Uri {
    const path = uri.path;
    const slash = path.lastIndexOf('/');
    const dir = slash >= 0 ? path.slice(0, slash) : '';
    const name = slash >= 0 ? path.slice(slash + 1) : path;
    return vscode.Uri.joinPath(vscode.Uri.file(dir), `${name}.tmp`);
  }

  /**
   * 原子写 JSON 文件：先写临时文件 `${target}.tmp`，再 rename 覆盖到目标。
   * 崩溃发生在写 tmp 阶段时，原目标文件保持完整（不会出现被截断的半文件）。
   * 防御性兜底：若 rename 不被支持/抛错（边缘环境），回退为直接 writeFile 目标，
   * 并尽力删除残留的 tmp 文件，避免静默遗留孤儿临时文件。
   */
  private async writeJson(uri: vscode.Uri, data: unknown): Promise<void> {
    const content = Buffer.from(JSON.stringify(data, null, 2), 'utf-8');
    const tmpUri = this.tmpSibling(uri);

    // 1) 先写临时文件（若此步失败，原目标文件不受影响）
    await vscode.workspace.fs.writeFile(tmpUri, content);

    // 2) 原子 rename 覆盖目标；rename 不可用时回退到直接写目标
    try {
      await vscode.workspace.fs.rename(tmpUri, uri, { overwrite: true });
    } catch {
      // rename 失败兜底：直接写目标（恢复 Phase 1-3 旧行为），并尽力清理 tmp
      await vscode.workspace.fs.writeFile(uri, content);
      try { await vscode.workspace.fs.delete(tmpUri); } catch { /* tmp 可能已不存在，忽略 */ }
    }
  }

  /**
   * 串行化执行写操作。
   * 用 catch 吸收前序失败（防止队列卡死/前序错误被重放），再链上 fn；
   * 返回的 promise 反映 fn 自身的成败，故调用方仍能感知本次写入错误。
   */
  private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.catch(() => {}).then(fn);
    // 队列尾部只关心“完成”，不关心 fn 的具体返回值/错误（错误由 run 传给调用方）
    this.writeQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  // ─── 公开 API ─────────────────────────────────────────

  /** 判断会话文件是否存在 */
  private async fileExists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  async listSessions(): Promise<SessionIndexEntry[]> {
    const root = this.getStorageRoot();
    if (root) {
      const indexUri = vscode.Uri.joinPath(root, INDEX_FILE);
      const index = (await this.readJson<SessionIndexEntry[]>(indexUri)) ?? [];
      // 对账：索引条目指向的会话文件若已不存在，则从返回列表中剔除（仅过滤，不改盘）。
      // 保守保留“有文件但不在索引”的孤儿文件，不做任何删除。
      const checks = await Promise.all(
        index.map(async (e) =>
          (await this.fileExists(
            vscode.Uri.joinPath(root, SESSIONS_DIR, `${e.id}.json`),
          ))
            ? e
            : null,
        ),
      );
      return checks.filter((e): e is SessionIndexEntry => e !== null);
    }
    return this.context.globalState.get<SessionIndexEntry[]>(GS_INDEX_KEY, []);
  }

  /** 规整旧会话：补齐 versions 字段（仅内存，落盘交由下次正常写入） */
  private normalize(data: SessionData | null): SessionData | null {
    if (!data) return null;
    // globalState 返回引用，原地赋值安全：迁移仅补齐缺失的 versions，下次 saveSession 会完整序列化新对象
    data.versions = migrateSessionVersions(data);
    return data;
  }

  async loadSession(id: string): Promise<SessionData | null> {
    const root = this.getStorageRoot();
    if (root) {
      const fileUri = vscode.Uri.joinPath(root, SESSIONS_DIR, `${id}.json`);
      return this.normalize(await this.readJson<SessionData>(fileUri));
    }
    return this.normalize(
      this.context.globalState.get<SessionData | null>(`${GS_DATA_PREFIX}${id}`, null),
    );
  }

  async saveSession(data: SessionData): Promise<void> {
    return this.enqueueWrite(() => this.writeSessionData(data));
  }

  /** 实际落盘逻辑（不入队）—— 仅供已串行化的上下文调用 */
  private async writeSessionData(data: SessionData): Promise<void> {
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
  }

  async deleteSession(id: string): Promise<void> {
    return this.enqueueWrite(async () => {
      const root = this.getStorageRoot();
      if (root) {
        // 先更新索引（移除指针），再删文件。
        // 这样中途失败只会留下一个可回收的孤儿文件，而非悬空索引指针。
        const indexUri = vscode.Uri.joinPath(root, INDEX_FILE);
        const index = (await this.readJson<SessionIndexEntry[]>(indexUri)) ?? [];
        const filtered = index.filter((e) => e.id !== id);
        await this.writeJson(indexUri, filtered);

        // 删除会话文件（不存在可忽略）
        const fileUri = vscode.Uri.joinPath(root, SESSIONS_DIR, `${id}.json`);
        try { await vscode.workspace.fs.delete(fileUri); } catch { /* 文件不存在可忽略 */ }
      } else {
        await this.context.globalState.update(`${GS_DATA_PREFIX}${id}`, undefined);
        const index = this.context.globalState.get<SessionIndexEntry[]>(GS_INDEX_KEY, []);
        await this.context.globalState.update(GS_INDEX_KEY, index.filter((e) => e.id !== id));
      }
    });
  }

  async renameSession(id: string, newName: string): Promise<void> {
    // 整个 读-改-写 放进同一个队列操作里原子执行，
    // 避免与并发的 autosave/snapshot 发生丢失更新（lost-update）竞态。
    await this.enqueueWrite(async () => {
      const data = await this.loadSession(id);
      if (!data) return;
      data.name = newName;
      data.updatedAt = new Date().toISOString();
      await this.writeSessionData(data);
    });
  }

  // ─── 恢复 / 自愈 ──────────────────────────────────────

  /**
   * 列出 sessions/ 目录下的会话 id（仅 *.json，排除 *.tmp）。
   * globalState 模式下从 GS_DATA 键派生。
   */
  private async listSessionFileIds(): Promise<string[]> {
    const root = this.getStorageRoot();
    if (!root) {
      // globalState：会话数据键形如 `${GS_DATA_PREFIX}${id}`，但内存 state 无法枚举键，
      // 退而从索引派生（GS 模式下索引即真相源），保持实现简单。
      const index = this.context.globalState.get<SessionIndexEntry[]>(GS_INDEX_KEY, []);
      return index.map((e) => e.id);
    }
    const sessionsDir = vscode.Uri.joinPath(root, SESSIONS_DIR);
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(sessionsDir);
    } catch {
      return []; // 目录不存在 = 无会话文件
    }
    const ids: string[] = [];
    for (const [name, type] of entries) {
      if (type !== vscode.FileType.File) continue;
      if (!name.endsWith('.json') || name.endsWith('.tmp')) continue;
      ids.push(name.slice(0, -'.json'.length));
    }
    return ids;
  }

  /**
   * 找出"有会话文件但不在索引中"的孤儿会话 id（file-mode）。
   * 仅检测，不删除、不改盘。globalState 模式下恒返回 []（索引即真相源）。
   */
  async findOrphanSessions(): Promise<string[]> {
    const root = this.getStorageRoot();
    if (!root) return [];
    const indexUri = vscode.Uri.joinPath(root, INDEX_FILE);
    const index = (await this.readJson<SessionIndexEntry[]>(indexUri)) ?? [];
    const indexed = new Set(index.map((e) => e.id));
    const fileIds = await this.listSessionFileIds();
    return fileIds.filter((id) => !indexed.has(id));
  }

  /**
   * 重建索引：扫描 sessions/ 下所有会话文件，从可解析者重建 sessions.json。
   * - 损坏/无法解析的文件被跳过（计入 skipped），绝不删除任何文件。
   * - 孤儿文件因此被折回索引（恢复），无数据丢失。
   * - 重建后的索引用 temp+rename 原子写入。
   * globalState 模式下为简易实现：直接返回当前索引规模、skipped 恒 0。
   */
  async rebuildIndex(): Promise<{ rebuilt: number; skipped: number }> {
    return this.enqueueWrite(async () => {
      const root = this.getStorageRoot();
      if (!root) {
        // GS 模式：索引即真相源，无独立文件可扫描；保持简单，视现有条目为已重建。
        const index = this.context.globalState.get<SessionIndexEntry[]>(GS_INDEX_KEY, []);
        return { rebuilt: index.length, skipped: 0 };
      }

      const fileIds = await this.listSessionFileIds();
      const sessionsDir = vscode.Uri.joinPath(root, SESSIONS_DIR);
      const rebuiltEntries: SessionIndexEntry[] = [];
      let skipped = 0;

      for (const id of fileIds) {
        const fileUri = vscode.Uri.joinPath(sessionsDir, `${id}.json`);
        // readJson 损坏即返回 null（不抛），单文件损坏不影响整体重建
        const data = await this.readJson<SessionData>(fileUri);
        if (!data || typeof data.id !== 'string') {
          skipped += 1;
          continue;
        }
        rebuiltEntries.push({
          id: data.id,
          name: data.name,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        });
      }

      // 越新越靠前（与 saveSession 的 unshift 约定一致）
      rebuiltEntries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));

      const indexUri = vscode.Uri.joinPath(root, INDEX_FILE);
      await this.ensureDir(root);
      await this.writeJson(indexUri, rebuiltEntries);

      return { rebuilt: rebuiltEntries.length, skipped };
    });
  }
}
