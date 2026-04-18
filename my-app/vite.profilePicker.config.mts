/**
 * Vite config for the profile picker renderer.
 * Follows the same pattern as vite.settings.config.ts.
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
      input: path.resolve(__dirname, 'src/renderer/profile-picker/profile-picker.html'),
    },
  },
});
