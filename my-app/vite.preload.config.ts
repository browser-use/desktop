import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    // `browserField: false` was removed in Vite 5; the explicit `mainFields`
    // list below already excludes `browser`, giving the same behaviour.
    conditions: ['node'],
    mainFields: ['module', 'jsnext:main', 'jsnext'],
  },
});
