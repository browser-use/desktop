/**
 * Settings renderer entry point.
 *
 * Sets data-theme="onboarding" on <html> before React mounts.
 * Mounts <SettingsApp /> into #settings-root.
 *
 * Window: 720×560, resizable: false, titleBarStyle: 'hiddenInset'
 */

import React from 'react';
import { createRoot } from 'react-dom/client';

import { loadFonts } from '../design/fonts';
import '../design/theme.global.css';
import '../design/theme.onboarding.css';
import '../components/base/components.css';
import './settings.css';

import { SettingsApp } from './SettingsApp';

// ---------------------------------------------------------------------------
// Theme activation — must happen before React mounts
// ---------------------------------------------------------------------------

document.documentElement.dataset.theme = 'onboarding';
loadFonts();

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

const container = document.getElementById('settings-root');
if (!container) {
  throw new Error('[settings] #settings-root element not found in settings.html');
}

const root = createRoot(container);
root.render(
  <React.StrictMode>
    <SettingsApp />
  </React.StrictMode>,
);
