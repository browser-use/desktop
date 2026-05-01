#!/usr/bin/env node
/**
 * reset-sessions.mjs
 *
 * Wipes only persisted agent sessions from userData so the next launch shows
 * an empty sessions list. Keeps onboarding/account state and WhatsApp auth.
 *
 * IMPORTANT: Quit the app first. If the app is running, SQLite can keep the
 * sessions.db inode open and unlinking does nothing to the live data.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readProductName() {
  const pkg = JSON.parse(
    readFileSync(resolve(__dirname, "..", "package.json"), "utf-8"),
  );
  return pkg.productName ?? pkg.name ?? "my-app";
}

function defaultUserDataDir(productName) {
  switch (process.platform) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", productName);
    case "win32":
      return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), productName);
    default:
      return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), productName);
  }
}

function isAppRunning(productName) {
  if (process.platform !== "darwin") return false;
  try {
    const out = execSync(`pgrep -fl "${productName}.app" || true`, { encoding: "utf-8" });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

const productName = readProductName();
const userData = defaultUserDataDir(productName);

console.log(`[reset-sessions] productName=${productName}`);
console.log(`[reset-sessions] userData=${userData}`);

if (isAppRunning(productName)) {
  console.error(`[reset-sessions] ERROR: ${productName} is still running. Quit it first (Cmd+Q) so SQLite releases sessions.db.`);
  process.exit(1);
}

const targets = [
  ["sessions.db", join(userData, "sessions.db")],
  ["sessions.db-wal", join(userData, "sessions.db-wal")],
  ["sessions.db-shm", join(userData, "sessions.db-shm")],
];

for (const [label, filePath] of targets) {
  if (existsSync(filePath)) {
    rmSync(filePath, { force: true });
    console.log(`[reset-sessions] deleted ${label}`);
  } else {
    console.log(`[reset-sessions] ${label} not found (already clean)`);
  }
}

console.log("[reset-sessions] run `npm start` — the sessions list will be empty on next launch.");
