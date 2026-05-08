#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTROL_FILE = "local-task-server.json";

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

function usage() {
  console.error(`Usage: node app/scripts/run-task.mjs [--engine <id>] [--json] <prompt>

Submits a task to a running Browser Use Desktop app through the local control
endpoint. Start the app first with: task up
`);
}

function parseArgs(argv) {
  let engine;
  let json = false;
  let userDataDir = process.env.AGB_USER_DATA_DIR;
  let controlFile;
  const promptParts = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--engine") {
      engine = argv[++i];
      continue;
    }
    if (arg?.startsWith("--engine=")) {
      engine = arg.slice("--engine=".length);
      continue;
    }
    if (arg === "--user-data-dir") {
      userDataDir = argv[++i];
      continue;
    }
    if (arg?.startsWith("--user-data-dir=")) {
      userDataDir = arg.slice("--user-data-dir=".length);
      continue;
    }
    if (arg === "--control-file") {
      controlFile = argv[++i];
      continue;
    }
    if (arg?.startsWith("--control-file=")) {
      controlFile = arg.slice("--control-file=".length);
      continue;
    }
    promptParts.push(arg);
  }

  const prompt = promptParts.join(" ").trim() || process.env.PROMPT?.trim();
  if (!prompt) {
    usage();
    process.exit(2);
  }

  return { prompt, engine, json, userDataDir, controlFile };
}

function readControl(opts) {
  const userData = opts.userDataDir || defaultUserDataDir(readProductName());
  const controlPath = opts.controlFile || join(userData, CONTROL_FILE);
  if (!existsSync(controlPath)) {
    throw new Error(`Local task server is not running. Expected ${controlPath}. Start the app with: task up`);
  }
  const control = JSON.parse(readFileSync(controlPath, "utf-8"));
  if (!control.url || !control.token) {
    throw new Error(`Invalid local task control file: ${controlPath}`);
  }
  return { control, controlPath };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { control, controlPath } = readControl(opts);
  const res = await fetch(`${control.url}/tasks`, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${control.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      prompt: opts.prompt,
      engine: opts.engine,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false || body.started === false) {
    const message = body.error || `HTTP ${res.status}`;
    if (opts.json) {
      console.log(JSON.stringify({ ok: false, error: message, controlPath, ...body }, null, 2));
    } else {
      console.error(`[run-task] ERROR: ${message}`);
      if (body.id) console.error(`[run-task] session=${body.id}`);
    }
    process.exit(1);
  }

  if (opts.json) {
    console.log(JSON.stringify({ controlPath, ...body }, null, 2));
  } else {
    console.log(`[run-task] submitted session=${body.id}`);
    console.log(`[run-task] inspect logs: task logs:session SESSION_ID=${body.id}`);
  }
}

main().catch((err) => {
  console.error(`[run-task] ERROR: ${err.message}`);
  process.exit(1);
});
