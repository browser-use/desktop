import React from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { OnboardingApp } from './OnboardingApp';
import { ErrorBoundary } from '../components/empty/ErrorBoundary';
import i18n from '../i18n';
import { OfflineBanner } from '../components/empty/OfflineBanner';
import '@/renderer/design/theme.global.css';
import '../design/empty-states.css';
import './onboarding.css';
import { isIgnorableRendererMessage } from '@/shared/rendererNoise';

document.documentElement.dataset.theme = 'shell';

window.addEventListener('error', (e) => {
  if (isIgnorableRendererMessage(e.message)) return;
  console.error('[onboarding] renderer.error', { message: e.message, file: e.filename, line: e.lineno });
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('[onboarding] renderer.unhandledrejection', { reason: String(e.reason) });
});

const rootEl = document.getElementById('onboarding-root');
if (!rootEl) throw new Error('[onboarding] #onboarding-root element not found');

createRoot(rootEl).render(
  <React.StrictMode>
    <ErrorBoundary>
      <I18nextProvider i18n={i18n}>
        <OfflineBanner />
        <OnboardingApp />
      </I18nextProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
