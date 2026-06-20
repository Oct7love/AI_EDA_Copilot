/**
 * 采购匹配服务，串行匹配 BOMItem 到 JLCPCB 料号。
 *
 * 诚实化说明：当前仅基于「comment + footprint」做全文检索 + 封装字符串比对，
 * 未校验电气值/电压/容差/MPN，故所有匹配统一标 partial（待人工确认），不声称已验证兼容。
 * 查询失败（网络/接口/解析/超时）与「真实无货/未找到」通过 queryStatus 区分。
 */
import type {
  BOMItem,
  ProcurementItem,
  ProcurementAlternative,
  ProcurementQueryStatus,
  JlcComponent,
  JlcSearchFailureReason,
} from '@shared/types';
import { JlcAdapter } from '../adapters/JlcAdapter';
import { mapLimit } from './mapLimit';

/** matchAll 默认并发上限：在限制 JLC 接口压力与整体提速之间取折中 */
const MATCH_CONCURRENCY = 5;

export class ProcurementService {
  /** 允许注入 adapter 以便测试 */
  constructor(private readonly jlc: JlcAdapter = new JlcAdapter()) {}

  /**
   * 为所有 BOMItem 匹配 JLC 料号，返回 ProcurementItem[]（顺序 == 输入顺序）并回填 BOMItem JLC 字段。
   *
   * 并发：通过 mapLimit 限制最多 MATCH_CONCURRENCY 个查询同时在飞，已不再串行+固定 sleep。
   * 中止：传入 signal 后，已 abort 的剩余项不会再发起 fetch；matchSingle 不抛异常，
   *      中止项以良性 queryStatus:'timeout' 兑现（语义=「未完成查询，请重试」，不等于无货）。
   * onProgress：每完成一项即触发一次（current=已完成数, total=总数），与并发完成顺序一致。
   */
  async matchAll(
    bomItems: BOMItem[],
    onProgress?: (current: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<ProcurementItem[]> {
    const total = bomItems.length;
    let completed = 0;

    return mapLimit(bomItems, MATCH_CONCURRENCY, async (item) => {
      const procItem = await this.matchSingle(item, signal);

      // 回填 BOMItem JLC 字段
      if (procItem.jlcPartNumber) {
        item.jlcPartNumber = procItem.jlcPartNumber;
        item.jlcProductUrl = procItem.jlcProductUrl;
        item.jlcStock = procItem.jlcStock;
        item.jlcPrice = procItem.jlcPrice;
      }

      completed += 1;
      onProgress?.(completed, total);
      return procItem;
    });
  }

  /** 单个 BOMItem 的 JLC 匹配（永不抛异常，失败/中止都以 queryStatus 表达） */
  private async matchSingle(item: BOMItem, signal?: AbortSignal): Promise<ProcurementItem> {
    // 已中止：短路成良性失败项，不再发起查询
    if (signal?.aborted) {
      return this.buildAborted(item);
    }

    const searchQuery = `${item.comment} ${item.footprint}`.trim();
    const result = await this.jlc.searchComponents({ query: searchQuery, limit: 5 }, signal);

    if (!result.ok) {
      return this.buildQueryFailure(item, result.reason);
    }

    const components = result.components;
    if (components.length === 0) {
      return this.buildNotFound(item);
    }

    // 封装字符串匹配（仅比对封装，未校验值/电压/MPN）
    const exactMatch = components.find(
      (c) => this.normalizePackage(c.package) === this.normalizePackage(item.footprint),
    );
    const bestMatch = exactMatch ?? components[0];

    // 诚实化：封装相等只代表「封装兼容候选」，不代表规格一致 → 统一 partial，不再标 exact/compatible
    const matchType = exactMatch ? ('footprint_compatible' as const) : ('functionally_similar' as const);
    const compatibility = 'partial' as const;

    const alternatives: ProcurementAlternative[] = components
      .filter((c) => c.lcsc !== bestMatch.lcsc)
      .slice(0, 3)
      .map((c, i) => ({
        jlcPartNumber: `C${c.lcsc}`,
        jlcProductUrl: JlcAdapter.productUrl(c.lcsc),
        comment: c.description,
        footprint: c.package,
        reason: c.mfr ? `${c.mfr} 替代方案` : '备选料号',
        rank: i + 1,
      }));

    const price = this.parseFinite(bestMatch.price);
    const stock = this.parseFinite(bestMatch.stock);
    const hasStock = stock !== undefined && stock > 0;
    const queryStatus: ProcurementQueryStatus = hasStock ? 'in_stock' : 'out_of_stock';

    return {
      designator: item.designator,
      comment: item.comment,
      footprint: item.footprint,
      jlcCompatibility: compatibility,
      matchType,
      queryStatus,
      jlcPartNumber: `C${bestMatch.lcsc}`,
      jlcProductUrl: JlcAdapter.productUrl(bestMatch.lcsc),
      jlcStock: stock,
      jlcPrice: price,
      jlcStockQueryTime: new Date().toISOString(),
      smtReadiness: hasStock ? 'ready' : 'missing_part',
      smtIssues: hasStock ? [] : ['库存不足或缺货'],
      alternatives,
      recommendation: this.buildRecommendation(matchType, bestMatch, hasStock),
    };
  }

  /** 接口正常但无匹配料号（真实「未找到」） */
  private buildNotFound(item: BOMItem): ProcurementItem {
    return {
      designator: item.designator,
      comment: item.comment,
      footprint: item.footprint,
      jlcCompatibility: 'unknown',
      matchType: 'unknown',
      queryStatus: 'not_found',
      smtReadiness: 'missing_part',
      smtIssues: ['未找到匹配料号'],
      alternatives: [],
      recommendation: '建议在立创商城手动搜索替代料号',
    };
  }

  /** 查询失败（网络/接口/解析/超时）— 明确区分于「无货」，不误导用户 */
  private buildQueryFailure(item: BOMItem, reason: JlcSearchFailureReason): ProcurementItem {
    const label: Record<JlcSearchFailureReason, string> = {
      network_error: '网络连接失败',
      api_error: '接口返回异常',
      parse_error: '返回数据结构异常',
      timeout: '查询超时',
    };
    return {
      designator: item.designator,
      comment: item.comment,
      footprint: item.footprint,
      jlcCompatibility: 'unknown',
      matchType: 'unknown',
      queryStatus: reason, // network_error / api_error / parse_error / timeout
      // 查询失败 ≠ 无货，故用 manual_only 而非 missing_part，避免误导
      smtReadiness: 'manual_only',
      smtIssues: [`JLC 查询失败（${label[reason]}），未确认是否可用，请稍后重试`],
      alternatives: [],
      recommendation: `查询失败（${label[reason]}），请稍后重试或在立创商城手动核对`,
    };
  }

  /** 被中止（abort）— 视为良性「查询未完成」，复用 timeout 语义，绝不误标无货 */
  private buildAborted(item: BOMItem): ProcurementItem {
    return {
      designator: item.designator,
      comment: item.comment,
      footprint: item.footprint,
      jlcCompatibility: 'unknown',
      matchType: 'unknown',
      queryStatus: 'timeout', // 中止 = 未完成查询，复用 timeout，不等于无货
      smtReadiness: 'manual_only',
      smtIssues: ['查询已取消，未完成 JLC 匹配，请重试'],
      alternatives: [],
      recommendation: '查询已取消，请重新运行匹配或在立创商城手动核对',
    };
  }

  private normalizePackage(pkg: string): string {
    return (pkg ?? '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  }

  /** 安全解析数值：保留 0，无法解析返回 undefined（修复 parseFlo(0)||undefined 丢 0、NaN>0 误判） */
  private parseFinite(raw: unknown): number | undefined {
    const n = typeof raw === 'number' ? raw : parseFloat(String(raw));
    return Number.isFinite(n) ? n : undefined;
  }

  private buildRecommendation(matchType: string, comp: JlcComponent, hasStock: boolean): string {
    const stockNote = hasStock ? `库存 ${comp.stock}` : '库存不足/缺货';
    if (matchType === 'footprint_compatible') {
      return `封装匹配 C${comp.lcsc}（${stockNote}），仅按封装匹配，请人工核对电气规格`;
    }
    return `功能相似匹配 C${comp.lcsc}（${stockNote}），建议人工审核规格与封装`;
  }
}
