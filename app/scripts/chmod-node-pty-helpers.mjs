#!/usr/bin/env node
/**
 * Restore the executable bit on node-pty's spawn-helper binaries.
 *
 * yarn strips executable bits when unpacking prebuilt tarballs, so node-pty
 * throws `posix_spawnp failed` on first use until we chmod the helpers back.
 * Run as a postinstall hook and also from the Electron Forge packageAfterPrune
 * step so a freshly-built .app also ships executable helpers.
 *
 * Non-POSIX platforms (Windows) have no spawn-helper — the no-match glob is
 * a silent no-op.
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
// Default to the app's own node_modules but accept an override so
// packageAfterPrune can point this at the Forge build dir.
const root = process.argv[2] ?? path.resolve(__dirname, '..');

const prebuildsDir = path.join(root, 'node_modules', 'node-pty', 'prebuilds');
if (!fs.existsSync(prebuildsDir)) {
  // node-pty not installed here — this is expected e.g. when the script
  // runs before deps exist. Bail silently.
  process.exit(0);
}

let fixed = 0;
for (const entry of fs.readdirSync(prebuildsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const helper = path.join(prebuildsDir, entry.name, 'spawn-helper');
  if (fs.existsSync(helper)) {
    try {
      fs.chmodSync(helper, 0o755);
      fixed++;
    } catch (err) {
      console.warn(`[chmod-node-pty] failed on ${helper}: ${err.message}`);
    }
  }
}

if (fixed > 0) console.log(`[chmod-node-pty] restored exec bit on ${fixed} spawn-helper binaries`);
