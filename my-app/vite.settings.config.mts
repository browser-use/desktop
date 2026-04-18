/**
 * Vite config for the settings renderer (Track 5).
 *
 * Follows the same pattern as vite.onboarding.config.ts:
 *   - NO root override (uses project root)
 *   - Relative script src in HTML (./index.tsx)
 *   - Full path from project root in loadURL
 *
 * See memory: project_electron_forge_vite_paths.md
 *
 * Added to forge.config.ts VitePlugin renderer array by Track 0.
 * See .track-5-forge-diff.md for the exact diff.
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
      input: path.resolve(__dirname, 'src/renderer/settings/settings.html'),
    },
  },
});
