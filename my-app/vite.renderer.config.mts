import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// https://vitejs.dev/config
// The Forge VitePlugin sets root = projectDir and outDir = .vite/renderer/shell.
// We set root to src/renderer/shell and explicitly declare shell.html as the
// rollup input so Vite resolves it correctly (the file is shell.html, not index.html).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    rollupOptions: {
      input: path.resolve(__dirname, 'src/renderer/shell/shell.html'),
    },
  },
});
