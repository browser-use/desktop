/**
 * Browser harness — plain Node library. The agent edits this file.
 *
 * Usage (agent writes scripts like this):
 *
 *   const H = require('./helpers.js');
 *   const ctx = await H.createContext(); // reads BU_TARGET_ID / BU_CDP_PORT
 *   await H.goto(ctx, 'https://example.com');
 *   await H.waitForLoad(ctx);
 *   console.log(await H.pageInfo(ctx));
 *   await ctx.close();
 *
 * Environment:
 *   BU_TARGET_ID   required — the CDP target the agent must drive
 *   BU_CDP_PORT    required — defaults to 9222 if unset
 */

const path = require('node:path');
const fs = require('node:fs/promises');
const http = require('node:http');
const { exec: execCb } = require('node:child_process');
const { promisify } = require('node:util');

const execAsync = promisify(execCb);

const INTERNAL_URL_PREFIXES = [
  'chrome://', 'chrome-extension://', 'devtools://', 'chrome-error://',
  'chrome-search://', 'chrome-untrusted://', 'view-source:', 'about:',
  'edge://', 'file://',
];

// ─── CDP WebSocket client ───────────────────────────────────────────────────
function jsonFetch(port, pathPart) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: pathPart }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('CDP HTTP timeout')));
  });
}

async function resolveTargetWsUrl(port, targetId) {
  const targets = await jsonFetch(port, '/json/list');
  const match = targets.find((t) => t.id === targetId);
  if (!match) throw new Error(`CDP target ${targetId} not found on port ${port}`);
  if (!match.webSocketDebuggerUrl) throw new Error(`CDP target ${targetId} has no webSocketDebuggerUrl`);
  return match.webSocketDebuggerUrl;
}

// Cross-API WebSocket subscribe: Node 22+ native WebSocket uses
// addEventListener (with Event-wrapped payloads); the `ws` npm package
// uses EventEmitter .on() (with raw payloads). Normalize both to a
// single (data) => ... callback.
function wsOn(ws, event, handler) {
  if (typeof ws.addEventListener === 'function') {
    ws.addEventListener(event, (e) => handler(event === 'message' ? e.data : e));
  } else if (typeof ws.on === 'function') {
    ws.on(event, handler);
  }
}

class CdpSession {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.maxEvents = 500;
    wsOn(ws, 'message', (raw) => {
      let msg;
      try { msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString()); } catch { return; }
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`CDP ${msg.error.message ?? JSON.stringify(msg.error)}`));
        else p.resolve(msg.result ?? {});
      } else if (msg.method) {
        this.events.push({ method: msg.method, params: msg.params });
        if (this.events.length > this.maxEvents) this.events.shift();
      }
    });
    wsOn(ws, 'close', () => {
      for (const p of this.pending.values()) p.reject(new Error('CDP websocket closed'));
      this.pending.clear();
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try { this.ws.close(); } catch { /* already closed */ }
  }
}

/**
 * Open a CDP session to the agent's assigned browser target.
 * Reads BU_TARGET_ID (required) and BU_CDP_PORT (default 9222) from env.
 * Returns an opaque ctx. Call ctx.close() when done (usually at script end).
 */
async function createContext(opts = {}) {
  const targetId = opts.targetId ?? process.env.BU_TARGET_ID;
  const port = Number(opts.port ?? process.env.BU_CDP_PORT ?? 9222);
  if (!targetId) throw new Error('createContext: BU_TARGET_ID env var or opts.targetId is required');

  const wsUrl = await resolveTargetWsUrl(port, targetId);

  // Node 22+ has WebSocket as a global. Use that; fall back to `ws` package.
  let WebSocketCtor = globalThis.WebSocket;
  if (!WebSocketCtor) {
    try { WebSocketCtor = require('ws'); } catch { /* no ws package */ }
  }
  if (!WebSocketCtor) throw new Error('No WebSocket available (Node ≥22 or `ws` package needed)');

  const ws = new WebSocketCtor(wsUrl);
  await new Promise((resolve, reject) => {
    const onOpen = () => { cleanup(); resolve(); };
    const onError = (err) => { cleanup(); reject(err instanceof Error ? err : new Error(String(err))); };
    function cleanup() {
      ws.removeEventListener?.('open', onOpen); ws.removeEventListener?.('error', onError);
      ws.off?.('open', onOpen); ws.off?.('error', onError);
    }
    ws.addEventListener?.('open', onOpen); ws.addEventListener?.('error', onError);
    ws.on?.('open', onOpen); ws.on?.('error', onError);
  });

  const session = new CdpSession(ws);
  // Enable the common domains so events flow.
  await session.send('Page.enable').catch(() => {});
  await session.send('DOM.enable').catch(() => {});
  await session.send('Runtime.enable').catch(() => {});
  await session.send('Network.enable').catch(() => {});

  return {
    targetId,
    port,
    events: session.events,
    cdp: {
      send: (method, params) => session.send(method, params),
      transport: 'ws',
    },
    close: () => session.close(),
  };
}

// ─── navigation ─────────────────────────────────────────────────────────────
async function goto(ctx, url) {
  return ctx.cdp.send('Page.navigate', { url });
}

async function pageInfo(ctx) {
  const pendingDialog = ctx.events.find((e) => e.method === 'Page.javascriptDialogOpening');
  if (pendingDialog) return { dialog: pendingDialog.params };
  const expr = 'JSON.stringify({url:location.href,title:document.title,w:innerWidth,h:innerHeight,sx:scrollX,sy:scrollY,pw:document.documentElement.scrollWidth,ph:document.documentElement.scrollHeight})';
  const r = await ctx.cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true });
  return JSON.parse(r.result.value);
}

