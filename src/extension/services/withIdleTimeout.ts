/**
 * 流式空闲看门狗 — 纯逻辑、无外部依赖，可独立单测。
 *
 * 包裹一个 AsyncIterable：若相邻两次产出（或首个产出）之间的间隔超过 idleMs，
 * 即判定为「空闲超时」，调用 onIdle（通常用于 abort 底层请求）并抛出 IdleTimeoutError。
 * 这样即便底层流被挂起（连接未关、无后续 chunk），消费方也能拿到明确错误而非永久 pending。
 */

export class IdleTimeoutError extends Error {
  constructor(public readonly idleMs: number) {
    super(`流式响应空闲超过 ${Math.round(idleMs / 1000)}s 无新数据`);
    this.name = 'IdleTimeoutError';
  }
}

export async function* withIdleTimeout<T>(
  source: AsyncIterable<T>,
  idleMs: number,
  onIdle?: () => void,
): AsyncGenerator<T> {
  const it = source[Symbol.asyncIterator]();
  while (true) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const idle = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        onIdle?.();
        reject(new IdleTimeoutError(idleMs));
      }, idleMs);
    });

    const nextP = it.next();
    // 竞速输给 idle 后，nextP 仍可能在底层 abort 时迟到 reject；
    // 预挂 catch 防止其成为 unhandledRejection。
    nextP.catch(() => { /* swallowed */ });

    let res: IteratorResult<T>;
    try {
      res = await Promise.race([nextP, idle]);
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (res.done) return;
    yield res.value;
  }
}
