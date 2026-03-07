import React from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/variables.css';
import { PanelApp } from './PanelApp';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <React.StrictMode>
      <PanelApp />
    </React.StrictMode>
  );
}
