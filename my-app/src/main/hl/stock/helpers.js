/**
 * Stock helpers — editable at runtime by the agent.
 *
 * Every helper takes `ctx` as the first argument (opaque to JS; TS-defined).
 * Export every helper via `module.exports.<name>`. The loader requires this
 * file fresh every iteration; new helpers you add are picked up immediately.
 *
 * When you add, modify, or remove a helper you MUST also update TOOLS.json
 * in the same turn so Anthropic sees the new tool schema on the next iteration.
 *
 * Keep helpers ≤15 lines, no classes — plain functions.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const { exec: execCb } = require('node:child_process');
const { promisify } = require('node:util');

const execAsync = promisify(execCb);
const MAX_READ_BYTES = 256 * 1024;
const MAX_EXEC_TIMEOUT = 30_000;
const MAX_OUTPUT_CHARS = 64_000;

const INTERNAL_URL_PREFIXES = [
  'chrome://', 'chrome-extension://', 'devtools://', 'chrome-error://',
  'chrome-search://', 'chrome-untrusted://', 'view-source:', 'about:',
  'edge://', 'file://',
];

// ─── cdp + meta ─────────────────────────────────────────────────────────────
async function cdp(ctx, method, params = {}, sessionId) {
  const sid = method.startsWith('Target.')
    ? null
    : (sessionId !== undefined ? sessionId : ctx.session);
  return ctx.cdp.send(method, params, sid ?? null);
}

function drainEvents(ctx) {
  const out = ctx.events.slice();
  ctx.events.length = 0;
  return out;
}

// ─── navigation ─────────────────────────────────────────────────────────────
async function goto(ctx, url) {
  const r = await cdp(ctx, 'Page.navigate', { url });
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '').split('.')[0];
    const skillDir = path.join(process.cwd(), 'domain-skills', hostname);
    const stat = await fs.stat(skillDir).catch(() => null);
    if (stat?.isDirectory()) {
      const files = await fs.readdir(skillDir);
      return { ...r, domain_skills: files.filter((f) => f.endsWith('.md')).slice(0, 10) };
    }
  } catch { /* no skills */ }
  return r;
}

async function pageInfo(ctx) {
  const pendingDialog = ctx.events.find((e) => e.method === 'Page.javascriptDialogOpening');
  if (pendingDialog) return { dialog: pendingDialog.params };
  const expr = 'JSON.stringify({url:location.href,title:document.title,w:innerWidth,h:innerHeight,sx:scrollX,sy:scrollY,pw:document.documentElement.scrollWidth,ph:document.documentElement.scrollHeight})';
  const r = await cdp(ctx, 'Runtime.evaluate', { expression: expr, returnByValue: true });
  return JSON.parse(r.result.value);
}

// ─── input ──────────────────────────────────────────────────────────────────
async function click(ctx, x, y, button = 'left', clicks = 1) {
  await cdp(ctx, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: clicks });
  await cdp(ctx, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: clicks });
}

