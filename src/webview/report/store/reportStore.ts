import { create } from 'zustand';
import type { RequirementSpec, OverviewData } from '../../../shared/types';

interface ReportState {
  requirementSpec: RequirementSpec | null;
  overview: OverviewData | null;
  streamContent: string;
  isStreaming: boolean;

  // 编辑状态：field key → 编辑中的值（受控内存态，不影响原始 spec）
  editingFields: Record<string, string>;

  setRequirementSpec: (spec: RequirementSpec) => void;
  setOverview: (data: OverviewData) => void;
  setStreamContent: (content: string) => void;
  appendStreamContent: (chunk: string) => void;
  setIsStreaming: (v: boolean) => void;
  setEditingField: (field: string, value: string) => void;
  clearEditingField: (field: string) => void;
  reset: () => void;
}

export const useReportStore = create<ReportState>((set) => ({
  requirementSpec: null,
  overview: null,
  streamContent: '',
  isStreaming: false,
  editingFields: {},

  setRequirementSpec: (spec) => set({ requirementSpec: spec }),
  setOverview: (data) => set({ overview: data }),
  setStreamContent: (content) => set({ streamContent: content }),
  appendStreamContent: (chunk) => set((s) => ({ streamContent: s.streamContent + chunk })),
  setIsStreaming: (v) => set({ isStreaming: v }),
  setEditingField: (field, value) =>
    set((s) => ({ editingFields: { ...s.editingFields, [field]: value } })),
  clearEditingField: (field) =>
    set((s) => {
      const next = { ...s.editingFields };
      delete next[field];
      return { editingFields: next };
    }),
  reset: () =>
    set({ requirementSpec: null, overview: null, streamContent: '', isStreaming: false, editingFields: {} }),
}));
