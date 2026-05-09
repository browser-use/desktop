import React from 'react';
import { createRoot } from 'react-dom/client';
import { LogsApp } from './LogsApp';
import { ErrorBoundary } from '../components/empty/ErrorBoundary';
import '../design/empty-states.css';
import './logs.css';
import { initThemeMode } from '../design/themeMode';

document.documentElement.dataset.theme = 'shell';
initThemeMode();

const rootEl = document.getElementById('logs-root');
if (!rootEl) throw new Error('[logs] #logs-root not found');

createRoot(rootEl).render(
  <React.StrictMode>
    <ErrorBoundary>
      <LogsApp />
    </ErrorBoundary>
  </React.StrictMode>,
);
