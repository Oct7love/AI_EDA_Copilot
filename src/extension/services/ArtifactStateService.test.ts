/**
 * ArtifactStateService 单元测试
 * 覆盖：级联失效规则、状态转换、resetAll、回调通知
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ArtifactStateService } from './ArtifactStateService';
import type { ArtifactState } from '../../shared/types/artifactState.types';

describe('ArtifactStateService', () => {
  let service: ArtifactStateService;
  let onChangeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = new ArtifactStateService();
    onChangeSpy = vi.fn();
    service.onStateChange = onChangeSpy;
  });

  describe('初始状态', () => {
    it('所有产物初始为 valid', () => {
      const state = service.getState();
      expect(state.requirement).toBe('valid');
      expect(state.bom).toBe('valid');
      expect(state.schematic).toBe('valid');
      expect(state.pcbLayout).toBe('valid');
      expect(state.procurement).toBe('valid');
      expect(state.designReview).toBe('valid');
    });

    it('hasStale 初始为 false', () => {
      expect(service.hasStale()).toBe(false);
    });
  });

  describe('级联失效 — markStale', () => {
    it('markStale(requirement) → 全部下游 stale', () => {
      service.markStale('requirement');
      const state = service.getState();
      // requirement 自身不变（编辑后 requirement 仍然 valid）
      expect(state.requirement).toBe('valid');
      expect(state.bom).toBe('stale');
      expect(state.schematic).toBe('stale');
      expect(state.pcbLayout).toBe('stale');
      expect(state.procurement).toBe('stale');
      expect(state.designReview).toBe('stale');
    });

    it('markStale(bom) → schematic/pcb/procurement/designReview stale', () => {
      service.markStale('bom');
      const state = service.getState();
      expect(state.requirement).toBe('valid');
      expect(state.bom).toBe('valid');
      expect(state.schematic).toBe('stale');
      expect(state.pcbLayout).toBe('stale');
      expect(state.procurement).toBe('stale');
      expect(state.designReview).toBe('stale');
    });

    it('markStale(schematic) → pcb/designReview stale', () => {
      service.markStale('schematic');
      const state = service.getState();
      expect(state.requirement).toBe('valid');
      expect(state.bom).toBe('valid');
      expect(state.schematic).toBe('valid');
      expect(state.pcbLayout).toBe('stale');
      expect(state.procurement).toBe('valid');
      expect(state.designReview).toBe('stale');
    });

    it('markStale(pcbLayout) → designReview stale', () => {
      service.markStale('pcbLayout');
      const state = service.getState();
      expect(state.pcbLayout).toBe('valid');
      expect(state.designReview).toBe('stale');
      expect(state.requirement).toBe('valid');
      expect(state.bom).toBe('valid');
      expect(state.schematic).toBe('valid');
      expect(state.procurement).toBe('valid');
    });

    it('markStale(procurement) → 无级联（末端节点）', () => {
      service.markStale('procurement');
      const state = service.getState();
      // 所有都应该还是 valid
      expect(Object.values(state).every(s => s === 'valid')).toBe(true);
    });

    it('markStale(designReview) → 无级联（末端节点）', () => {
      service.markStale('designReview');
      const state = service.getState();
      expect(Object.values(state).every(s => s === 'valid')).toBe(true);
    });
  });

  describe('状态转换', () => {
    it('markGenerating 设置目标为 generating', () => {
      service.markGenerating('bom');
      expect(service.getState().bom).toBe('generating');
    });

    it('markValid 设置目标为 valid', () => {
      service.markStale('requirement');
      service.markValid('bom');
      expect(service.getState().bom).toBe('valid');
      // 其他下游仍然 stale
      expect(service.getState().schematic).toBe('stale');
    });

    it('markError 设置目标为 error', () => {
      service.markError('schematic');
      expect(service.getState().schematic).toBe('error');
    });
  });

  describe('resetAll', () => {
    it('重置所有状态为 valid', () => {
      service.markStale('requirement');
      service.markError('bom');
      service.resetAll();
      const state = service.getState();
      expect(Object.values(state).every(s => s === 'valid')).toBe(true);
    });
  });

  describe('辅助方法', () => {
    it('hasStale 检测 stale 状态', () => {
      expect(service.hasStale()).toBe(false);
      service.markStale('requirement');
      expect(service.hasStale()).toBe(true);
    });

    it('getStaleKeys 返回所有 stale 键', () => {
      service.markStale('schematic');
      const keys = service.getStaleKeys();
      expect(keys).toEqual(['pcbLayout', 'designReview']);
    });
  });

  describe('回调通知', () => {
    it('每次状态变更触发 onStateChange', () => {
      service.markStale('requirement');
      expect(onChangeSpy).toHaveBeenCalledTimes(1);

      service.markGenerating('bom');
      expect(onChangeSpy).toHaveBeenCalledTimes(2);

      service.markValid('bom');
      expect(onChangeSpy).toHaveBeenCalledTimes(3);
    });

    it('回调参数是状态快照（非引用）', () => {
      service.markStale('requirement');
      const callArg = onChangeSpy.mock.calls[0][0] as ArtifactState;
      expect(callArg.bom).toBe('stale');
      // 修改返回值不影响内部状态
      callArg.bom = 'valid';
      expect(service.getState().bom).toBe('stale');
    });

    it('无回调时不抛异常', () => {
      const svc = new ArtifactStateService();
      expect(() => svc.markStale('requirement')).not.toThrow();
    });
  });

  describe('getState 返回独立副本', () => {
    it('修改返回值不影响内部状态', () => {
      const state = service.getState();
      state.bom = 'error';
      expect(service.getState().bom).toBe('valid');
    });
  });
});
