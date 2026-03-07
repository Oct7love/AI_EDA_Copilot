import { create } from 'zustand';
import type { FormInputData } from '../../../shared/types';
import { createEmptyFormData } from '../../../shared/types';

export type InputMode = 'chat' | 'form';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface InputState {
  mode: InputMode;
  chatText: string;
  formData: FormInputData;
  messages: ChatMessage[];
  status: string;
  isGenerating: boolean;

  setMode: (mode: InputMode) => void;
  setChatText: (text: string) => void;
  updateFormField: <K extends keyof FormInputData>(key: K, value: FormInputData[K]) => void;
  setFormData: (data: Partial<FormInputData>) => void;
  addMessage: (role: 'user' | 'assistant', content: string) => void;
  setStatus: (status: string) => void;
  setIsGenerating: (v: boolean) => void;
  clearChat: () => void;
}

export const useInputStore = create<InputState>((set) => ({
  mode: 'chat',
  chatText: '',
  formData: createEmptyFormData(),
  messages: [],
  status: '',
  isGenerating: false,

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

  setStatus: (status) => set({ status }),
  setIsGenerating: (isGenerating) => set({ isGenerating }),

  clearChat: () => set({ messages: [], chatText: '', status: '' }),
}));
