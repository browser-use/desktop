/**
 * Vite config for the onboarding renderer (Track C).
 *
 * Separate from vite.renderer.config.ts (Track A shell) because:
 *   - Different HTML entry: onboarding.html vs shell.html
 *   - Different preload context: window.onboardingAPI vs window.electronAPI
 *   - Different theme: data-theme="onboarding" vs data-theme="shell"
 *
 * Added to forge.config.ts VitePlugin renderer array by Track F.
 * See .track-C-forge-diff.md for the exact diff.
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    rollupOptions: {
      input: path.resolve(__dirname, 'src/renderer/onboarding/onboarding.html'),
    },
  },
});
