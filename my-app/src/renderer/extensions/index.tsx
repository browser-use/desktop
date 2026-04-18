/**
 * Extensions renderer entry point.
 *
 * Sets data-theme="onboarding" on <html> before React mounts.
 * Mounts <ExtensionsApp /> into #extensions-root.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';

import { loadFonts } from '../design/fonts';
import '../design/theme.global.css';
import '../design/theme.onboarding.css';
import '../components/base/components.css';
import './extensions.css';

import { ExtensionsApp } from './ExtensionsApp';

// ---------------------------------------------------------------------------
// Theme activation — must happen before React mounts
// ---------------------------------------------------------------------------

document.documentElement.dataset.theme = 'onboarding';
loadFonts();

window.addEventListener('error', (e) => {
  console.error('renderer.error', { message: e.message, file: e.filename, line: e.lineno });
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('renderer.unhandledrejection', { reason: String(e.reason) });
});

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

const container = document.getElementById('extensions-root');
if (!container) {
  throw new Error('[extensions] #extensions-root element not found in extensions.html');
}

const root = createRoot(container);
root.render(
  <React.StrictMode>
    <ExtensionsApp />
  </React.StrictMode>,
);
