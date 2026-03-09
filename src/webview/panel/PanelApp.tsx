/** Side Panel 主组件，管理消息监听、输入模式切换和全局布局 */
import React, { useEffect, useCallback } from 'react';
import { useInputStore } from './store/inputStore';
import { InputModeToggle } from './components/InputModeToggle';
import { ChatInput } from './components/ChatInput';
import { FormInput } from './components/FormInput';
import { TemplateSelector } from './components/TemplateSelector';
import vscodeApi from '../shared/vscodeApi';
import type { ExtensionToPanel, PanelToExtension } from '../../shared/types';
import { createMessage } from '../../shared/types';
import './PanelApp.css';

/**
 * 侧边栏根组件
 * Phase 2：三模式输入（Chat / Form / Template）+ Zustand 状态管理
 */
export function PanelApp(): React.ReactElement {
  const mode = useInputStore((s) => s.mode);
  const messages = useInputStore((s) => s.messages);
  const status = useInputStore((s) => s.status);
  const addMessage = useInputStore((s) => s.addMessage);
  const setStatus = useInputStore((s) => s.setStatus);
  const setIsGenerating = useInputStore((s) => s.setIsGenerating);

  // 监听 Extension Host → Panel 消息
  useEffect(() => {
    const handler = (event: MessageEvent<ExtensionToPanel>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'ai_chat_response':
          addMessage('assistant', msg.payload.content);
          if (!msg.payload.isStreaming) setIsGenerating(false);
          break;
        case 'generation_status':
          setStatus(`${msg.payload.stage}: ${msg.payload.progress}%`);
          break;
        case 'error':
          setStatus(`Error: ${msg.payload.message}`);
          setIsGenerating(false);
          break;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [addMessage, setStatus, setIsGenerating]);

  const handleOpenReport = useCallback(() => {
    const message: PanelToExtension = createMessage(
      'open_report', 'panel',
      { projectId: 'default', schemeId: 'default' }
    );
    vscodeApi.postMessage(message);
  }, []);

  return (
    <div className="panel-container">
      <header className="panel-header">
        <h2>AI EDA Copilot</h2>
        <button className="btn-secondary" onClick={handleOpenReport}>
          Open Report
        </button>
      </header>

      {/* 消息列表 */}
      <div className="message-list">
        {messages.length === 0 && (
          <div className="empty-state">
            <TemplateSelector />
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`message message-${msg.role}`}>
            <span className="message-role">{msg.role === 'user' ? 'You' : 'AI'}</span>
            <p className="message-content">{msg.content}</p>
          </div>
        ))}
        {status && <div className="status-bar">{status}</div>}
      </div>

      {/* 输入区域 */}
      <div className="input-area">
        <InputModeToggle />
        {mode === 'chat' ? <ChatInput /> : <FormInput />}
      </div>
    </div>
  );
}
