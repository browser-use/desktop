/**
 * Hub renderer entry point.
 * Mounts the HubApp React tree into #hub-root.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { HubApp } from './HubApp';
import { queryClient } from './useSessionsQuery';
import { ToastProvider } from '@/renderer/components/base/Toast';
import { ErrorBoundary } from '../components/empty/ErrorBoundary';
import { OfflineBanner } from '../components/empty/OfflineBanner';
import '@/renderer/design/theme.global.css';
import '../design/empty-states.css';
import '@/renderer/components/base/components.css';
import './hub.css';

// Apply shell theme — hub uses the same dark palette
document.documentElement.dataset.theme = 'shell';

window.addEventListener('error', (e) => {
  console.error('[hub] renderer.error', { message: e.message, file: e.filename, line: e.lineno });
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('[hub] renderer.unhandledrejection', { reason: String(e.reason) });
});

const rootEl = document.getElementById('hub-root');
if (!rootEl) throw new Error('[hub] #hub-root element not found');

createRoot(rootEl).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <OfflineBanner />
          <HubApp />
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
