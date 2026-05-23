/** Side Panel Zustand Store，管理输入状态、消息列表、会话信息和生成状态 */
import { create } from 'zustand';
import type { FormInputData, ChatMessage, CodeAnalysisResult } from '../../../shared/types';
import { createEmptyFormData } from '../../../shared/types';

export type InputMode = 'chat' | 'form' | 'code';
export type CodeAnalysisStatus = 'idle' | 'scanning' | 'ready' | 'failed';

interface InputState {
  mode: InputMode;
  chatText: string;
  formData: FormInputData;
  messages: ChatMessage[];
  status: string;
  isGenerating: boolean;
  sessionId: string | null;
  sessionName: string | null;
  codeAnalysisStatus: CodeAnalysisStatus;
  codeAnalysisResult: CodeAnalysisResult | null;
  codeAnalysisError: string;

  setMode: (mode: InputMode) => void;
  setChatText: (text: string) => void;
  updateFormField: <K extends keyof FormInputData>(key: K, value: FormInputData[K]) => void;
  setFormData: (data: Partial<FormInputData>) => void;
  addMessage: (role: 'user' | 'assistant', content: string) => void;
  appendToLastMessage: (content: string) => void;
  setStatus: (status: string) => void;
  setIsGenerating: (v: boolean) => void;
  setSessionInfo: (id: string | null, name: string | null) => void;
  loadSession: (data: { messages: ChatMessage[]; mode: InputMode; formData?: FormInputData; sessionId: string; sessionName: string }) => void;
  setCodeAnalysisScanning: () => void;
  setCodeAnalysisResult: (result: CodeAnalysisResult) => void;
  setCodeAnalysisFailed: (message: string) => void;
  resetCodeAnalysis: () => void;
  clearChat: () => void;
}

export const useInputStore = create<InputState>((set) => ({
  mode: 'chat',
  chatText: '',
  formData: createEmptyFormData(),
  messages: [],
  status: '',
  isGenerating: false,
  sessionId: null,
  sessionName: null,
  codeAnalysisStatus: 'idle',
  codeAnalysisResult: null,
  codeAnalysisError: '',

  setMode: (mode) => set({ mode }),
  setChatText: (chatText) => set({ chatText }),

  updateFormField: (key, value) =>
    set((state) => ({
      formData: { ...state.formData, [key]: value },
    })),

  setFormData: (data) =>
    set((state) => ({
      formData: { ...state.formData, ...data },
    })),

  addMessage: (role, content) =>
    set((state) => ({
      messages: [
        ...state.messages,
        { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role, content, timestamp: Date.now() },
      ],
    })),

  appendToLastMessage: (content) =>
    set((state) => {
      const messages = [...state.messages];
      const last = messages[messages.length - 1];
      if (last && last.role === 'assistant') {
        messages[messages.length - 1] = { ...last, content: last.content + content };
        return { messages };
      }
      // 末尾没有 assistant 消息则新建
      return {
        messages: [
          ...state.messages,
          { id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role: 'assistant', content, timestamp: Date.now() },
        ],
      };
    }),

  setStatus: (status) => set({ status }),
  setIsGenerating: (isGenerating) => set({ isGenerating }),

  setSessionInfo: (sessionId, sessionName) => set({ sessionId, sessionName }),

  setCodeAnalysisScanning: () => set({ codeAnalysisStatus: 'scanning', codeAnalysisError: '' }),
  setCodeAnalysisResult: (result) => set({ codeAnalysisStatus: 'ready', codeAnalysisResult: result, codeAnalysisError: '' }),
  setCodeAnalysisFailed: (message) => set({ codeAnalysisStatus: 'failed', codeAnalysisResult: null, codeAnalysisError: message }),
  resetCodeAnalysis: () => set({ codeAnalysisStatus: 'idle', codeAnalysisResult: null, codeAnalysisError: '' }),

  loadSession: (data) => set({
    messages: data.messages,
    mode: data.mode,
    formData: data.formData ?? createEmptyFormData(),
    sessionId: data.sessionId,
    sessionName: data.sessionName,
    chatText: '',
    status: '',
    isGenerating: false,
    codeAnalysisStatus: 'idle', codeAnalysisResult: null, codeAnalysisError: '',
  }),

  clearChat: () => set({
    messages: [], chatText: '', status: '',
    sessionId: null, sessionName: null,
    formData: createEmptyFormData(),
    codeAnalysisStatus: 'idle', codeAnalysisResult: null, codeAnalysisError: '',
  }),
}));
