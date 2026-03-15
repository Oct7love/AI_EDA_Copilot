/** 会话管理栏 — 显示当前会话名 + 历史列表 + 新建/保存按钮 */
import React, { useState, useEffect, useCallback } from 'react';
import type { SessionIndexEntry, ExtensionToPanel } from '../../../shared/types';
import { createMessage } from '../../../shared/types';
import vscodeApi from '../../shared/vscodeApi';
import { useInputStore } from '../store/inputStore';
import './SessionBar.css';

export function SessionBar(): React.ReactElement {
  const sessionId = useInputStore((s) => s.sessionId);
  const sessionName = useInputStore((s) => s.sessionName);
  const [sessions, setSessions] = useState<SessionIndexEntry[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  // 请求会话列表
  const refreshList = useCallback(() => {
    vscodeApi.postMessage(createMessage('session_list', 'panel', undefined as never));
  }, []);

  // 挂载时获取列表
  useEffect(() => {
    refreshList();
  }, [refreshList]);

  // 监听会话相关消息
  useEffect(() => {
    const handler = (event: MessageEvent<ExtensionToPanel>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'session_list_response':
          setSessions(msg.payload.sessions);
          break;
        case 'session_saved':
          refreshList();
          break;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [refreshList]);

  const handleNew = () => {
    vscodeApi.postMessage(createMessage('session_new', 'panel', undefined as never));
    setIsOpen(false);
  };

  const handleSave = () => {
    vscodeApi.postMessage(createMessage('session_save', 'panel', { name: undefined }));
  };

  const handleSwitch = (id: string) => {
    vscodeApi.postMessage(createMessage('session_switch', 'panel', { sessionId: id }));
    setIsOpen(false);
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    vscodeApi.postMessage(createMessage('session_delete', 'panel', { sessionId: id }));
  };

  return (
    <div className="session-bar">
      <div className="session-current" onClick={() => setIsOpen(!isOpen)}>
        <span className="session-name">{sessionName ?? 'New Session'}</span>
        <span className="session-arrow">{isOpen ? '\u25B2' : '\u25BC'}</span>
      </div>

      <button className="session-btn" onClick={handleNew} title="New Session">+</button>
      <button className="session-btn" onClick={handleSave} title="Save Session">
        <span style={{ fontSize: '12px' }}>Save</span>
      </button>

      {isOpen && sessions.length > 0 && (
        <div className="session-dropdown">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`session-item ${s.id === sessionId ? 'session-item-active' : ''}`}
              onClick={() => handleSwitch(s.id)}
            >
              <div className="session-item-info">
                <span className="session-item-name">{s.name}</span>
                <span className="session-item-date">
                  {new Date(s.updatedAt).toLocaleDateString()}
                </span>
              </div>
              <button
                className="session-item-delete"
                onClick={(e) => handleDelete(e, s.id)}
                title="Delete"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
