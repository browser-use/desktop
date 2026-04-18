/**
 * Shared Electron launcher helper for Playwright E2E tests.
 *
 * Wraps `_electron.launch()` with:
 * - Correct path to the built main.js entry point (.vite/build/main.js)
 * - Isolated userData dir per test run (prevents session bleed)
 * - Verbose startup logging
 * - Clean teardown helper
 *
 * Usage in specs:
 *   import { launchApp, teardownApp, AppHandle } from '../setup/electron-launcher';
 *
 *   let app: AppHandle;
 *   test.beforeAll(async () => { app = await launchApp(); });
 *   test.afterAll(async () => { await teardownApp(app); });
 *
 * ---------------------------------------------------------------------------
 * CRITICAL: DO NOT PASS executablePath
 * ---------------------------------------------------------------------------
 * Playwright's `_electron.launch()` ONLY injects its internal `-r <loader>`
 * bootstrap arg when `executablePath` is NOT set. The loader hijacks
 * `app.whenReady()` and signals `__playwright_run` back to the test harness.
 * Passing `executablePath` skips the loader → `launch()` hangs for the full
 * timeout (30s) even though the Electron process starts correctly.
 *
 * Playwright uses `require('electron/index.js')` internally to resolve the
 * local electron binary — the same path that `node_modules/.bin/electron`
 * points to — just with the bootstrap loader wired in.
 *
 * See: https://github.com/microsoft/playwright/blob/main/packages/playwright/src/electron/electron.ts
 */

import { _electron as electron, ElectronApplication, Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { MY_APP_DIR } from './playwright.config';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = '[ElectronLauncher]';
const LAUNCH_TIMEOUT_MS = 30_000;

/** Entry point — built by `npm run build` (Electron Forge's vite build). */
const MAIN_JS_ENTRY = path.join(MY_APP_DIR, '.vite', 'build', 'main.js');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LaunchOptions {
  /**
   * Override the built main.js entry. Defaults to
   * `my-app/.vite/build/main.js`. Useful for integration tests that launch
   * a development entry point.
   */
  mainEntry?: string;
  /**
   * Override userData directory. If not set, a fresh temp dir is created for
   * each launch to provide full test isolation.
   */
  userDataDir?: string;
  /**
   * Extra environment variables to pass to the Electron process.
   */
  env?: Record<string, string>;
  /**
   * Extra args forwarded to the app (after the entry point).
   */
  args?: string[];
}

export interface AppHandle {
  electronApp: ElectronApplication;
  /** First BrowserWindow page (shell or onboarding) */
  firstWindow: Page;
  /** Ephemeral userData dir created for this launch (cleaned up by teardownApp) */
  userDataDir: string;
  /** Whether the userDataDir was created by the launcher (should be deleted on teardown) */
  cleanupUserData: boolean;
}

// ---------------------------------------------------------------------------
// launchApp
// ---------------------------------------------------------------------------

/**
 * Launch the Electron application for E2E testing.
 * Returns an AppHandle with the running ElectronApplication and first window.
 *
 * NOTE: Tests run against the vite-built main.js. Run `npm run build`
 * (or `npm run package`) in my-app/ before executing e2e tests.
 */
export async function launchApp(opts: LaunchOptions = {}): Promise<AppHandle> {
  const mainEntry = opts.mainEntry ?? MAIN_JS_ENTRY;

  if (!fs.existsSync(mainEntry)) {
    throw new Error(
      `${LOG_PREFIX} Built main.js not found at ${mainEntry}. ` +
        `Run \`npm run build\` in my-app/ before running E2E tests.`,
    );
  }

  let cleanupUserData = false;
  let userDataDir = opts.userDataDir ?? '';
  if (!userDataDir) {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agb-test-'));
    cleanupUserData = true;
    console.log(`${LOG_PREFIX} Created ephemeral userData: ${userDataDir}`);
  }

  console.log(`${LOG_PREFIX} Launching with main entry: ${mainEntry}`);
  console.log(`${LOG_PREFIX} userData: ${userDataDir}`);

  const launchEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
    // Force dev mode so agentic://diagnostics is available
    DEV_MODE: '1',
    // Prevent system keychain dialogs in CI
    KEYCHAIN_MOCK: '1',
    // Ensure telemetry writes locally only
    POSTHOG_API_KEY: '',
    ...opts.env,
  };

  // CRITICAL: DO NOT pass executablePath here — see file header.
  // Playwright resolves electron via `require('electron/index.js')` and
  // injects its loader that signals __playwright_run.
  const electronApp = await electron.launch({
    args: [
      mainEntry,
      `--user-data-dir=${userDataDir}`,
      '--no-sandbox',
      '--disable-gpu',
      '--remote-debugging-port=0',
      ...(opts.args ?? []),
    ],
    env: launchEnv,
    timeout: LAUNCH_TIMEOUT_MS,
    cwd: MY_APP_DIR,
  });

  console.log(`${LOG_PREFIX} App launched. Waiting for first window...`);

  const firstWindow = await electronApp.firstWindow();
  await firstWindow.waitForLoadState('domcontentloaded');

  console.log(
    `${LOG_PREFIX} First window ready. Title: "${await firstWindow.title()}"`,
  );

  return { electronApp, firstWindow, userDataDir, cleanupUserData };
}

// ---------------------------------------------------------------------------
// teardownApp
// ---------------------------------------------------------------------------

/**
 * Gracefully close the Electron app and clean up ephemeral userData.
 */
export async function teardownApp(handle: AppHandle): Promise<void> {
  console.log(`${LOG_PREFIX} Tearing down app...`);
  try {
    await handle.electronApp.close();
  } catch (err) {
    console.warn(`${LOG_PREFIX} Close error (ignored): ${(err as Error).message}`);
  }

  if (handle.cleanupUserData && handle.userDataDir) {
    try {
      fs.rmSync(handle.userDataDir, { recursive: true, force: true });
      console.log(`${LOG_PREFIX} Cleaned up userData: ${handle.userDataDir}`);
    } catch (err) {
      console.warn(`${LOG_PREFIX} Failed to clean userData: ${(err as Error).message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Utility: evaluate in main process
// ---------------------------------------------------------------------------

/**
 * Execute a function in the Electron main process and return its result.
 * Useful for asserting IPC state, reading session files, etc.
 */
export async function evalInMain<T>(
  handle: AppHandle,
  fn: () => T,
): Promise<T> {
  return handle.electronApp.evaluate(fn);
}
