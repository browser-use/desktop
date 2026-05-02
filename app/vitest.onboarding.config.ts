/**
 * Vitest configuration for Track C (Onboarding & Identity) unit tests.
 *
 * Separate from vitest.config.ts (Track H) to avoid modifying another track's file.
 * Run: npx vitest run --config vitest.onboarding.config.ts
 *
 * Two environments:
 *   - node: identity tests (OAuthClient, KeychainStore, AccountStore)
 *   - jsdom: React component tests (Welcome, GoogleScopesModal)
 */

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'onboarding',
    include: [
      'tests/unit/identity/**/*.spec.ts',
      'tests/unit/onboarding/**/*.spec.tsx',
      'tests/integration/**/*.test.ts',
    ],
    exclude: ['tests/e2e/**', 'tests/parity/**'],
    // jsdom provides browser-like environment for React component tests
    // Identity tests (pure node) also work in jsdom
    environment: 'jsdom',
    globals: false,
    setupFiles: ['tests/fixtures/onboarding-setup.ts'],
    reporters: ['verbose'],
    coverage: {
      provider: 'v8',
      include: [
        'src/main/identity/**/*.ts',
        'src/main/oauth.ts',
        'src/renderer/onboarding/**/*.tsx',
        'src/preload/onboarding.ts',
      ],
      reporter: ['text', 'lcov'],
      reportsDirectory: 'tests/results/coverage-onboarding',
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
      },
    },
  },
  resolve: {
    alias: {
      // Mock electron in all tests
      electron: path.resolve(__dirname, 'tests/fixtures/electron-mock.ts'),
      // Alias @ to src/ for consistent imports
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
