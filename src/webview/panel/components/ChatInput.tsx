/** 对话输入组件，Enter 发送 / Shift+Enter 换行 */
import React, { useCallback } from 'react';
import { useInputStore } from '../store/inputStore';
import vscodeApi from '../../shared/vscodeApi';
import { createMessage } from '../../../shared/types';
import type { PanelToExtension } from '../../../shared/types';
import './ChatInput.css';

/** 对话模式输入 */
export function ChatInput(): React.ReactElement {
  const chatText = useInputStore((s) => s.chatText);
  const setChatText = useInputStore((s) => s.setChatText);
  const addMessage = useInputStore((s) => s.addMessage);
  const isGenerating = useInputStore((s) => s.isGenerating);

  const handleSubmit = useCallback(() => {
    const text = chatText.trim();
    if (!text) return;

    addMessage('user', text);
    const message: PanelToExtension = createMessage(
      'submit_requirement', 'panel', { text, mode: 'chat' as const }
    );
    vscodeApi.postMessage(message);
    setChatText('');
  }, [chatText, addMessage, setChatText]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  return (
    <div className="chat-input-area">
      <textarea
        className="chat-textarea"
        value={chatText}
        onChange={(e) => setChatText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Describe your electronics project..."
        rows={3}
        disabled={isGenerating}
      />
      <button
        className="btn-send"
        onClick={handleSubmit}
        disabled={!chatText.trim() || isGenerating}
      >
        {isGenerating ? 'Generating...' : 'Send'}
      </button>
    </div>
  );
}
