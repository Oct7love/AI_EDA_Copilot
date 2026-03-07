import React from 'react';
import { useInputStore, type InputMode } from '../store/inputStore';
import './InputModeToggle.css';

/** 对话/表单模式切换 */
export function InputModeToggle(): React.ReactElement {
  const mode = useInputStore((s) => s.mode);
  const setMode = useInputStore((s) => s.setMode);

  const options: { value: InputMode; label: string }[] = [
    { value: 'chat', label: 'Chat' },
    { value: 'form', label: 'Form' },
  ];

  return (
    <div className="mode-toggle" role="tablist">
      {options.map((opt) => (
        <button
          key={opt.value}
          role="tab"
          aria-selected={mode === opt.value}
          className={`mode-btn ${mode === opt.value ? 'mode-active' : ''}`}
          onClick={() => setMode(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
