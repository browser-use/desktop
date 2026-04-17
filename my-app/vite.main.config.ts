import { defineConfig } from 'vite';

// https://vitejs.dev/config
// package.json sets "main": ".vite/build/main.js" — Forge and Electron packager
// both require that exact filename. Force output to main.js regardless of entry
// file name (index.ts, main.ts, etc.) via rollupOptions.output.entryFileNames.
export default defineConfig({
  resolve: {
    // Ensure correct resolution of node built-ins
    browserField: false,
    conditions: ['node'],
    mainFields: ['module', 'jsnext:main', 'jsnext'],
  },
  build: {
    rollupOptions: {
      external: ['@anthropic-ai/sdk', 'dotenv'],
      output: {
        entryFileNames: 'main.js',
      },
    },
  },
});
