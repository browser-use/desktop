import React from 'react';
import { createRoot } from 'react-dom/client';
import { HistoryPage } from './HistoryPage';
import '../design/theme.global.css';
import './history.css';

window.addEventListener('error', (e) => {
  console.error('history.error', { message: e.message, file: e.filename, line: e.lineno });
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('history.unhandledrejection', { reason: String(e.reason) });
});

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('[history] #root element not found');

createRoot(rootEl).render(
  <React.StrictMode>
    <HistoryPage />
  </React.StrictMode>,
);