async function typeText(ctx, text) {
  await cdp(ctx, 'Input.insertText', { text });
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
  await cdp(ctx, 'Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(text ? { text } : {}) });
  if (text && text.length === 1) await cdp(ctx, 'Input.dispatchKeyEvent', { type: 'char', text, ...base });
  await cdp(ctx, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

async function scroll(ctx, x, y, dy = -300, dx = 0) {
  await cdp(ctx, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: dx, deltaY: dy });
}

// ─── visual ─────────────────────────────────────────────────────────────────
async function screenshot(ctx, outPath, full = false) {
  const r = await cdp(ctx, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: full });
  if (outPath) { await fs.writeFile(outPath, Buffer.from(r.data, 'base64')); return { data: r.data, path: outPath }; }
  return { data: r.data };
}

// ─── tabs ───────────────────────────────────────────────────────────────────
function isWebContents(ctx) { return ctx.cdp.transport === 'webcontents'; }

async function listTabs(ctx, includeChrome = false) {
  if (isWebContents(ctx)) return [{ targetId: 'webcontents', title: 'active', url: 'webcontents' }];
  const r = await cdp(ctx, 'Target.getTargets');
  const out = [];
  for (const t of r.targetInfos) {
    if (t.type !== 'page') continue;
    const url = t.url ?? '';
    if (!includeChrome && INTERNAL_URL_PREFIXES.some((p) => url.startsWith(p))) continue;
    out.push({ targetId: t.targetId, title: t.title ?? '', url });
  }
  return out;
}

async function currentTab(ctx) {
  if (isWebContents(ctx)) return { targetId: 'webcontents', title: 'active', url: 'webcontents' };
  const r = await cdp(ctx, 'Target.getTargetInfo');
  const t = r.targetInfo ?? { targetId: '', url: '', title: '' };
  return { targetId: t.targetId ?? '', title: t.title ?? '', url: t.url ?? '' };
}

async function switchTab(ctx, targetId) {
  if (isWebContents(ctx)) return 'webcontents';
  try { await cdp(ctx, 'Runtime.evaluate', { expression: "if(document.title.startsWith('\\u{1F7E2} '))document.title=document.title.slice(2)" }); } catch {}
  try {
    await Promise.race([
      cdp(ctx, 'Target.activateTarget', { targetId }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('activateTarget timeout')), 2000)),
    ]);
  } catch {}
  const r = await cdp(ctx, 'Target.attachToTarget', { targetId, flatten: true });
  ctx.session = r.sessionId;
  try { await cdp(ctx, 'Runtime.evaluate', { expression: "if(!document.title.startsWith('\\u{1F7E2}'))document.title='\\u{1F7E2} '+document.title" }); } catch {}
  return r.sessionId;
}

async function newTab(ctx, url = 'about:blank') {
  if (isWebContents(ctx)) {
    if (url !== 'about:blank') await goto(ctx, url);
    return 'webcontents';
  }
  const r = await cdp(ctx, 'Target.createTarget', { url: 'about:blank' });
  await switchTab(ctx, r.targetId);
  if (url !== 'about:blank') await goto(ctx, url);
  return r.targetId;
}

async function ensureRealTab(ctx) {
  if (isWebContents(ctx)) return { targetId: 'webcontents', title: 'active', url: 'webcontents' };
  const tabs = await listTabs(ctx);
  if (tabs.length === 0) return null;
  try {
    const cur = await currentTab(ctx);
    if (cur.url && !INTERNAL_URL_PREFIXES.some((p) => cur.url.startsWith(p))) return cur;
  } catch {}
  await switchTab(ctx, tabs[0].targetId);
  return tabs[0];
}

async function iframeTarget(ctx, urlSubstr) {
  if (isWebContents(ctx)) return null;
  const r = await cdp(ctx, 'Target.getTargets');
  const t = r.targetInfos.find((i) => i.type === 'iframe' && (i.url ?? '').includes(urlSubstr));
  return t ? t.targetId : null;
}

// ─── utility ────────────────────────────────────────────────────────────────
async function wait(_ctx, seconds = 1.0) {
  return new Promise((r) => setTimeout(r, Math.max(0, seconds) * 1000));
}

