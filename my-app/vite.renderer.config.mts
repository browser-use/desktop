import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// The Forge VitePlugin sets root = projectDir and outDir = .vite/renderer/shell.
// We point to the hub renderer which replaces the old browser shell.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    rollupOptions: {
      input: path.resolve(__dirname, 'src/renderer/hub/hub.html'),
    },
  },
});
