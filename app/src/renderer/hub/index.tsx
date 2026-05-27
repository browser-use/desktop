/**
 * Hub renderer entry point.
 * Mounts the HubApp React tree into #hub-root.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { QueryClientProvider } from '@tanstack/react-query';
import { HubApp } from './HubApp';
import i18n from '../i18n';
import { queryClient } from './useSessionsQuery';
import { ToastProvider } from '@/renderer/components/base/Toast';
import { ErrorBoundary } from '../components/empty/ErrorBoundary';
import { OfflineBanner } from '../components/empty/OfflineBanner';
import '@/renderer/design/theme.global.css';
import '../design/empty-states.css';
import '@/renderer/components/base/components.css';
import './hub.css';
import { initThemeMode } from '@/renderer/design/themeMode';
import { makeLogger } from '@/renderer/shared/logger';
import { isIgnorableRendererMessage } from '@/shared/rendererNoise';

// Apply shell theme — hub uses the same dark palette
document.documentElement.dataset.theme = 'shell';
document.documentElement.dataset.platform = detectPlatform();
initThemeMode();

function detectPlatform(): 'mac' | 'win' | 'linux' {
  const ua = navigator.userAgent || '';
  if (/Mac|iPhone|iPad/i.test(ua)) return 'mac';
  if (/Windows/i.test(ua)) return 'win';
  return 'linux';
}

const log = makeLogger('hub');

window.addEventListener('error', (e) => {
  if (isIgnorableRendererMessage(e.message)) return;
  log.error('renderer.error', { message: e.message, file: e.filename, line: e.lineno });
});

window.addEventListener('unhandledrejection', (e) => {
  log.error('renderer.unhandledrejection', { reason: String(e.reason) });
});

const rootEl = document.getElementById('hub-root');
if (!rootEl) throw new Error('[hub] #hub-root element not found');

createRoot(rootEl).render(
  <React.StrictMode>
    <ErrorBoundary>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <OfflineBanner />
            <HubApp />
          </ToastProvider>
        </QueryClientProvider>
      </I18nextProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
