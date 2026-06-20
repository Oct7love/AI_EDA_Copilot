/**
 * 极简有界并发 map（无依赖，手写）。
 *
 * 约束：
 * - 同一时刻最多 `limit` 个 fn() 在执行；
 * - 结果按「输入顺序」返回（用 index 定位），与完成先后无关；
 * - 单个 fn 抛错不会 reject 整批：该槽位记录 rejection，其它继续；最终该槽以 reject 兑现。
 *   （ProcurementService.matchSingle 保证不抛，所以那条路径不会触发；此处仍保持健壮。）
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const errors: Array<{ index: number; error: unknown }> = [];
  const max = Math.max(1, Math.min(limit, items.length || 1));
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = await fn(items[index], index);
      } catch (error) {
        errors.push({ index, error });
      }
    }
  }

  const workers = Array.from({ length: max }, () => worker());
  await Promise.all(workers);

  if (errors.length > 0) {
    // 保留首个错误的 index 顺序语义，抛出第一个（按发生顺序）
    errors.sort((a, b) => a.index - b.index);
    throw errors[0].error;
  }
  return results;
}
