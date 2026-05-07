#!/usr/bin/env node
/**
 * reset-onboarding.mjs
 *
 * Wipes onboarding state from userData so `npm start` re-triggers onboarding.
 * Deletes: account.json, sessions.db (+ WAL/SHM), imported Electron cookies,
 * and whatsapp-auth/.
 *
 * IMPORTANT: Quit the app first. If the app is running, SQLite holds the
 * sessions.db inode open and unlinking does nothing to the live data.
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readProductName() {
  const pkg = JSON.parse(
    readFileSync(resolve(__dirname, "..", "package.json"), "utf-8"),
  );
  return pkg.productName ?? pkg.name ?? "app";
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

console.log(`[reset-onboarding] productName=${productName}`);
console.log(`[reset-onboarding] userData=${userData}`);

if (isAppRunning(productName)) {
  console.error(`[reset-onboarding] ERROR: ${productName} is still running. Quit it first (Cmd+Q) — otherwise SQLite keeps sessions.db alive via the open inode.`);
  process.exit(1);
}

const targets = [
  ["account.json", join(userData, "account.json")],
  ["sessions.db", join(userData, "sessions.db")],
  ["sessions.db-wal", join(userData, "sessions.db-wal")],
  ["sessions.db-shm", join(userData, "sessions.db-shm")],
  ["Cookies", join(userData, "Cookies")],
  ["Cookies-journal", join(userData, "Cookies-journal")],
  ["whatsapp-auth", join(userData, "whatsapp-auth")],
];

for (const [label, filePath] of targets) {
  if (existsSync(filePath)) {
    rmSync(filePath, { recursive: true, force: true });
    console.log(`[reset-onboarding] deleted ${label}`);
  } else {
    console.log(`[reset-onboarding] ${label} not found (already clean)`);
  }
}

console.log(
  "[reset-onboarding] run `npm start` — the onboarding window will appear on next launch.",
);
