import React from 'react';
import { createRoot } from 'react-dom/client';
import '../design/theme.global.css';
import '../design/empty-states.css';
import './popup.css';
import { initThemeMode } from '../design/themeMode';
import { ErrorBoundary } from '../components/empty/ErrorBoundary';
import { AppPopup } from './AppPopup';

document.documentElement.dataset.theme = 'shell';
initThemeMode();

const rootEl = document.getElementById('popup-root');
if (!rootEl) throw new Error('[popup] #popup-root not found');

createRoot(rootEl).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AppPopup />
    </ErrorBoundary>
  </React.StrictMode>,
);
