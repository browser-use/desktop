import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  cacheDir: path.resolve(__dirname, 'node_modules/.vite/popup'),
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    rollupOptions: {
      input: path.resolve(__dirname, 'src/renderer/popup/popup.html'),
    },
  },
});