// ─── input ──────────────────────────────────────────────────────────────────
async function click(ctx, x, y, button = 'left', clicks = 1) {
  await ctx.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: clicks });
  await ctx.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: clicks });
}

async function typeText(ctx, text) {
  await ctx.cdp.send('Input.insertText', { text });
}

const _KEYS = {
  'Enter': [13, 'Enter', '\r'], 'Tab': [9, 'Tab', '\t'], 'Backspace': [8, 'Backspace', ''],
  'Escape': [27, 'Escape', ''], 'Delete': [46, 'Delete', ''], ' ': [32, 'Space', ' '],
  'ArrowLeft': [37, 'ArrowLeft', ''], 'ArrowUp': [38, 'ArrowUp', ''],
  'ArrowRight': [39, 'ArrowRight', ''], 'ArrowDown': [40, 'ArrowDown', ''],
  'Home': [36, 'Home', ''], 'End': [35, 'End', ''],
  'PageUp': [33, 'PageUp', ''], 'PageDown': [34, 'PageDown', ''],
};

async function pressKey(ctx, key, modifiers = 0) {
  const [vk, code, text] = _KEYS[key] ?? [key.length === 1 ? key.charCodeAt(0) : 0, key, key.length === 1 ? key : ''];
  const base = { key, code, modifiers, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
  await ctx.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(text ? { text } : {}) });
  if (text && text.length === 1) await ctx.cdp.send('Input.dispatchKeyEvent', { type: 'char', text, ...base });
  await ctx.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

async function scroll(ctx, x, y, dy = -300, dx = 0) {
  await ctx.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: dx, deltaY: dy });
}

// ─── visual ─────────────────────────────────────────────────────────────────
async function screenshot(ctx, outPath, full = false) {
  const r = await ctx.cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full });
  if (outPath) { await fs.writeFile(outPath, Buffer.from(r.data, 'base64')); return { path: outPath, bytes: r.data.length }; }
  return { data: r.data, bytes: r.data.length };
}

// ─── utility ────────────────────────────────────────────────────────────────
async function wait(_ctx, seconds = 1.0) {
  return new Promise((r) => setTimeout(r, Math.max(0, seconds) * 1000));
}

async function waitForLoad(ctx, timeoutSec = 15.0) {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    if ((await js(ctx, 'document.readyState')) === 'complete') return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function js(ctx, expression) {
  const r = await ctx.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value;
}

async function callFunction(ctx, functionDeclaration, args = []) {
  const global = await ctx.cdp.send('Runtime.evaluate', { expression: 'globalThis', returnByValue: false });
  const objectId = global.result?.objectId;
  if (!objectId) throw new Error('Runtime.evaluate did not return globalThis objectId');
  try {
    const r = await ctx.cdp.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration,
      arguments: args.map((value) => ({ value })),
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result?.value;
  } finally {
    await ctx.cdp.send('Runtime.releaseObject', { objectId }).catch(() => {});
  }
}

async function reactSetValue(ctx, selector, value) {
  await callFunction(ctx, function setReactValue(selectorArg, valueArg) {
    const el = document.querySelector(selectorArg);
    if (!el) throw new Error(`no element for ${selectorArg}`);
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
    if (descriptor?.set) {
      descriptor.set.call(el, valueArg);
    } else {
      el.value = valueArg;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }.toString(), [selector, value]);
}

async function dispatchKey(ctx, selector, key = 'Enter', event = 'keypress') {
  const _KC = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, ' ': 32, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
  const kc = _KC[key] ?? (key.length === 1 ? key.charCodeAt(0) : 0);
  await callFunction(ctx, function dispatchDomKey(selectorArg, keyArg, eventArg, keyCodeArg) {
    const el = document.querySelector(selectorArg);
    if (!el) return;
    el.focus();
    el.dispatchEvent(new KeyboardEvent(eventArg, {
      key: keyArg,
      code: keyArg,
      keyCode: keyCodeArg,
      which: keyCodeArg,
      bubbles: true,
    }));
  }.toString(), [selector, key, event, kc]);
}

async function uploadFile(ctx, selector, paths) {
  const doc = await ctx.cdp.send('DOM.getDocument', { depth: -1 });
  const q = await ctx.cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector });
  if (!q.nodeId) throw new Error(`no element for ${selector}`);
  const files = Array.isArray(paths) ? paths : [paths];
  await ctx.cdp.send('DOM.setFileInputFiles', { files, nodeId: q.nodeId });
}

async function captureDialogs(ctx) {
  await callFunction(ctx, function capturePageDialogs() {
    window.__dialogs__ = [];
    window.alert = (message) => window.__dialogs__.push(String(message));
    window.confirm = (message) => {
      window.__dialogs__.push(String(message));
      return true;
    };
    window.prompt = (message, defaultValue) => {
      window.__dialogs__.push(String(message));
      return defaultValue || '';
    };
  }.toString());
}

async function dialogs(ctx) {
  const raw = await js(ctx, 'JSON.stringify(window.__dialogs__||[])');
  return JSON.parse(raw || '[]');
}

// ─── http ───────────────────────────────────────────────────────────────────
async function httpGet(_ctx, url, headers, timeoutMs = 20_000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  const h = { 'User-Agent': 'Mozilla/5.0', 'Accept-Encoding': 'gzip', ...(headers ?? {}) };
  try {
    const r = await fetch(url, { headers: h, signal: ctl.signal });
    return { status: r.status, body: await r.text() };
  } finally { clearTimeout(t); }
}

module.exports = {
  createContext,
  goto, pageInfo, click, typeText, pressKey, scroll, screenshot,
  wait, waitForLoad, js, reactSetValue, dispatchKey, uploadFile,
  captureDialogs, dialogs, httpGet,
  INTERNAL_URL_PREFIXES,
};
