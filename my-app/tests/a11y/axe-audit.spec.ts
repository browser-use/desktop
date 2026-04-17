/**
 * axe-audit.spec.ts — axe-core accessibility audit across all reachable renderers.
 *
 * Screens audited (when axe-core is available):
 *   shell-empty          — shell window, no tabs open
 *   onboarding-welcome   — onboarding screen 1
 *   onboarding-naming    — onboarding screen 2 (agent name input)
 *   onboarding-account   — onboarding screen 3 (Google sign-in)
 *   pill-idle            — pill overlay, idle state
 *   settings-api-key     — settings window, API Key tab
 *
 * Reports written to: tests/a11y/reports/<screen>-axe.json
 *
 * axe-core is injected via page.evaluate so no @axe-core/playwright package is
 * needed — only the `axe-core` npm package (provides axe.js / axe.min.js).
 *
 * HOW TO UNBLOCK:
 *   1. Add axe-core to devDependencies:
 *        npm install --save-dev axe-core
 *   2. Delete (or comment out) the test.skip block at the bottom.
 *   3. Un-comment the real test suite above it.
 *   4. Run:  cd my-app && npx playwright test tests/a11y/ --reporter=list
 *
 * Track H Test Engineer owns this file.
 */

import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MY_APP_ROOT = path.resolve(__dirname, '../..');
const REPORTS_DIR = path.join(__dirname, 'reports');
const AXE_JS_PATH = path.join(MY_APP_ROOT, 'node_modules', 'axe-core', 'axe.js');
const ELECTRON_BIN = path.join(MY_APP_ROOT, 'node_modules', '.bin', 'electron');
const MAIN_JS = path.join(MY_APP_ROOT, '.vite', 'build', 'main.js');

/** Severity levels that cause test failure */
const FAIL_SEVERITIES = ['critical', 'serious'] as const;

const COMPLETED_ACCOUNT = JSON.stringify({
  agent_name: 'Aria',
  email: 'aria@example.com',
  created_at: '2026-01-01T00:00:00.000Z',
  onboarding_completed_at: '2026-01-01T00:00:00.000Z',
});

// ---------------------------------------------------------------------------
// axe-core availability check
// ---------------------------------------------------------------------------

const AXE_AVAILABLE = fs.existsSync(AXE_JS_PATH);

// ---------------------------------------------------------------------------
// Placeholder: axe-core not installed
//
// The no-new-deps rule prevents installing axe-core without explicit approval.
// This placeholder test documents exactly what's needed to unblock the full
// audit suite — it passes (as a skip) so the commit goes green.
// ---------------------------------------------------------------------------

test.skip(!AXE_AVAILABLE, 'axe-core not installed — run: npm install --save-dev axe-core');

test('axe-audit: install axe-core or @axe-core/playwright first', async () => {
  // This test only runs when AXE_AVAILABLE is false (i.e. it is always skipped
  // in the current environment).  When axe-core is installed this block will
  // be replaced by the real suite below.
  //
  // TODO: after `npm install --save-dev axe-core`:
  //   1. Remove this placeholder test.
  //   2. Un-comment the REAL SUITE section below.
  //   3. Run: npx playwright test tests/a11y/ --reporter=list
  test.skip(true, 'axe-core not installed — run: npm install --save-dev axe-core');
});

