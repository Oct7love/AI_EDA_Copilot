/**
 * Artifact 状态管理服务
 *
 * 职责：
 * - 跟踪各阶段产物的有效性状态（valid/stale/generating/error）
 * - 实现级联失效逻辑（修改上游 → 下游自动标记 stale）
 * - 状态变更时通过回调通知外部（activate.ts 推送到 Report Webview）
 *
 * 数据流：
 *   requirement_edit → markStale('requirement') → 下游全部 stale → onStateChange 回调 → Report
 *   regenerate_stage → markGenerating(key) → AI 管线 → markValid(key) → onStateChange 回调
 */

import {
  type ArtifactKey,
  type ArtifactState,
  DOWNSTREAM_MAP,
  createInitialArtifactState,
} from '../../shared/types/artifactState.types';

export class ArtifactStateService {
  private _state: ArtifactState;
  private _onStateChange: ((state: ArtifactState) => void) | null = null;

  constructor() {
    this._state = createInitialArtifactState();
  }

  /** 注册状态变更回调（由 activate.ts 设置，用于推送到 Report Webview） */
  set onStateChange(fn: (state: ArtifactState) => void) {
    this._onStateChange = fn;
  }

  /** 获取当前状态快照 */
  getState(): ArtifactState {
    return { ...this._state };
  }

  /**
   * 标记产物为 stale，并级联标记所有下游产物
   * 用于：用户编辑需求后调用
   */
  markStale(key: ArtifactKey): void {
    const downstream = DOWNSTREAM_MAP[key];
    for (const dk of downstream) {
      this._state[dk] = 'stale';
    }
    this._notify();
  }

  /**
   * 标记产物正在重新生成
   * 用于：开始 regenerate 时调用
   */
  markGenerating(key: ArtifactKey): void {
    this._state[key] = 'generating';
    this._notify();
  }

  /**
   * 标记产物为有效
   * 用于：regenerate 完成后调用
   */
  markValid(key: ArtifactKey): void {
    this._state[key] = 'valid';
    this._notify();
  }

  /**
   * 标记产物为错误状态
   * 用于：regenerate 失败时调用
   */
  markError(key: ArtifactKey): void {
    this._state[key] = 'error';
    this._notify();
  }

  /** 重置所有状态为 valid（用于新建会话） */
  resetAll(): void {
    this._state = createInitialArtifactState();
    this._notify();
  }

  /**
   * 根据已有产物数据设置状态（用于切换会话）
   * 有数据的标记 valid，无数据的保持 valid（初始态）
   */
  setFromExisting(_hasData: Partial<Record<ArtifactKey, boolean>>): void {
    this._state = createInitialArtifactState();
    // 所有有数据的都是 valid，没数据的也是 valid（未生成不等于 stale）
    this._notify();
  }

  /** 检查是否有任何产物处于 stale 状态 */
  hasStale(): boolean {
    return Object.values(this._state).some(s => s === 'stale');
  }

  /** 获取所有 stale 状态的产物键 */
  getStaleKeys(): ArtifactKey[] {
    return (Object.keys(this._state) as ArtifactKey[])
      .filter(k => this._state[k] === 'stale');
  }

  private _notify(): void {
    this._onStateChange?.(this.getState());
  }
}
