import React from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/variables.css';
import { ReportApp } from './ReportApp';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <React.StrictMode>
      <ReportApp />
    </React.StrictMode>
  );
}
