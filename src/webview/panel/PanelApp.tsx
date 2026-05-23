/** Side Panel 主组件，管理消息监听、输入模式切换、会话管理和全局布局 */
import React, { useEffect, useCallback } from 'react';
import { useInputStore } from './store/inputStore';
import { InputModeToggle } from './components/InputModeToggle';
import { ChatInput } from './components/ChatInput';
import { FormInput } from './components/FormInput';
import { TemplateSelector } from './components/TemplateSelector';
import { CodeFolderPicker } from './components/CodeFolderPicker';
import { CodeAnalysisPreview } from './components/CodeAnalysisPreview';
import { SessionBar } from './components/SessionBar';
import vscodeApi from '../shared/vscodeApi';
import type { ExtensionToPanel, PanelToExtension } from '../../shared/types';
import { createMessage } from '../../shared/types';
import './PanelApp.css';

/**
 * 侧边栏根组件
 * Phase 2：三模式输入（Chat / Form / Template）+ Zustand 状态管理
 * 会话管理：保存 / 切换 / 新建
 */
export function PanelApp(): React.ReactElement {
  const mode = useInputStore((s) => s.mode);
  const messages = useInputStore((s) => s.messages);
  const status = useInputStore((s) => s.status);
  const addMessage = useInputStore((s) => s.addMessage);
  const appendToLastMessage = useInputStore((s) => s.appendToLastMessage);
  const setStatus = useInputStore((s) => s.setStatus);
  const setIsGenerating = useInputStore((s) => s.setIsGenerating);
  const loadSession = useInputStore((s) => s.loadSession);
  const clearChat = useInputStore((s) => s.clearChat);
  const setSessionInfo = useInputStore((s) => s.setSessionInfo);
  const codeAnalysisStatus = useInputStore((s) => s.codeAnalysisStatus);
  const setCodeAnalysisResult = useInputStore((s) => s.setCodeAnalysisResult);
  const setCodeAnalysisFailed = useInputStore((s) => s.setCodeAnalysisFailed);

  // 监听 Extension Host → Panel 消息
  useEffect(() => {
    const handler = (event: MessageEvent<ExtensionToPanel>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'ai_chat_response':
          if (msg.payload.isStreaming) {
            appendToLastMessage(msg.payload.content);
          } else {
            addMessage('assistant', msg.payload.content);
            setIsGenerating(false);
          }
          break;
        case 'generation_status':
          setStatus(`${msg.payload.stage}: ${msg.payload.progress}%`);
          break;
        case 'error':
          setStatus(`Error: ${msg.payload.message}`);
          setIsGenerating(false);
          break;
        case 'session_loaded':
          loadSession({
            messages: msg.payload.conversation,
            mode: msg.payload.inputMode,
            formData: msg.payload.formData,
            sessionId: msg.payload.sessionId,
            sessionName: msg.payload.name,
          });
          break;
        case 'session_cleared':
          clearChat();
          break;
        case 'session_saved':
          setSessionInfo(msg.payload.sessionId, msg.payload.name);
          break;
        case 'code_analysis_result':
          setCodeAnalysisResult(msg.payload.result);
          break;
        case 'code_analysis_failed':
          setCodeAnalysisFailed(msg.payload.message);
          break;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [addMessage, appendToLastMessage, setStatus, setIsGenerating, loadSession, clearChat, setSessionInfo, setCodeAnalysisResult, setCodeAnalysisFailed]);

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
        <SessionBar />
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
        {mode === 'chat' && <ChatInput />}
        {mode === 'form' && <FormInput />}
        {mode === 'code' && (
          codeAnalysisStatus === 'ready'
            ? <CodeAnalysisPreview />
            : <CodeFolderPicker />
        )}
      </div>
    </div>
  );
}