async function waitForLoad(ctx, timeoutSec = 15.0) {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    if ((await js(ctx, "document.readyState")) === 'complete') return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function js(ctx, expression, targetId) {
  let sid = null;
  if (targetId) {
    const a = await cdp(ctx, 'Target.attachToTarget', { targetId, flatten: true });
    sid = a.sessionId;
  }
  const r = await cdp(ctx, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sid);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value;
}

const _KC = {
  'Enter': 13, 'Tab': 9, 'Escape': 27, 'Backspace': 8, ' ': 32,
  'ArrowLeft': 37, 'ArrowUp': 38, 'ArrowRight': 39, 'ArrowDown': 40,
};

async function dispatchKey(ctx, selector, key = 'Enter', event = 'keypress') {
  const kc = _KC[key] ?? (key.length === 1 ? key.charCodeAt(0) : 0);
  const sel = JSON.stringify(selector); const ek = JSON.stringify(key); const ev = JSON.stringify(event);
  await js(ctx, `(()=>{const e=document.querySelector(${sel});if(e){e.focus();e.dispatchEvent(new KeyboardEvent(${ev},{key:${ek},code:${ek},keyCode:${kc},which:${kc},bubbles:true}));}})()`);
}

async function uploadFile(ctx, selector, paths) {
  const doc = await cdp(ctx, 'DOM.getDocument', { depth: -1 });
  const q = await cdp(ctx, 'DOM.querySelector', { nodeId: doc.root.nodeId, selector });
  if (!q.nodeId) throw new Error(`no element for ${selector}`);
  const files = Array.isArray(paths) ? paths : [paths];
  await cdp(ctx, 'DOM.setFileInputFiles', { files, nodeId: q.nodeId });
}

async function captureDialogs(ctx) {
  await js(ctx, "window.__dialogs__=[];window.alert=m=>window.__dialogs__.push(String(m));window.confirm=m=>{window.__dialogs__.push(String(m));return true;};window.prompt=(m,d)=>{window.__dialogs__.push(String(m));return d||''}");
}

async function dialogs(ctx) {
  const raw = await js(ctx, "JSON.stringify(window.__dialogs__||[])");
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

// ─── react-aware value setter ──────────────────────────────────────────────
async function reactSetValue(ctx, selector, value) {
  const sel = JSON.stringify(selector); const v = JSON.stringify(value);
  await js(ctx, `(()=>{const el=document.querySelector(${sel});if(!el)throw new Error('no element for '+${sel});const d=Object.getOwnPropertyDescriptor(el.__proto__,'value');if(d&&d.set){d.set.call(el,${v});}else{el.value=${v};}el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
}

// ─── filesystem + shell (self-editing support) ─────────────────────────────
async function readFile(_ctx, filePath) {
  const resolved = path.resolve(filePath);
  const stat = await fs.stat(resolved);
  if (stat.size > MAX_READ_BYTES) {
    const buf = Buffer.alloc(MAX_READ_BYTES);
    const fh = await fs.open(resolved, 'r');
    await fh.read(buf, 0, MAX_READ_BYTES, 0);
    await fh.close();
    return { path: resolved, content: buf.toString('utf-8') + `\n…[truncated at ${MAX_READ_BYTES} bytes, total ${stat.size}]`, size: stat.size };
  }
  return { path: resolved, content: await fs.readFile(resolved, 'utf-8'), size: stat.size };
}

async function writeFile(_ctx, filePath, content) {
  const resolved = path.resolve(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, content, 'utf-8');
  return { path: resolved, bytes: Buffer.byteLength(content, 'utf-8') };
}

async function listDir(_ctx, dirPath) {
  const resolved = path.resolve(dirPath);
  const entries = await fs.readdir(resolved, { withFileTypes: true });
  return {
    path: resolved,
    entries: entries.map((e) => ({ name: e.name, type: e.isDirectory() ? 'dir' : e.isFile() ? 'file' : e.isSymbolicLink() ? 'symlink' : 'other' })),
  };
}

async function shellExec(_ctx, command, cwd) {
  const opts = { timeout: MAX_EXEC_TIMEOUT, maxBuffer: 10 * 1024 * 1024, cwd: cwd ? path.resolve(cwd) : undefined };
  try {
    const { stdout, stderr } = await execAsync(command, opts);
    const out = stdout.length > MAX_OUTPUT_CHARS ? stdout.slice(0, MAX_OUTPUT_CHARS) + '\n…[truncated]' : stdout;
    const err = stderr.length > MAX_OUTPUT_CHARS ? stderr.slice(0, MAX_OUTPUT_CHARS) + '\n…[truncated]' : stderr;
    return { exitCode: 0, stdout: out, stderr: err };
  } catch (e) {
    return { exitCode: e.code ?? 1, stdout: (e.stdout ?? '').slice(0, MAX_OUTPUT_CHARS), stderr: (e.stderr ?? e.message ?? '').slice(0, MAX_OUTPUT_CHARS) };
  }
}

async function patchFile(_ctx, filePath, oldStr, newStr) {
  const resolved = path.resolve(filePath);
  const content = await fs.readFile(resolved, 'utf-8');
  if (!content.includes(oldStr)) return { path: resolved, replaced: false };
  await fs.writeFile(resolved, content.replace(oldStr, newStr), 'utf-8');
  return { path: resolved, replaced: true };
}

// ─── arg-normalization helpers (call these from the dispatchers below) ─────
function str(a, k) { if (typeof a[k] !== 'string') throw new Error(`arg ${k} must be string`); return a[k]; }
function num(a, k) { if (typeof a[k] !== 'number' || !Number.isFinite(a[k])) throw new Error(`arg ${k} must be number`); return a[k]; }
function optNum(a, k, d) { return typeof a[k] === 'number' && Number.isFinite(a[k]) ? a[k] : d; }
function optStr(a, k, d) { return typeof a[k] === 'string' ? a[k] : d; }

// ─── dispatchers: tool-name → helper-call ───────────────────────────────────
// Map tool names (from TOOLS.json) to bound helper invocations. The loader
// imports this map and calls dispatchers[name](ctx, args).
module.exports = {
  // expose helpers for cross-call (e.g. waitForLoad calls js internally)
  cdp, drainEvents, goto, pageInfo, click, typeText, pressKey, scroll,
  screenshot, listTabs, currentTab, switchTab, newTab, ensureRealTab,
  iframeTarget, wait, waitForLoad, js, dispatchKey, uploadFile,
  captureDialogs, dialogs, httpGet, reactSetValue,
  readFile, writeFile, listDir, shellExec, patchFile,

  // dispatcher table — tool-name → (ctx, rawArgs) → Promise<result>
  dispatch: {
    goto:           (ctx, a) => goto(ctx, str(a, 'url')),
    page_info:      (ctx) => pageInfo(ctx),
    click:          (ctx, a) => click(ctx, num(a, 'x'), num(a, 'y'), optStr(a, 'button', 'left'), optNum(a, 'clicks', 1)),
    type_text:      (ctx, a) => typeText(ctx, str(a, 'text')),
    press_key:      (ctx, a) => pressKey(ctx, str(a, 'key'), optNum(a, 'modifiers', 0)),
    dispatch_key:   (ctx, a) => dispatchKey(ctx, str(a, 'selector'), optStr(a, 'key', 'Enter'), optStr(a, 'event', 'keypress')),
    scroll:         (ctx, a) => scroll(ctx, num(a, 'x'), num(a, 'y'), optNum(a, 'dy', -300), optNum(a, 'dx', 0)),
    js:             (ctx, a) => js(ctx, str(a, 'expr'), a.target_id ?? null),
    react_set_value:(ctx, a) => reactSetValue(ctx, str(a, 'selector'), str(a, 'value')),
    screenshot: async (ctx, a) => {
      const r = await screenshot(ctx, undefined, a.full === true);
      return { bytes: r.data.length, preview: r.data.slice(0, 40) + '…' };
    },
    wait:           (ctx, a) => wait(ctx, num(a, 'seconds')),
    wait_for_load:  (ctx, a) => waitForLoad(ctx, optNum(a, 'timeout', 15)),
    http_get:       (ctx, a) => httpGet(ctx, str(a, 'url')),
    list_tabs:      (ctx, a) => listTabs(ctx, a.include_chrome === true),
    current_tab:    (ctx) => currentTab(ctx),
    switch_tab:     (ctx, a) => switchTab(ctx, str(a, 'target_id')),
    new_tab:        (ctx, a) => newTab(ctx, optStr(a, 'url', 'about:blank')),
    ensure_real_tab:(ctx) => ensureRealTab(ctx),
    iframe_target:  (ctx, a) => iframeTarget(ctx, str(a, 'substr')),
    upload_file:    (ctx, a) => uploadFile(ctx, str(a, 'selector'), a.paths),
    capture_dialogs:(ctx) => captureDialogs(ctx),
    dialogs:        (ctx) => dialogs(ctx),
    drain_events:   (ctx) => drainEvents(ctx),
    cdp:            (ctx, a) => cdp(ctx, str(a, 'method'), a.params ?? {}),
    read_file:      (ctx, a) => readFile(ctx, str(a, 'path')),
    write_file:     (ctx, a) => writeFile(ctx, str(a, 'path'), str(a, 'content')),
    patch_file:     (ctx, a) => patchFile(ctx, str(a, 'path'), str(a, 'old_str'), str(a, 'new_str')),
    list_dir:       (ctx, a) => listDir(ctx, str(a, 'path')),
    shell:          (ctx, a) => shellExec(ctx, str(a, 'command'), a.cwd),
    notify:    async (_ctx, a) => ({ notified: true, message: str(a, 'message'), level: str(a, 'level') }),
    done:      async (_ctx, a) => ({ done: true, summary: str(a, 'summary') }),
  },
};
