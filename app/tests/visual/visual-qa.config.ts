/**
 * Playwright configuration for visual QA tests.
 *
 * Extends the existing E2E harness at tests/setup/.
 * - Headless: false (Electron requires a display; use headless Electron where available)
 * - Deterministic viewport: 1280×800 at deviceScaleFactor 1
 * - Reduced motion: yes (CSS prefers-reduced-motion: reduce injected at page level)
 * - Serial execution: Electron tests share the display
 * - Timeout: 60s per test (screenshot + analysis budget)
 *
 * Run:
 *   npx playwright test --config=tests/visual/visual-qa.config.ts
 *
 * Track H Visual QA owns this file.
 */

import { defineConfig } from '@playwright/test';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, '../../..');
const MY_APP_ROOT = path.join(REPO_ROOT, 'app');
const RESULTS_DIR = path.join(MY_APP_ROOT, 'tests', 'results');

function getElectronAppPath(): string {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return path.join(
    MY_APP_ROOT,
    'out',
    `app-darwin-${arch}`,
    'app.app',
    'Contents',
    'MacOS',
    'app',
  );
}

export const ELECTRON_APP_PATH = getElectronAppPath();
export const MY_APP_DIR = MY_APP_ROOT;

/** Viewport dimensions for all visual captures */
export const VIEWPORT = { width: 1280, height: 800 } as const;

/** How long to wait after navigation/state change before screenshotting */
export const SETTLE_MS = 600;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export default defineConfig({
  testDir: path.join(MY_APP_ROOT, 'tests', 'visual'),
  testMatch: ['capture.spec.ts'],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(RESULTS_DIR, 'visual-qa-playwright.json') }],
  ],
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'visual-qa',
      testMatch: 'capture.spec.ts',
    },
  ],
});
