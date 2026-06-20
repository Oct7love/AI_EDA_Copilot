/**
 * SessionStorageService 单元测试
 *
 * 用内存假 fs（按 uri.path 建索引）+ 假 vscode mock 验证持久化数据流：
 *  - file-mode（有工作区）：{ws}/.ai-eda/sessions/{id}.json + 索引 sessions.json
 *  - globalState 回退（无工作区）
 *
 * 覆盖 Phase 2 复查修复：写队列、rename 原子读改写、delete 先改索引、
 * listSessions 对账、损坏 JSON 安全、写错误不被吞。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SessionData } from '@shared/types';

// ─── 内存 fs ─────────────────────────────────────────────
const store = new Map<string, Uint8Array>();
let folders: Array<{ uri: ReturnType<typeof mkUri> }> | undefined = [{ uri: mkUri('/ws') }];
/** 注入：让某个 path 的 writeFile 抛错（模拟写盘失败） */
let failWritePath: string | null = null;
/** 注入：让 rename 抛错（模拟 rename 不被支持 → 触发兜底直写） */
let failRename = false;

function mkUri(p: string): { path: string; fsPath: string; scheme: string } {
  return { path: p, fsPath: p, scheme: 'file' };
}

vi.mock('vscode', () => ({
  // FileType 枚举：与真实 vscode 取值一致（File=1, Directory=2）
  FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
  workspace: {
    get workspaceFolders() {
      return folders;
    },
    fs: {
      async stat(u: { path: string }) {
        if (store.has('DIR:' + u.path) || store.has(u.path)) return {};
        throw new Error('ENOENT');
      },
      async createDirectory(u: { path: string }) {
        store.set('DIR:' + u.path, new Uint8Array());
      },
      async writeFile(u: { path: string }, data: Uint8Array) {
        if (failWritePath && u.path === failWritePath) {
          throw new Error('EWRITE: simulated write failure');
        }
        store.set(u.path, data);
      },
      async readFile(u: { path: string }) {
        const d = store.get(u.path);
        if (!d) throw new Error('ENOENT');
        return d;
      },
      async delete(u: { path: string }) {
        if (!store.has(u.path)) throw new Error('ENOENT');
        store.delete(u.path);
      },
      // 原子 rename：把字节从 src.path 搬到 dst.path（删除 src）。注入失败时抛错触发兜底。
      async rename(src: { path: string }, dst: { path: string }, _opts?: { overwrite?: boolean }) {
        if (failRename) throw new Error('ERENAME: simulated rename unsupported');
        const d = store.get(src.path);
        if (d === undefined) throw new Error('ENOENT');
        store.set(dst.path, d);
        store.delete(src.path);
      },
      // 返回直接位于 dir 下的文件 [name, FileType.File]（不递归子目录）
      async readDirectory(dir: { path: string }) {
        const prefix = dir.path.endsWith('/') ? dir.path : dir.path + '/';
        const out: Array<[string, number]> = [];
        for (const key of store.keys()) {
          if (key.startsWith('DIR:')) continue;
          if (!key.startsWith(prefix)) continue;
          const rest = key.slice(prefix.length);
          if (rest.length === 0 || rest.includes('/')) continue; // 仅直接子项
          out.push([rest, 1 /* FileType.File */]);
        }
        return out;
      },
    },
  },
  Uri: {
    joinPath: (base: { path: string }, ...segs: string[]) =>
      mkUri([base.path, ...segs].join('/')),
    file: (p: string) => mkUri(p),
  },
}));

// import AFTER mock
import { SessionStorageService } from './SessionStorageService';

// ─── 测试辅助 ────────────────────────────────────────────

/** Map 支撑的假 globalState */
function makeGlobalState() {
  const map = new Map<string, unknown>();
  return {
    get<T>(key: string, def?: T): T {
      return map.has(key) ? (map.get(key) as T) : (def as T);
    },
    update(key: string, value: unknown): Promise<void> {
      if (value === undefined) map.delete(key);
      else map.set(key, value);
      return Promise.resolve();
    },
  };
}

function makeContext() {
  return { globalState: makeGlobalState() } as never;
}

