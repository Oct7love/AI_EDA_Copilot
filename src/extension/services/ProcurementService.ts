/**
 * 采购匹配服务，串行匹配 BOMItem 到 JLCPCB 料号
 */
import type { BOMItem, ProcurementItem, ProcurementAlternative, JlcComponent } from '@shared/types';
import { JlcAdapter } from '../adapters/JlcAdapter';

const MATCH_DELAY_MS = 100;

export class ProcurementService {
  private readonly jlc = new JlcAdapter();

  /** 为所有 BOMItem 匹配 JLC 料号，返回 ProcurementItem[] 并回填 BOMItem JLC 字段 */
  async matchAll(
    bomItems: BOMItem[],
    onProgress?: (current: number, total: number) => void,
  ): Promise<ProcurementItem[]> {
    const results: ProcurementItem[] = [];

    for (let i = 0; i < bomItems.length; i++) {
      const item = bomItems[i];
      const procItem = await this.matchSingle(item);
      results.push(procItem);

      // 回填 BOMItem JLC 字段
      if (procItem.jlcPartNumber) {
        item.jlcPartNumber = procItem.jlcPartNumber;
        item.jlcProductUrl = procItem.jlcProductUrl;
        item.jlcStock = procItem.jlcStock;
        item.jlcPrice = procItem.jlcPrice;
      }

      onProgress?.(i + 1, bomItems.length);

      // 礼貌间隔
      if (i < bomItems.length - 1) {
        await this.sleep(MATCH_DELAY_MS);
      }
    }

    return results;
  }

  /** 单个 BOMItem 的 JLC 匹配 */
  private async matchSingle(item: BOMItem): Promise<ProcurementItem> {
    const searchQuery = `${item.comment} ${item.footprint}`.trim();
    const components = await this.jlc.searchComponents({ query: searchQuery, limit: 5 });

    if (components.length === 0) {
      return this.buildUnknown(item);
    }

    // 封装匹配优先
    const exactMatch = components.find(c =>
      this.normalizePackage(c.package) === this.normalizePackage(item.footprint)
    );

    const bestMatch = exactMatch ?? components[0];
    const matchType = exactMatch ? 'exact' as const
      : this.isFootprintCompatible(bestMatch.package, item.footprint) ? 'footprint_compatible' as const
      : 'functionally_similar' as const;

    const compatibility = matchType === 'exact' ? 'compatible' as const
      : matchType === 'footprint_compatible' ? 'partial' as const
      : 'partial' as const;

    // 构建替代件列表（排除最佳匹配）
    const alternatives: ProcurementAlternative[] = components
      .filter(c => c.lcsc !== bestMatch.lcsc)
      .slice(0, 3)
      .map((c, i) => ({
        jlcPartNumber: `C${c.lcsc}`,
        jlcProductUrl: JlcAdapter.productUrl(c.lcsc),
        comment: c.description,
        footprint: c.package,
        reason: c.mfr ? `${c.mfr} 替代方案` : '备选料号',
        rank: i + 1,
      }));

    const price = parseFloat(bestMatch.price) || undefined;

    return {
      designator: item.designator,
      comment: item.comment,
      footprint: item.footprint,
      jlcCompatibility: compatibility,
      matchType,
      jlcPartNumber: `C${bestMatch.lcsc}`,
      jlcProductUrl: JlcAdapter.productUrl(bestMatch.lcsc),
      jlcStock: bestMatch.stock,
      jlcPrice: price,
      jlcStockQueryTime: new Date().toISOString(),
      smtReadiness: bestMatch.stock > 0 ? 'ready' : 'missing_part',
      smtIssues: bestMatch.stock === 0 ? ['库存不足'] : [],
      alternatives,
      recommendation: this.buildRecommendation(matchType, bestMatch),
    };
  }

  private buildUnknown(item: BOMItem): ProcurementItem {
    return {
      designator: item.designator,
      comment: item.comment,
      footprint: item.footprint,
      jlcCompatibility: 'unknown',
      matchType: 'unknown',
      smtReadiness: 'missing_part',
      smtIssues: ['未找到匹配料号'],
      alternatives: [],
      recommendation: '建议在立创商城手动搜索替代料号',
    };
  }

  private normalizePackage(pkg: string): string {
    return pkg.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  }

  private isFootprintCompatible(a: string, b: string): boolean {
    return this.normalizePackage(a) === this.normalizePackage(b);
  }

  private buildRecommendation(matchType: string, comp: JlcComponent): string {
    if (matchType === 'exact') return `精确匹配 C${comp.lcsc}，库存 ${comp.stock}`;
    if (matchType === 'footprint_compatible') return `封装兼容匹配 C${comp.lcsc}，建议确认规格`;
    return `功能相似匹配 C${comp.lcsc}，建议人工审核`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