// ===========================================================================
// REAL SUITE — un-comment after installing axe-core
// ===========================================================================
//
// import type { AxeResults, Result } from 'axe-core';
//
// ---------------------------------------------------------------------------
// Launch helpers (mirrors capture.spec.ts pattern)
// ---------------------------------------------------------------------------
//
// async function launchApp(opts: {
//   prefix: string;
//   accountJson?: string;
//   extraEnv?: Record<string, string>;
// }): Promise<{ electronApp: ElectronApplication; page: Page; userDataDir: string }> {
//   const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `a11y-${opts.prefix}-`));
//   if (opts.accountJson) {
//     fs.writeFileSync(path.join(userDataDir, 'account.json'), opts.accountJson, 'utf-8');
//   }
//   const electronApp = await electron.launch({
//     executablePath: ELECTRON_BIN,
//     args: [MAIN_JS, `--user-data-dir=${userDataDir}`, '--no-sandbox', '--disable-gpu'],
//     env: {
//       ...(process.env as Record<string, string>),
//       NODE_ENV: 'test',
//       DEV_MODE: '1',
//       KEYCHAIN_MOCK: '1',
//       POSTHOG_API_KEY: '',
//       ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
//       ...opts.extraEnv,
//     },
//     timeout: 30_000,
//     cwd: MY_APP_ROOT,
//   });
//   const page = await electronApp.firstWindow();
//   await page.waitForLoadState('domcontentloaded');
//   return { electronApp, page, userDataDir };
// }
//
// async function teardown(electronApp: ElectronApplication, userDataDir: string): Promise<void> {
//   try { await electronApp.close(); } catch { /* no-op */ }
//   try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* no-op */ }
// }
//
// ---------------------------------------------------------------------------
// axe inject + run helper
// ---------------------------------------------------------------------------
//
// async function runAxe(page: Page, screenName: string): Promise<AxeResults> {
//   const axeSource = fs.readFileSync(AXE_JS_PATH, 'utf-8');
//   await page.evaluate(axeSource);
//   const results: AxeResults = await page.evaluate(() =>
//     (window as unknown as { axe: { run(): Promise<AxeResults> } }).axe.run()
//   );
//
//   // Write full report JSON
//   fs.mkdirSync(REPORTS_DIR, { recursive: true });
//   const reportPath = path.join(REPORTS_DIR, `${screenName}-axe.json`);
//   fs.writeFileSync(reportPath, JSON.stringify(results, null, 2), 'utf-8');
//   console.log(`[a11y] Report written: ${reportPath}`);
//
//   return results;
// }
//
// function getFailingViolations(results: AxeResults): Result[] {
//   return results.violations.filter((v) =>
//     (FAIL_SEVERITIES as readonly string[]).includes(v.impact ?? '')
//   );
// }
//
// ---------------------------------------------------------------------------
// Test: shell-empty
// ---------------------------------------------------------------------------
//
// test('axe-audit: shell-empty', async () => {
//   const { electronApp, page, userDataDir } = await launchApp({
//     prefix: 'shell',
//     accountJson: COMPLETED_ACCOUNT,
//     extraEnv: { SKIP_ONBOARDING: '1' },
//   });
//   try {
//     await page.waitForSelector('#root', { timeout: 10_000 });
//     const results = await runAxe(page, 'shell-empty');
//     const failing = getFailingViolations(results);
//     expect(failing, `${failing.length} critical/serious violations on shell-empty:\n${JSON.stringify(failing, null, 2)}`).toHaveLength(0);
//   } finally {
//     await teardown(electronApp, userDataDir);
//   }
// });
//
// test('axe-audit: onboarding-welcome', async () => {
//   const { electronApp, page, userDataDir } = await launchApp({ prefix: 'onboarding-welcome' });
//   try {
//     await page.waitForSelector('.onboarding-root, .cta-button', { timeout: 10_000 });
//     const results = await runAxe(page, 'onboarding-welcome');
//     const failing = getFailingViolations(results);
//     expect(failing, `${failing.length} critical/serious violations on onboarding-welcome:\n${JSON.stringify(failing, null, 2)}`).toHaveLength(0);
//   } finally {
//     await teardown(electronApp, userDataDir);
//   }
// });
//
// test('axe-audit: onboarding-naming', async () => {
//   const { electronApp, page, userDataDir } = await launchApp({ prefix: 'onboarding-naming' });
//   try {
//     await page.waitForSelector('.cta-button', { timeout: 10_000 });
//     await page.locator('.cta-button').first().click();
//     await page.waitForSelector('input[type="text"]', { timeout: 10_000 });
//     const results = await runAxe(page, 'onboarding-naming');
//     const failing = getFailingViolations(results);
//     expect(failing, `${failing.length} violations on onboarding-naming`).toHaveLength(0);
//   } finally {
//     await teardown(electronApp, userDataDir);
//   }
// });
//
// test('axe-audit: onboarding-account', async () => {
//   const { electronApp, page, userDataDir } = await launchApp({ prefix: 'onboarding-account' });
//   try {
//     await page.waitForSelector('.cta-button', { timeout: 10_000 });
//     await page.locator('.cta-button').first().click();
//     const nameInput = page.locator('input[type="text"]').first();
//     await nameInput.fill('Aria');
//     await nameInput.press('Enter');
//     await page.waitForSelector('[data-testid="continue-with-google"], .google-btn', { timeout: 10_000 });
//     const results = await runAxe(page, 'onboarding-account');
//     const failing = getFailingViolations(results);
//     expect(failing, `${failing.length} violations on onboarding-account`).toHaveLength(0);
//   } finally {
//     await teardown(electronApp, userDataDir);
//   }
// });
//
// test('axe-audit: pill-idle', async () => {
//   const { electronApp, page, userDataDir } = await launchApp({
//     prefix: 'pill',
//     accountJson: COMPLETED_ACCOUNT,
//     extraEnv: { SKIP_ONBOARDING: '1' },
//   });
//   try {
//     await page.waitForSelector('#root', { timeout: 10_000 });
//     await electronApp.evaluate(() => {
//       try {
//         const { BrowserWindow } = require('electron');
//         BrowserWindow.getAllWindows().forEach((w: Electron.BrowserWindow) => w.webContents.send('pill:toggle'));
//       } catch { /* no-op */ }
//     });
//     await page.waitForTimeout(500);
//     const windows = electronApp.windows();
//     let pillPage: Page | null = null;
//     for (const win of windows) {
//       if (win.url().includes('pill')) { pillPage = win; break; }
//     }
//     const auditPage = pillPage ?? page;
//     const results = await runAxe(auditPage, 'pill-idle');
//     const failing = getFailingViolations(results);
//     expect(failing, `${failing.length} violations on pill-idle`).toHaveLength(0);
//   } finally {
//     await teardown(electronApp, userDataDir);
//   }
// });
//
// test('axe-audit: settings-api-key', async () => {
//   const { electronApp, page, userDataDir } = await launchApp({
//     prefix: 'settings',
//     accountJson: COMPLETED_ACCOUNT,
//     extraEnv: { SKIP_ONBOARDING: '1' },
//   });
//   try {
//     await page.waitForSelector('#root', { timeout: 10_000 });
//     await electronApp.evaluate(({ Menu, BrowserWindow }) => {
//       const menu = Menu.getApplicationMenu();
//       if (!menu) return;
//       const win = BrowserWindow.getAllWindows()[0];
//       function findAndClick(items: Electron.MenuItem[]): boolean {
//         for (const item of items) {
//           if (item.label?.includes('Settings')) { item.click(undefined, win, undefined); return true; }
//           if (item.submenu && findAndClick(item.submenu.items)) return true;
//         }
//         return false;
//       }
//       findAndClick(menu.items);
//     });
//     await page.waitForTimeout(2_000);
//     const windows = electronApp.windows();
//     let settingsPage: Page | null = null;
//     for (const win of windows) {
//       if (win.url().includes('settings')) { settingsPage = win; break; }
//     }
//     if (!settingsPage) throw new Error('Settings window did not open');
//     await settingsPage.waitForSelector('.settings-shell', { timeout: 10_000 });
//     const results = await runAxe(settingsPage, 'settings-api-key');
//     const failing = getFailingViolations(results);
//     expect(failing, `${failing.length} violations on settings-api-key`).toHaveLength(0);
//   } finally {
//     await teardown(electronApp, userDataDir);
//   }
// });