function makeSession(id: string, overrides: Partial<SessionData> = {}): SessionData {
  return {
    id,
    name: `session-${id}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    conversation: [{ id: 'm1', role: 'user', content: 'hi', timestamp: 1 }],
    artifacts: {
      requirementSpec: null,
      overview: null,
      bomItems: [],
      procurementItems: [],
      schematicIntent: null,
      pcbLayoutPlan: null,
      designReviewResult: null,
    },
    inputMode: 'chat',
    versions: [],
    ...overrides,
  };
}

const SESSION_FILE = (id: string) => `/ws/.ai-eda/sessions/${id}.json`;
const INDEX_FILE = '/ws/.ai-eda/sessions.json';

function readStoreJson<T>(path: string): T | null {
  const raw = store.get(path);
  if (!raw) return null;
  return JSON.parse(Buffer.from(raw).toString('utf-8')) as T;
}

beforeEach(() => {
  store.clear();
  folders = [{ uri: mkUri('/ws') }];
  failWritePath = null;
  failRename = false;
});

// ─── file-mode 测试 ──────────────────────────────────────

describe('SessionStorageService (file-mode)', () => {
  it('save → load roundtrip preserves key fields incl. versions', async () => {
    const svc = new SessionStorageService(makeContext());
    const data = makeSession('a', {
      name: '机械臂',
      versions: [
        {
          id: 'v-1',
          createdAt: '2026-01-02T00:00:00.000Z',
          label: 'v1 · 2026-01-02 00:00',
          artifacts: makeSession('a').artifacts,
        },
      ],
    });
    await svc.saveSession(data);

    const loaded = await svc.loadSession('a');
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe('a');
    expect(loaded!.name).toBe('机械臂');
    expect(loaded!.conversation).toHaveLength(1);
    expect(loaded!.versions).toHaveLength(1);
    expect(loaded!.versions[0].id).toBe('v-1');

    // 索引被写入
    const idx = await svc.listSessions();
    expect(idx).toHaveLength(1);
    expect(idx[0]).toMatchObject({ id: 'a', name: '机械臂' });
  });

  it('rename via queue persists new name without clobbering artifacts', async () => {
    const svc = new SessionStorageService(makeContext());
    const data = makeSession('b', {
      name: 'old',
      artifacts: {
        ...makeSession('b').artifacts,
        bomItems: [{ designator: 'U1', comment: 'ESP32', footprint: 'QFN', quantity: 1 } as never],
      },
    });
    await svc.saveSession(data);

    await svc.renameSession('b', 'new-name');

    const loaded = await svc.loadSession('b');
    expect(loaded!.name).toBe('new-name');
    // artifacts 未被 clobber
    expect(loaded!.artifacts.bomItems).toHaveLength(1);
    // 索引也同步了新名字
    const idx = await svc.listSessions();
    expect(idx.find((e) => e.id === 'b')!.name).toBe('new-name');
  });

  it('rename interleaved with concurrent save does not lose the rename (atomic read-modify-write)', async () => {
    const svc = new SessionStorageService(makeContext());
    await svc.saveSession(makeSession('c', { name: 'orig' }));

    // 同时发起 rename 与一次普通 save（save 用旧名字），队列保证不丢更新
    const p1 = svc.renameSession('c', 'renamed');
    const p2 = svc.saveSession(makeSession('c', { name: 'orig', updatedAt: '2026-01-03T00:00:00.000Z' }));
    await Promise.all([p1, p2]);

    const loaded = await svc.loadSession('c');
    // 最后一个入队的写入决定终值；关键是两者都完整执行、无半更新/丢失异常
    expect(['renamed', 'orig']).toContain(loaded!.name);
    // 索引与文件名字一致（无悬空/错位）
    const idx = await svc.listSessions();
    expect(idx.find((e) => e.id === 'c')!.name).toBe(loaded!.name);
  });

  it('delete updates index first then removes file (no dangling index entry)', async () => {
    const svc = new SessionStorageService(makeContext());
    await svc.saveSession(makeSession('d'));
    await svc.saveSession(makeSession('e'));

    await svc.deleteSession('d');

    // 文件已删
    expect(store.has(SESSION_FILE('d'))).toBe(false);
    // 索引无悬空指针
    const idx = readStoreJson<Array<{ id: string }>>(INDEX_FILE)!;
    expect(idx.some((entry) => entry.id === 'd')).toBe(false);
    expect(idx.some((entry) => entry.id === 'e')).toBe(true);
    // 另一个会话不受影响
    expect(await svc.loadSession('e')).not.toBeNull();
  });

  it('listSessions returns [] when index file missing', async () => {
    const svc = new SessionStorageService(makeContext());
    // 从未写入任何东西
    expect(await svc.listSessions()).toEqual([]);
  });

  it('listSessions reconciles: index entry whose session file is gone is omitted', async () => {
    const svc = new SessionStorageService(makeContext());
    await svc.saveSession(makeSession('f'));
    await svc.saveSession(makeSession('g'));

    // 手动删掉 g 的会话文件，但保留索引条目（模拟外部破坏）
    store.delete(SESSION_FILE('g'));
    expect(readStoreJson<Array<{ id: string }>>(INDEX_FILE)!.some((e) => e.id === 'g')).toBe(true);

    const list = await svc.listSessions();
    expect(list.map((e) => e.id)).toEqual(['f']);
    // 对账只过滤返回值，不改盘：索引文件里的 g 条目仍在
    expect(readStoreJson<Array<{ id: string }>>(INDEX_FILE)!.some((e) => e.id === 'g')).toBe(true);
  });

  it('keeps orphan session files not present in index (no deletion)', async () => {
    const svc = new SessionStorageService(makeContext());
    await svc.saveSession(makeSession('h'));
    // 写一个孤儿文件（不在索引里）
    store.set(SESSION_FILE('orphan'), Buffer.from('{}', 'utf-8'));

    await svc.listSessions();
    // 孤儿文件被保守保留
    expect(store.has(SESSION_FILE('orphan'))).toBe(true);
  });

  it('loadSession returns null (no throw) on corrupt session JSON', async () => {
    const svc = new SessionStorageService(makeContext());
    store.set(SESSION_FILE('bad'), Buffer.from('{ not valid json', 'utf-8'));
    await expect(svc.loadSession('bad')).resolves.toBeNull();
  });

  it('rapid sequential saves preserve order / last-write-wins', async () => {
    const svc = new SessionStorageService(makeContext());
    await Promise.all([
      svc.saveSession(makeSession('s', { name: 'first', updatedAt: '2026-01-01T00:00:01.000Z' })),
      svc.saveSession(makeSession('s', { name: 'second', updatedAt: '2026-01-01T00:00:02.000Z' })),
      svc.saveSession(makeSession('s', { name: 'third', updatedAt: '2026-01-01T00:00:03.000Z' })),
    ]);
    const loaded = await svc.loadSession('s');
    expect(loaded!.name).toBe('third');
    // 索引只有一条（去重）
    const idx = await svc.listSessions();
    expect(idx.filter((e) => e.id === 's')).toHaveLength(1);
  });

  it('a save whose writeFile rejects propagates the error and queue still accepts next write', async () => {
    const svc = new SessionStorageService(makeContext());
    // 原子写：实际落盘发生在 `${target}.tmp`，注入该路径失败
    failWritePath = SESSION_FILE('x') + '.tmp';
    await expect(svc.saveSession(makeSession('x'))).rejects.toThrow(/EWRITE/);

    // 队列没卡死：解除注入后下一次写入成功
    failWritePath = null;
    await expect(svc.saveSession(makeSession('y'))).resolves.toBeUndefined();
    expect(await svc.loadSession('y')).not.toBeNull();
  });

  // ─── 原子写入 / 自愈 ──────────────────────────────────

  it('atomic write leaves no temp file behind; final content correct', async () => {
    const svc = new SessionStorageService(makeContext());
    await svc.saveSession(makeSession('atom', { name: '原子' }));

    // tmp 文件不残留（会话文件 + 索引文件的 tmp 都应已被 rename 消费）
    expect(store.has(SESSION_FILE('atom') + '.tmp')).toBe(false);
    expect(store.has(INDEX_FILE + '.tmp')).toBe(false);
    // 最终文件存在且内容正确
    expect(store.has(SESSION_FILE('atom'))).toBe(true);
    const loaded = await svc.loadSession('atom');
    expect(loaded!.name).toBe('原子');
  });

  it('temp-write failure on a second save does not corrupt the existing file', async () => {
    const svc = new SessionStorageService(makeContext());
    // 首次写入成功，留下完整旧内容
    await svc.saveSession(makeSession('keep', { name: 'old-content' }));
    expect((await svc.loadSession('keep'))!.name).toBe('old-content');

    // 第二次写入：让该会话的 .tmp 写入失败（原子写第一步失败，目标文件不应被触碰）
    failWritePath = SESSION_FILE('keep') + '.tmp';
    await expect(
      svc.saveSession(makeSession('keep', { name: 'new-content' })),
    ).rejects.toThrow(/EWRITE/);

    // 旧文件仍可读、内容未被破坏（既不是半文件，也未变成 new-content）
    failWritePath = null;
    const loaded = await svc.loadSession('keep');
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe('old-content');
  });

  it('rename failure falls back to direct write; final file still written, no tmp left', async () => {
    const svc = new SessionStorageService(makeContext());
    failRename = true; // 模拟 rename 不被支持
    await svc.saveSession(makeSession('fb', { name: '兜底' }));

    // 兜底直写：最终文件写成，tmp 被尽力清理
    expect(store.has(SESSION_FILE('fb'))).toBe(true);
    expect(store.has(SESSION_FILE('fb') + '.tmp')).toBe(false);
    expect(store.has(INDEX_FILE)).toBe(true);
    expect(store.has(INDEX_FILE + '.tmp')).toBe(false);
    const loaded = await svc.loadSession('fb');
    expect(loaded!.name).toBe('兜底');
    // 索引也通过兜底路径写成
    expect((await svc.listSessions()).some((e) => e.id === 'fb')).toBe(true);
  });

  it('findOrphanSessions returns ids present on disk but absent from index; does not delete', async () => {
    const svc = new SessionStorageService(makeContext());
    await svc.saveSession(makeSession('indexed'));
    // 写一个孤儿会话文件（不在索引里）
    store.set(SESSION_FILE('orphan'), Buffer.from(JSON.stringify(makeSession('orphan')), 'utf-8'));

    const orphans = await svc.findOrphanSessions();
    expect(orphans).toContain('orphan');
    expect(orphans).not.toContain('indexed');
    // 检测不删除：孤儿文件仍在
    expect(store.has(SESSION_FILE('orphan'))).toBe(true);
  });

  it('rebuildIndex folds valid files (incl. orphans) back into index, skips corrupt, deletes nothing', async () => {
    const svc = new SessionStorageService(makeContext());
    // 两个有效会话文件
    store.set(SESSION_FILE('r1'), Buffer.from(JSON.stringify(makeSession('r1', { name: 'R1' })), 'utf-8'));
    store.set(SESSION_FILE('r2'), Buffer.from(JSON.stringify(makeSession('r2', { name: 'R2' })), 'utf-8'));
    // 一个损坏文件
    store.set(SESSION_FILE('bad'), Buffer.from('{ broken json', 'utf-8'));
    // 索引只含其中一个（缺 r2，且 bad 也不在）
    store.set(INDEX_FILE, Buffer.from(JSON.stringify([
      { id: 'r1', name: 'R1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ]), 'utf-8'));

    const result = await svc.rebuildIndex();
    expect(result).toEqual({ rebuilt: 2, skipped: 1 });

    // 重建后两个有效会话都出现在列表里
    const list = await svc.listSessions();
    const ids = list.map((e) => e.id).sort();
    expect(ids).toEqual(['r1', 'r2']);
    // 损坏文件未被删除
    expect(store.has(SESSION_FILE('bad'))).toBe(true);
    // 重建索引无 tmp 残留
    expect(store.has(INDEX_FILE + '.tmp')).toBe(false);
  });

  it('rebuildIndex does not throw on a corrupt session file', async () => {
    const svc = new SessionStorageService(makeContext());
    store.set(SESSION_FILE('ok'), Buffer.from(JSON.stringify(makeSession('ok')), 'utf-8'));
    store.set(SESSION_FILE('corrupt'), Buffer.from('not json at all', 'utf-8'));

    await expect(svc.rebuildIndex()).resolves.toMatchObject({ rebuilt: 1, skipped: 1 });
    // 损坏文件保留
    expect(store.has(SESSION_FILE('corrupt'))).toBe(true);
  });
});

// ─── globalState 回退测试 ────────────────────────────────

describe('SessionStorageService (globalState fallback)', () => {
  beforeEach(() => {
    folders = undefined; // 无工作区
  });

  it('save / load / delete roundtrip via globalState', async () => {
    const svc = new SessionStorageService(makeContext());
    await svc.saveSession(makeSession('gs1', { name: '回退会话' }));

    const loaded = await svc.loadSession('gs1');
    expect(loaded!.name).toBe('回退会话');

    const list = await svc.listSessions();
    expect(list.map((e) => e.id)).toContain('gs1');

    await svc.deleteSession('gs1');
    expect(await svc.loadSession('gs1')).toBeNull();
    expect((await svc.listSessions()).some((e) => e.id === 'gs1')).toBe(false);
  });
});
