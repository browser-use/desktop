import React from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { LogsApp } from './LogsApp';
import { ErrorBoundary } from '../components/empty/ErrorBoundary';
import i18n from '../i18n';
import '../design/theme.global.css';
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
      <I18nextProvider i18n={i18n}>
        <LogsApp />
      </I18nextProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
