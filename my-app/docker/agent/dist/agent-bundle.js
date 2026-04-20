var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../../src/main/hl/cdp.ts
var import_node_events = require("node:events");
var import_ws = __toESM(require("ws"));

// ../../src/main/logger.ts
var import_node_fs = __toESM(require("node:fs"));
var import_node_path = __toESM(require("node:path"));
var import_node_os = __toESM(require("node:os"));
var LOG_PREFIX = "[Logger]";
var MAX_FILE_BYTES = 10 * 1024 * 1024;
var MAX_ROTATED_FILES = 5;
var LOG_DIR_NAME = "logs";
var RotatingFileWriter = class {
  filePath;
  maxBytes;
  maxFiles;
  constructor(filePath, maxBytes = MAX_FILE_BYTES, maxFiles = MAX_ROTATED_FILES) {
    this.filePath = filePath;
    this.maxBytes = maxBytes;
    this.maxFiles = maxFiles;
    import_node_fs.default.mkdirSync(import_node_path.default.dirname(filePath), { recursive: true });
  }
  write(line) {
    const lineBytes = Buffer.byteLength(line + "\n", "utf-8");
    let currentSize = 0;
    try {
      const stat = import_node_fs.default.statSync(this.filePath);
      currentSize = stat.size;
    } catch {
    }
    if (currentSize + lineBytes > this.maxBytes) {
      this._rotate();
    }
    try {
      import_node_fs.default.appendFileSync(this.filePath, line + "\n", "utf-8");
    } catch (err) {
      process.stderr.write(
        `${LOG_PREFIX} Failed to write log line: ${err.message}
`
      );
    }
  }
  getFilePath() {
    return this.filePath;
  }
  _rotate() {
    for (let i = this.maxFiles; i >= 1; i--) {
      const src = `${this.filePath}.${i - 1 === 0 ? "" : String(i - 1)}`.replace(/\.$/, "");
      const dst = `${this.filePath}.${i}`;
      const actual = i === 1 ? this.filePath : `${this.filePath}.${i - 1}`;
      try {
        if (import_node_fs.default.existsSync(actual)) {
          import_node_fs.default.renameSync(actual, dst);
        }
      } catch (err) {
        process.stderr.write(`${LOG_PREFIX} Rotation error: ${err.message}
`);
      }
    }
  }
};
var ChannelLogger = class _ChannelLogger {
  channel;
  writer;
  minLevel;
  static LEVEL_ORDER = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
  };
  constructor(channel, writer, minLevel = "info") {
    this.channel = channel;
    this.writer = writer;
    this.minLevel = minLevel;
  }
  debug(msg, extra) {
    this._log("debug", msg, extra);
  }
  info(msg, extra) {
    this._log("info", msg, extra);
  }
  warn(msg, extra) {
    this._log("warn", msg, extra);
  }
  error(msg, extra) {
    this._log("error", msg, extra);
  }
  getFilePath() {
    return this.writer.getFilePath();
  }
  _log(level, msg, extra) {
    if (_ChannelLogger.LEVEL_ORDER[level] < _ChannelLogger.LEVEL_ORDER[this.minLevel]) {
      return;
    }
    const entry = {
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      level,
      channel: this.channel,
      msg,
      ...extra
    };
    const line = JSON.stringify(entry);
    this.writer.write(line);
    const consoleFn = level === "error" ? console.error : level === "warn" ? console.warn : level === "debug" ? console.debug : console.log;
    consoleFn(`[${level.toUpperCase()}][${this.channel}] ${msg}`, extra ?? "");
  }
};
var LoggerFactory = class {
  logsDir;
  cache = /* @__PURE__ */ new Map();
  constructor(userDataPath) {
    const base = userDataPath ?? (() => {
      try {
        const { app: app2 } = require("electron");
        return app2.getPath("userData");
      } catch {
        return import_node_path.default.join(import_node_os.default.tmpdir(), "AgenticBrowser");
      }
    })();
    this.logsDir = import_node_path.default.join(base, LOG_DIR_NAME);
    import_node_fs.default.mkdirSync(this.logsDir, { recursive: true });
    console.log(`${LOG_PREFIX} Logs directory: ${this.logsDir}`);
  }
  /**
   * Get or create a channel logger.
   * Channel names map to filenames:
   *   'main'          → main.log
   *   'daemon'        → daemon.log
   *   'agent-task-X'  → agent-task-X.log
   */
  getLogger(channel, minLevel) {
    const cached = this.cache.get(channel);
    if (cached) return cached;
    const filename = `${channel}.log`;
    const filePath = import_node_path.default.join(this.logsDir, filename);
    const writer = new RotatingFileWriter(filePath);
    const logger = new ChannelLogger(channel, writer, minLevel);
    this.cache.set(channel, logger);
    console.log(`${LOG_PREFIX} Created channel logger: ${channel} \u2192 ${filePath}`);
    return logger;
  }
  getLogsDir() {
    return this.logsDir;
  }
};
var loggerFactory = new LoggerFactory();
var mainLogger = loggerFactory.getLogger("main");
var daemonLogger = loggerFactory.getLogger("daemon");

// ../../src/main/hl/cdp.ts
var CDP_PROTOCOL_VERSION = "1.3";
var WebContentsCdpClient = class extends import_node_events.EventEmitter {
  constructor(wc) {
    super();
    this.wc = wc;
    this.dbg = wc.debugger;
  }
  transport = "webcontents";
  dbg;
  attached = false;
  onMessage = (_e, method, params, sessionId) => {
    this.emit(method, params, sessionId);
  };
  attach() {
    if (this.attached) return;
    try {
      this.dbg.attach(CDP_PROTOCOL_VERSION);
    } catch (err) {
      mainLogger.debug("hl.cdp.webcontents.alreadyAttached", { error: err.message });
    }
    this.dbg.on("message", this.onMessage);
    this.dbg.on("detach", (_e, reason) => {
      mainLogger.warn("hl.cdp.webcontents.detach", { reason });
      this.attached = false;
      this.emit("__detached", { reason });
    });
    this.attached = true;
  }
  // Electron's debugger.sendCommand(method, params, sessionId?) — 3rd arg is the
  // CDP sessionId when operating under a flat session (attachToTarget flatten:true).
  async send(method, params = {}, sessionId = null) {
    if (!this.attached) this.attach();
    if (sessionId) return this.dbg.sendCommand(method, params, sessionId);
    return this.dbg.sendCommand(method, params);
  }
  async close() {
    if (!this.attached) return;
    try {
      this.dbg.detach();
    } catch {
    }
    this.dbg.removeListener("message", this.onMessage);
    this.attached = false;
  }
};
var WebSocketCdpClient = class extends import_node_events.EventEmitter {
  constructor(url) {
    super();
    this.url = url;
  }
  transport = "websocket";
  ws = null;
  nextId = 1;
  pending = /* @__PURE__ */ new Map();
  async connect() {
    return new Promise((resolve, reject) => {
      const ws = new import_ws.default(this.url);
      this.ws = ws;
      ws.on("open", () => resolve());
      ws.on("error", (err) => reject(err));
      ws.on("message", (data) => this.onMessage(data.toString()));
      ws.on("close", () => this.emit("__detached", { reason: "ws-closed" }));
    });
  }
  onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof msg.id === "number") {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result ?? {});
      return;
    }
    if (typeof msg.method === "string") this.emit(msg.method, msg.params, msg.sessionId);
  }
  async send(method, params = {}, sessionId = null) {
    if (!this.ws || this.ws.readyState !== import_ws.default.OPEN) {
      throw new Error(`hl.cdp.websocket.notOpen: state=${this.ws?.readyState}`);
    }
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload), (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }
  async close() {
    if (this.ws && this.ws.readyState === import_ws.default.OPEN) this.ws.close();
    this.ws = null;
  }
};
function cdpForWebContents(wc) {
  const client = new WebContentsCdpClient(wc);
  client.attach();
  return client;
}
async function cdpForWsUrl(url) {
  const client = new WebSocketCdpClient(url);
  await client.connect();
  return client;
}

// ../../src/main/hl/context.ts
var EVENT_BUFFER_SIZE = 500;
var INTERNAL_URL_PREFIXES = [
  "chrome://",
  "chrome-untrusted://",
  "devtools://",
  "chrome-extension://",
  "about:"
];
async function createContext(opts) {
  if (!opts.webContents && !opts.cdpUrl) {
    throw new Error("hl.createContext: must provide webContents or cdpUrl");
  }
  const cdp2 = opts.webContents ? cdpForWebContents(opts.webContents) : await cdpForWsUrl(opts.cdpUrl);
  const ctx = {
    name: opts.name ?? "default",
    cdp: cdp2,
    session: null,
    events: [],
    _source: { webContents: opts.webContents, cdpUrl: opts.cdpUrl }
  };
  const domainEvents = [
    "Page.frameNavigated",
    "Page.loadEventFired",
    "Page.lifecycleEvent",
    "Page.javascriptDialogOpening",
    "Page.javascriptDialogClosed",
    "Network.requestWillBeSent",
    "Network.responseReceived",
    "Network.loadingFailed",
    "Runtime.consoleAPICalled",
    "Target.attachedToTarget",
    "Target.detachedFromTarget",
    "Target.targetCreated",
    "Target.targetDestroyed",
    "Target.targetInfoChanged"
  ];
  const push = (method) => (params, sessionId) => {
    const ev = { method, params };
    if (sessionId) ev.session_id = sessionId;
    ctx.events.push(ev);
    if (ctx.events.length > EVENT_BUFFER_SIZE) ctx.events.shift();
  };
  for (const e of domainEvents) cdp2.on(e, push(e));
  return ctx;
}

// ../../src/main/hl/agent.ts
var import_sdk = __toESM(require("@anthropic-ai/sdk"));

// ../../src/main/hl/helpers.ts
var import_promises = __toESM(require("node:fs/promises"));
var import_node_path2 = __toESM(require("node:path"));
var import_electron = require("electron");
var import_node_child_process = require("node:child_process");
var import_node_util = require("node:util");
function skillsRoot() {
  return import_node_path2.default.resolve(import_electron.app.isPackaged ? process.resourcesPath : import_node_path2.default.join(__dirname, "../../.."));
}
async function cdp(ctx, method, params = {}, sessionId) {
  const sid = method.startsWith("Target.") ? null : sessionId !== void 0 ? sessionId : ctx.session;
  return ctx.cdp.send(method, params, sid ?? null);
}
function drainEvents(ctx) {
  const out = ctx.events.slice();
  ctx.events.length = 0;
  return out;
}
function setSession(ctx, s) {
  ctx.session = s;
}
async function goto(ctx, url) {
  const r = await cdp(ctx, "Page.navigate", { url });
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "").split(".")[0];
    const skillDir = import_node_path2.default.join(skillsRoot(), "domain-skills", hostname);
    const stat = await import_promises.default.stat(skillDir).catch(() => null);
    if (stat?.isDirectory()) {
      const files = await import_promises.default.readdir(skillDir);
      const skills = files.filter((f) => f.endsWith(".md")).slice(0, 10);
      return { ...r, domain_skills: skills };
    }
  } catch {
  }
  return r;
}
async function pageInfo(ctx) {
  const pendingDialog = ctx.events.find((e) => e.method === "Page.javascriptDialogOpening");
  if (pendingDialog) {
    return { dialog: pendingDialog.params };
  }
  const expr = "JSON.stringify({url:location.href,title:document.title,w:innerWidth,h:innerHeight,sx:scrollX,sy:scrollY,pw:document.documentElement.scrollWidth,ph:document.documentElement.scrollHeight})";
  const r = await cdp(ctx, "Runtime.evaluate", { expression: expr, returnByValue: true });
  return JSON.parse(r.result.value);
}
async function click(ctx, x, y, button = "left", clicks = 1) {
  await cdp(ctx, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount: clicks });
  await cdp(ctx, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount: clicks });
}
async function typeText(ctx, text) {
  await cdp(ctx, "Input.insertText", { text });
}
var _KEYS = {
  "Enter": [13, "Enter", "\r"],
  "Tab": [9, "Tab", "	"],
  "Backspace": [8, "Backspace", ""],
  "Escape": [27, "Escape", ""],
  "Delete": [46, "Delete", ""],
  " ": [32, "Space", " "],
  "ArrowLeft": [37, "ArrowLeft", ""],
  "ArrowUp": [38, "ArrowUp", ""],
  "ArrowRight": [39, "ArrowRight", ""],
  "ArrowDown": [40, "ArrowDown", ""],
  "Home": [36, "Home", ""],
  "End": [35, "End", ""],
  "PageUp": [33, "PageUp", ""],
  "PageDown": [34, "PageDown", ""]
};
async function pressKey(ctx, key, modifiers = 0) {
  const [vk, code, text] = _KEYS[key] ?? [key.length === 1 ? key.charCodeAt(0) : 0, key, key.length === 1 ? key : ""];
  const base = { key, code, modifiers, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
  await cdp(ctx, "Input.dispatchKeyEvent", { type: "keyDown", ...base, ...text ? { text } : {} });
  if (text && text.length === 1) await cdp(ctx, "Input.dispatchKeyEvent", { type: "char", text, ...base });
  await cdp(ctx, "Input.dispatchKeyEvent", { type: "keyUp", ...base });
}
async function scroll(ctx, x, y, dy = -300, dx = 0) {
  await cdp(ctx, "Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: dx, deltaY: dy });
}
async function screenshot(ctx, outPath, full = false) {
  const r = await cdp(ctx, "Page.captureScreenshot", { format: "png", captureBeyondViewport: full });
  if (outPath) {
    await import_promises.default.writeFile(outPath, Buffer.from(r.data, "base64"));
    return { data: r.data, path: outPath };
  }
  return { data: r.data };
}
function isWebContents(ctx) {
  return ctx.cdp.transport === "webcontents";
}
async function listTabs(ctx, includeChrome = false) {
  if (isWebContents(ctx)) return [{ targetId: "webcontents", title: "active", url: "webcontents" }];
  const r = await cdp(ctx, "Target.getTargets");
  const out = [];
  for (const t of r.targetInfos) {
    if (t.type !== "page") continue;
    const url = t.url ?? "";
    if (!includeChrome && INTERNAL_URL_PREFIXES.some((p) => url.startsWith(p))) continue;
    out.push({ targetId: t.targetId, title: t.title ?? "", url });
  }
  return out;
}
async function currentTab(ctx) {
  if (isWebContents(ctx)) return { targetId: "webcontents", title: "active", url: "webcontents" };
  const r = await cdp(ctx, "Target.getTargetInfo");
  const t = r.targetInfo ?? { targetId: "", url: "", title: "" };
  return { targetId: t.targetId ?? "", title: t.title ?? "", url: t.url ?? "" };
}
async function switchTab(ctx, targetId) {
  if (isWebContents(ctx)) return "webcontents";
  try {
    await cdp(ctx, "Runtime.evaluate", { expression: "if(document.title.startsWith('\\u{1F7E2} '))document.title=document.title.slice(2)" });
  } catch {
  }
  try {
    await Promise.race([
      cdp(ctx, "Target.activateTarget", { targetId }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("activateTarget timeout")), 2e3))
    ]);
  } catch {
  }
  const r = await cdp(ctx, "Target.attachToTarget", { targetId, flatten: true });
  setSession(ctx, r.sessionId);
  try {
    await cdp(ctx, "Runtime.evaluate", { expression: "if(!document.title.startsWith('\\u{1F7E2}'))document.title='\\u{1F7E2} '+document.title" });
  } catch {
  }
  return r.sessionId;
}
async function newTab(ctx, url = "about:blank") {
  if (isWebContents(ctx)) {
    if (url !== "about:blank") await goto(ctx, url);
    return "webcontents";
  }
  const r = await cdp(ctx, "Target.createTarget", { url: "about:blank" });
  await switchTab(ctx, r.targetId);
  if (url !== "about:blank") await goto(ctx, url);
  return r.targetId;
}
async function ensureRealTab(ctx) {
  if (isWebContents(ctx)) return { targetId: "webcontents", title: "active", url: "webcontents" };
  const tabs = await listTabs(ctx);
  if (tabs.length === 0) return null;
  try {
    const cur = await currentTab(ctx);
    if (cur.url && !INTERNAL_URL_PREFIXES.some((p) => cur.url.startsWith(p))) return cur;
  } catch {
  }
  await switchTab(ctx, tabs[0].targetId);
  return tabs[0];
}
async function iframeTarget(ctx, urlSubstr) {
  if (isWebContents(ctx)) return null;
  const r = await cdp(ctx, "Target.getTargets");
  const t = r.targetInfos.find((i) => i.type === "iframe" && (i.url ?? "").includes(urlSubstr));
  return t ? t.targetId : null;
}
async function wait(_ctx, seconds = 1) {
  return new Promise((r) => setTimeout(r, Math.max(0, seconds) * 1e3));
}
async function waitForLoad(ctx, timeoutSec = 15) {
  const deadline = Date.now() + timeoutSec * 1e3;
  while (Date.now() < deadline) {
    if (await js(ctx, "document.readyState") === "complete") return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}
async function js(ctx, expression, targetId) {
  let sid = null;
  if (targetId) {
    const a = await cdp(ctx, "Target.attachToTarget", { targetId, flatten: true });
    sid = a.sessionId;
  }
  const r = await cdp(ctx, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sid);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value;
}
var _KC = {
  "Enter": 13,
  "Tab": 9,
  "Escape": 27,
  "Backspace": 8,
  " ": 32,
  "ArrowLeft": 37,
  "ArrowUp": 38,
  "ArrowRight": 39,
  "ArrowDown": 40
};
async function dispatchKey(ctx, selector, key = "Enter", event = "keypress") {
  const kc = _KC[key] ?? (key.length === 1 ? key.charCodeAt(0) : 0);
  const sel = JSON.stringify(selector);
  const ek = JSON.stringify(key);
  const ev = JSON.stringify(event);
  await js(ctx, `(()=>{const e=document.querySelector(${sel});if(e){e.focus();e.dispatchEvent(new KeyboardEvent(${ev},{key:${ek},code:${ek},keyCode:${kc},which:${kc},bubbles:true}));}})()`);
}
async function uploadFile(ctx, selector, paths) {
  const doc = await cdp(ctx, "DOM.getDocument", { depth: -1 });
  const q = await cdp(ctx, "DOM.querySelector", { nodeId: doc.root.nodeId, selector });
  if (!q.nodeId) throw new Error(`no element for ${selector}`);
  const files = Array.isArray(paths) ? paths : [paths];
  await cdp(ctx, "DOM.setFileInputFiles", { files, nodeId: q.nodeId });
}
async function captureDialogs(ctx) {
  await js(ctx, "window.__dialogs__=[];window.alert=m=>window.__dialogs__.push(String(m));window.confirm=m=>{window.__dialogs__.push(String(m));return true;};window.prompt=(m,d)=>{window.__dialogs__.push(String(m));return d||''}");
}
async function dialogs(ctx) {
  const raw = await js(ctx, "JSON.stringify(window.__dialogs__||[])");
  return JSON.parse(raw || "[]");
}
async function httpGet(_ctx, url, headers, timeoutMs = 2e4) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  const h = { "User-Agent": "Mozilla/5.0", "Accept-Encoding": "gzip", ...headers ?? {} };
  try {
    const r = await fetch(url, { headers: h, signal: ctl.signal });
    return { status: r.status, body: await r.text() };
  } finally {
    clearTimeout(t);
  }
}
async function reactSetValue(ctx, selector, value) {
  const sel = JSON.stringify(selector);
  const v = JSON.stringify(value);
  await js(ctx, `(()=>{const el=document.querySelector(${sel});if(!el)throw new Error('no element for '+${sel});const d=Object.getOwnPropertyDescriptor(el.__proto__,'value');if(d&&d.set){d.set.call(el,${v});}else{el.value=${v};}el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
}
var execAsync = (0, import_node_util.promisify)(import_node_child_process.exec);
var MAX_READ_BYTES = 256 * 1024;
var MAX_EXEC_TIMEOUT = 3e4;
var MAX_OUTPUT_CHARS = 64e3;
async function readFile(_ctx, filePath) {
  const resolved = import_node_path2.default.resolve(filePath);
  const stat = await import_promises.default.stat(resolved);
  if (stat.size > MAX_READ_BYTES) {
    const buf = Buffer.alloc(MAX_READ_BYTES);
    const fh = await import_promises.default.open(resolved, "r");
    await fh.read(buf, 0, MAX_READ_BYTES, 0);
    await fh.close();
    return { path: resolved, content: buf.toString("utf-8") + `
\u2026[truncated at ${MAX_READ_BYTES} bytes, total ${stat.size}]`, size: stat.size };
  }
  const content = await import_promises.default.readFile(resolved, "utf-8");
  return { path: resolved, content, size: stat.size };
}
async function writeFile(_ctx, filePath, content) {
  const resolved = import_node_path2.default.resolve(filePath);
  await import_promises.default.mkdir(import_node_path2.default.dirname(resolved), { recursive: true });
  await import_promises.default.writeFile(resolved, content, "utf-8");
  return { path: resolved, bytes: Buffer.byteLength(content, "utf-8") };
}
async function listDir(_ctx, dirPath) {
  const resolved = import_node_path2.default.resolve(dirPath);
  const entries = await import_promises.default.readdir(resolved, { withFileTypes: true });
  return {
    path: resolved,
    entries: entries.map((e) => ({ name: e.name, type: e.isDirectory() ? "dir" : e.isFile() ? "file" : e.isSymbolicLink() ? "symlink" : "other" }))
  };
}
async function shellExec(_ctx, command, cwd) {
  const opts = { timeout: MAX_EXEC_TIMEOUT, maxBuffer: 10 * 1024 * 1024, cwd: cwd ? import_node_path2.default.resolve(cwd) : void 0 };
  try {
    const { stdout, stderr } = await execAsync(command, opts);
    const out = stdout.length > MAX_OUTPUT_CHARS ? stdout.slice(0, MAX_OUTPUT_CHARS) + "\n\u2026[truncated]" : stdout;
    const err = stderr.length > MAX_OUTPUT_CHARS ? stderr.slice(0, MAX_OUTPUT_CHARS) + "\n\u2026[truncated]" : stderr;
    return { exitCode: 0, stdout: out, stderr: err };
  } catch (e) {
    return { exitCode: e.code ?? 1, stdout: (e.stdout ?? "").slice(0, MAX_OUTPUT_CHARS), stderr: (e.stderr ?? e.message ?? "").slice(0, MAX_OUTPUT_CHARS) };
  }
}
async function patchFile(_ctx, filePath, oldStr, newStr) {
  const resolved = import_node_path2.default.resolve(filePath);
  const content = await import_promises.default.readFile(resolved, "utf-8");
  if (!content.includes(oldStr)) return { path: resolved, replaced: false };
  await import_promises.default.writeFile(resolved, content.replace(oldStr, newStr), "utf-8");
  return { path: resolved, replaced: true };
}

// ../../src/main/hl/tools.ts
function str(args, k) {
  const v = args[k];
  if (typeof v !== "string") throw new Error(`tool arg "${k}" must be a string`);
  return v;
}
function num(args, k) {
  const v = args[k];
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`tool arg "${k}" must be a number`);
  return v;
}
function optNum(args, k, dflt) {
  const v = args[k];
  return typeof v === "number" && Number.isFinite(v) ? v : dflt;
}
function optStr(args, k, dflt) {
  const v = args[k];
  return typeof v === "string" ? v : dflt;
}
var HL_TOOLS = [
  {
    name: "goto",
    description: "Navigate the attached tab to the given URL (does not wait for load).",
    input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    run: (ctx, a) => goto(ctx, str(a, "url"))
  },
  {
    name: "page_info",
    description: "Get {url, title, w, h, sx, sy, pw, ph}: viewport + scroll + page-size.",
    input_schema: { type: "object", properties: {} },
    run: (ctx) => pageInfo(ctx)
  },
  {
    name: "click",
    description: "Coordinate click at (x,y) in CSS px relative to viewport. Default interaction method \u2014 passes through iframes/shadow DOM.",
    input_schema: {
      type: "object",
      properties: { x: { type: "number" }, y: { type: "number" }, button: { type: "string", enum: ["left", "right", "middle"] }, clicks: { type: "number" } },
      required: ["x", "y"]
    },
    run: (ctx, a) => click(ctx, num(a, "x"), num(a, "y"), optStr(a, "button", "left"), optNum(a, "clicks", 1))
  },
  {
    name: "type_text",
    description: "Insert text at the current caret (no key events). Tab focus first via js() if needed. For React-controlled inputs use react_set_value.",
    input_schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    run: (ctx, a) => typeText(ctx, str(a, "text"))
  },
  {
    name: "press_key",
    description: 'CDP key event: "Enter", "Tab", "ArrowDown", "Escape", single chars, etc. Modifiers bitfield: 1=Alt 2=Ctrl 4=Cmd 8=Shift.',
    input_schema: {
      type: "object",
      properties: { key: { type: "string" }, modifiers: { type: "number" } },
      required: ["key"]
    },
    run: (ctx, a) => pressKey(ctx, str(a, "key"), optNum(a, "modifiers", 0))
  },
  {
    name: "dispatch_key",
    description: "Dispatch a DOM KeyboardEvent on a selector. Use when CDP press_key does not trigger the listener (e.g. keypress for Enter on <input type=search>).",
    input_schema: {
      type: "object",
      properties: { selector: { type: "string" }, key: { type: "string" }, event: { type: "string" } },
      required: ["selector"]
    },
    run: (ctx, a) => dispatchKey(ctx, str(a, "selector"), optStr(a, "key", "Enter"), optStr(a, "event", "keypress"))
  },
  {
    name: "scroll",
    description: "Mouse-wheel scroll at (x,y). dy<0 scrolls down. Used for virtual/scroll-wheel pickers (e.g. TikTok time picker) where dy=32 steps +1 unit.",
    input_schema: {
      type: "object",
      properties: { x: { type: "number" }, y: { type: "number" }, dy: { type: "number" }, dx: { type: "number" } },
      required: ["x", "y"]
    },
    run: (ctx, a) => scroll(ctx, num(a, "x"), num(a, "y"), optNum(a, "dy", -300), optNum(a, "dx", 0))
  },
  {
    name: "js",
    description: "Run a JS expression in the attached tab. Optional target_id to run inside a cross-origin iframe (from iframe_target).",
    input_schema: {
      type: "object",
      properties: { expr: { type: "string" }, target_id: { type: "string" } },
      required: ["expr"]
    },
    run: (ctx, a) => js(ctx, str(a, "expr"), a.target_id ?? null)
  },
  {
    name: "react_set_value",
    description: 'Set a React-controlled input value via the native setter + dispatch "input"+"change". Use when type_text is overwritten by React.',
    input_schema: {
      type: "object",
      properties: { selector: { type: "string" }, value: { type: "string" } },
      required: ["selector", "value"]
    },
    run: (ctx, a) => reactSetValue(ctx, str(a, "selector"), str(a, "value"))
  },
  {
    name: "screenshot",
    description: "Capture a PNG screenshot. full=true passes captureBeyondViewport. Returns byte length + a short preview only (LLM cannot reliably click from the image \u2014 use js+getBoundingClientRect for coords).",
    input_schema: { type: "object", properties: { full: { type: "boolean" } } },
    run: async (ctx, a) => {
      const r = await screenshot(ctx, void 0, a.full === true);
      return { bytes: r.data.length, preview: r.data.slice(0, 40) + "\u2026" };
    }
  },
  {
    name: "wait",
    description: "Sleep for N seconds. Prefer wait_for_load; use wait only for truly fixed delays.",
    input_schema: { type: "object", properties: { seconds: { type: "number" } }, required: ["seconds"] },
    run: (ctx, a) => wait(ctx, num(a, "seconds"))
  },
  {
    name: "wait_for_load",
    description: 'Poll document.readyState === "complete" up to timeout seconds (default 15).',
    input_schema: { type: "object", properties: { timeout: { type: "number" } } },
    run: (ctx, a) => waitForLoad(ctx, optNum(a, "timeout", 15))
  },
  {
    name: "http_get",
    description: "HTTP GET (no browser). Use for static pages / APIs \u2014 much faster than loading in a tab.",
    input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    run: (ctx, a) => httpGet(ctx, str(a, "url"))
  },
  {
    name: "list_tabs",
    description: "List pages currently open. include_chrome=true to include chrome://, devtools://, about:blank etc.",
    input_schema: { type: "object", properties: { include_chrome: { type: "boolean" } } },
    run: (ctx, a) => listTabs(ctx, a.include_chrome === true)
  },
  {
    name: "current_tab",
    description: "Return {targetId, url, title} for the attached tab.",
    input_schema: { type: "object", properties: {} },
    run: (ctx) => currentTab(ctx)
  },
  {
    name: "switch_tab",
    description: "Attach to another target (via targetId from list_tabs) and make it the current session.",
    input_schema: { type: "object", properties: { target_id: { type: "string" } }, required: ["target_id"] },
    run: (ctx, a) => switchTab(ctx, str(a, "target_id"))
  },
  {
    name: "new_tab",
    description: "Open a new tab and attach. Returns the new targetId.",
    input_schema: { type: "object", properties: { url: { type: "string" } } },
    run: (ctx, a) => newTab(ctx, optStr(a, "url", "about:blank"))
  },
  {
    name: "ensure_real_tab",
    description: "Switch to a real user tab if current is chrome:// / internal / stale. Returns {targetId, url, title} or null.",
    input_schema: { type: "object", properties: {} },
    run: (ctx) => ensureRealTab(ctx)
  },
  {
    name: "iframe_target",
    description: "Find cross-origin iframe target whose URL contains substr. Returns targetId string or null; pass to js(expr, target_id=...).",
    input_schema: { type: "object", properties: { substr: { type: "string" } }, required: ["substr"] },
    run: (ctx, a) => iframeTarget(ctx, str(a, "substr"))
  },
  {
    name: "upload_file",
    description: 'Set files on <input type="file"> via CDP DOM.setFileInputFiles. paths is absolute filepath or list of filepaths.',
    input_schema: {
      type: "object",
      properties: {
        selector: { type: "string" },
        paths: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] }
      },
      required: ["selector", "paths"]
    },
    run: (ctx, a) => uploadFile(ctx, str(a, "selector"), a.paths)
  },
  {
    name: "capture_dialogs",
    description: "JS stub: replace window.alert/confirm/prompt so messages stash in window.__dialogs__. Call BEFORE the triggering action. Stubs are lost on navigation \u2014 re-call after goto.",
    input_schema: { type: "object", properties: {} },
    run: (ctx) => captureDialogs(ctx)
  },
  {
    name: "dialogs",
    description: "Read the JS-stub dialog buffer. Returns list of dialog message strings since last capture_dialogs.",
    input_schema: { type: "object", properties: {} },
    run: (ctx) => dialogs(ctx)
  },
  {
    name: "drain_events",
    description: "Flush the CDP event ring-buffer (max 500) and clear. Returns events in FIFO order.",
    input_schema: { type: "object", properties: {} },
    run: async (ctx) => drainEvents(ctx)
  },
  {
    name: "cdp",
    description: "Escape hatch: raw CDP send. Use for methods not covered by a typed helper (e.g. Page.handleJavaScriptDialog). Returns the CDP result object.",
    input_schema: {
      type: "object",
      properties: { method: { type: "string" }, params: { type: "object" } },
      required: ["method"]
    },
    run: (ctx, a) => cdp(ctx, str(a, "method"), a.params ?? {})
  },
  // ── Filesystem + Shell tools ──────────────────────────────────────────────
  {
    name: "read_file",
    description: "Read a file from the local filesystem. Returns {path, content, size}. Large files are truncated at 256 KB.",
    input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    run: (ctx, a) => readFile(ctx, str(a, "path"))
  },
  {
    name: "write_file",
    description: "Write content to a file (creates parent dirs if needed). Returns {path, bytes}.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"]
    },
    run: (ctx, a) => writeFile(ctx, str(a, "path"), str(a, "content"))
  },
  {
    name: "patch_file",
    description: "Replace the first occurrence of old_str with new_str in a file. Returns {path, replaced: bool}.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" }, old_str: { type: "string" }, new_str: { type: "string" } },
      required: ["path", "old_str", "new_str"]
    },
    run: (ctx, a) => patchFile(ctx, str(a, "path"), str(a, "old_str"), str(a, "new_str"))
  },
  {
    name: "list_dir",
    description: "List directory entries. Returns {path, entries: [{name, type}]}.",
    input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    run: (ctx, a) => listDir(ctx, str(a, "path"))
  },
  {
    name: "shell",
    description: "Execute a shell command. Returns {exitCode, stdout, stderr}. Timeout: 30s. Optional cwd.",
    input_schema: {
      type: "object",
      properties: { command: { type: "string" }, cwd: { type: "string" } },
      required: ["command"]
    },
    run: (ctx, a) => shellExec(ctx, str(a, "command"), a.cwd)
  },
  {
    name: "notify",
    description: "Send a notification to the user. level=info for FYI (agent keeps going), level=blocking for things that need user action (auth walls, CAPTCHAs). Blocking notifications halt the agent after sending.",
    input_schema: {
      type: "object",
      properties: { message: { type: "string" }, level: { type: "string", enum: ["info", "blocking"] } },
      required: ["message", "level"]
    },
    run: async (_ctx, a) => ({ notified: true, message: str(a, "message"), level: str(a, "level") })
  },
  {
    name: "done",
    description: "Call this when the task is complete. Pass a short user-facing summary of the outcome.",
    input_schema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
    run: async (_ctx, a) => ({ done: true, summary: str(a, "summary") })
  }
];
var HL_TOOL_BY_NAME = new Map(HL_TOOLS.map((t) => [t.name, t]));

// ../../src/main/hl/agent.ts
var DEFAULT_MODEL = process.env.HL_MODEL ?? "claude-opus-4-7";
var MAX_TOKENS = parseInt(process.env.HL_MAX_TOKENS ?? "4096", 10);
var MAX_ITERATIONS = parseInt(process.env.HL_MAX_ITERATIONS ?? "200", 10);
var SYSTEM_PROMPT = `You control a Chromium tab via CDP-backed tools AND have full local filesystem + shell access.
You are working inside a desktop browser app; the attached tab is the user's current tab.

## What actually works

- **Screenshots first**: use screenshot() to understand the current page quickly, find visible targets, and decide next.
- **Clicking**: screenshot() \u2192 look \u2192 click(x, y) \u2192 screenshot() again to verify. Coordinate clicks pass through iframes/shadow/cross-origin at the compositor level.
- **Before clicking**: use js() with getBoundingClientRect() to get accurate coords. Do not eyeball from screenshots.
- **Bulk HTTP**: http_get(url) for static pages/APIs \u2014 much faster than loading in a tab.
- **After goto**: wait_for_load().
- **Wrong/stale tab**: ensure_real_tab(). Use it when the current tab is stale or internal.
- **Verification**: page_info() is the simplest "is this alive?" check, but screenshots are the default way to verify.
- **DOM reads**: use js(...) for inspection and extraction when screenshots show coordinates are the wrong tool.
- **Iframe sites**: click(x, y) passes through; only drop to iframe DOM work when coordinate clicks are the wrong tool.
- **Auth wall**: redirected to login \u2192 call notify({message: "Please log in to <site>", level: "blocking"}). Don't type credentials.
- **Raw CDP** for anything helpers don't cover: cdp("Domain.method", params).

## Browser interaction details

- For React-controlled inputs, type_text may be overwritten \u2014 use react_set_value instead.
- For special keys (Enter, Tab), if press_key does not trigger the DOM listener, fall back to dispatch_key.
- Call capture_dialogs BEFORE any action that might open alert/confirm/prompt \u2014 otherwise the page JS thread freezes.
- capture_dialogs stubs are lost on navigation \u2014 re-call after goto().
- For cross-origin iframes, use iframe_target then js(expr, target_id). Same-origin nested iframes are NOT CDP targets \u2014 walk contentDocument.
- Shadow DOM: querySelector does NOT pierce \u2014 walk element.shadowRoot recursively.
- First navigation should be new_tab(url), not goto(url) \u2014 goto runs in the user's active tab and clobbers their work.

## Skills

- When goto() returns domain_skills, read the listed skill files before proceeding \u2014 they contain site-specific selectors, APIs, and traps.
- Search domain-skills/ first for the domain you are working on before inventing a new approach.
- If you struggle with a specific mechanic, check interaction-skills/ for helpers (dialogs, dropdowns, iframes, shadow-dom, uploads, etc.).
- Use shell to search skills: shell({command: "ls domain-skills/"}) or shell({command: "cat domain-skills/github/navigation.md"}).

## Always contribute back

If you learned anything non-obvious about how a site works, write it to domain-skills/<site>/<topic>.md before calling done.
Worth capturing: private APIs, stable selectors, framework quirks, URL patterns, waits that wait_for_load() misses, traps.
Do NOT write: raw pixel coordinates, run narration, secrets/cookies, or user-specific state.

## Filesystem + shell

- You can read, write, and patch files on the local machine via read_file, write_file, patch_file.
- You can list directories via list_dir and run shell commands via shell.
- You can edit your own source code (this harness). The source lives in the project directory.
- Use patch_file for surgical edits (find-and-replace); use write_file for new files or full rewrites.
- Use shell for git, build commands, grep, or any CLI tool.

## General

- After every meaningful action, re-screenshot before assuming it worked.
- Prefer compositor-level actions over framework hacks.
- Use notify({level: "blocking"}) when you need user action (login, CAPTCHA, ambiguous choice). Use notify({level: "info"}) for non-blocking FYI messages. Keep messages short and actionable.
- Call the \`done\` tool with a short user-facing summary when the task is complete.
- Be concise. Act, don't narrate.`;
function previewResult(r, limit = 240) {
  try {
    const s = typeof r === "string" ? r : JSON.stringify(r);
    return s.length > limit ? s.slice(0, limit) + "\u2026" : s;
  } catch {
    return String(r).slice(0, limit);
  }
}
function asTools() {
  const tools = HL_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema
  }));
  const last = tools[tools.length - 1];
  last.cache_control = { type: "ephemeral" };
  return tools;
}
async function runAgent(opts) {
  const { ctx, prompt, apiKey, signal, onEvent } = opts;
  const client = new import_sdk.default({ apiKey });
  const tools = asTools();
  const messages = [
    ...opts.priorMessages ?? [],
    { role: "user", content: prompt }
  ];
  const model = opts.model ?? DEFAULT_MODEL;
  const system = [
    { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }
  ];
  for (let iter = 1; ; iter++) {
    if (iter > MAX_ITERATIONS) {
      mainLogger.warn("hl.agent.maxIterations", { iter, max: MAX_ITERATIONS });
      onEvent({ type: "done", summary: `Reached maximum iterations (${MAX_ITERATIONS})`, iterations: iter });
      return messages;
    }
    if (signal?.aborted) {
      onEvent({ type: "done", summary: "Halted by user", iterations: iter });
      return messages;
    }
    const queued = opts.drainQueue?.() ?? null;
    if (queued) {
      mainLogger.info("hl.agent.steer", { iter, promptLength: queued.length });
      onEvent({ type: "user_input", text: queued });
      const last = messages[messages.length - 1];
      if (last?.role === "user") {
        const existing = typeof last.content === "string" ? last.content : JSON.stringify(last.content);
        last.content = existing + "\n\n[User interruption]: " + queued;
      } else {
        messages.push({ role: "user", content: "[User interruption]: " + queued });
      }
    }
    mainLogger.info("hl.agent.iter", { iter, model, ctx: ctx.name, messages: messages.length });
    let finalMsg;
    try {
      const stream = client.messages.stream(
        { model, max_tokens: MAX_TOKENS, system, tools, messages },
        { signal }
      );
      stream.on("text", (delta) => {
        if (delta.trim()) onEvent({ type: "thinking", text: delta });
      });
      finalMsg = await stream.finalMessage();
    } catch (err) {
      const msg = err.message ?? "anthropic_error";
      mainLogger.error("hl.agent.apiError", { error: msg, iter });
      onEvent({ type: "error", message: `api_error: ${msg}` });
      return messages;
    }
    const u = finalMsg.usage;
    if (u) mainLogger.info("hl.agent.cache", { iter, cache_read: u.cache_read_input_tokens ?? 0, cache_create: u.cache_creation_input_tokens ?? 0 });
    mainLogger.info("hl.agent.response", {
      iter,
      stop_reason: finalMsg.stop_reason,
      content_blocks: finalMsg.content.length,
      types: finalMsg.content.map((b) => b.type)
    });
    if (finalMsg.stop_reason !== "tool_use") {
      const text = finalMsg.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      onEvent({ type: "done", summary: text || "(no response)", iterations: iter });
      return messages;
    }
    const toolResults = [];
    let doneSummary = null;
    for (const block of finalMsg.content) {
      if (block.type !== "tool_use") continue;
      const tu = block;
      const args = tu.input ?? {};
      onEvent({ type: "tool_call", name: tu.name, args, iteration: iter });
      const tool = HL_TOOL_BY_NAME.get(tu.name);
      mainLogger.info("hl.agent.toolDispatch", { iter, tool: tu.name, id: tu.id });
      const t0 = Date.now();
      if (!tool) {
        const msg = `unknown_tool: ${tu.name}`;
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: msg, is_error: true });
        onEvent({ type: "tool_result", name: tu.name, ok: false, preview: msg, ms: Date.now() - t0 });
        continue;
      }
      try {
        const r = await tool.run(ctx, args);
        const preview = previewResult(r);
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: preview });
        onEvent({ type: "tool_result", name: tu.name, ok: true, preview, ms: Date.now() - t0 });
        if (tu.name === "done" && r && typeof r === "object" && "summary" in r) {
          doneSummary = String(r.summary);
        }
        if ((tu.name === "write_file" || tu.name === "patch_file") && r && typeof r === "object" && "path" in r) {
          const writtenPath = String(r.path);
          const skillMatch = writtenPath.match(/(?:domain-skills|interaction-skills)\/([^/]+)\/([^/]+)\.md$/);
          if (skillMatch) {
            const rObj = r;
            const bytes = typeof rObj.bytes === "number" ? rObj.bytes : 0;
            onEvent({ type: "skill_written", path: writtenPath, domain: skillMatch[1], topic: skillMatch[2], bytes });
          }
        }
        if (tu.name === "notify" && r && typeof r === "object" && "message" in r) {
          const n = r;
          const level = n.level === "blocking" ? "blocking" : "info";
          onEvent({ type: "notify", message: n.message, level });
          if (level === "blocking") {
            onEvent({ type: "done", summary: `Blocked: ${n.message}`, iterations: iter });
            return messages;
          }
        }
      } catch (err) {
        const msg = err.message ?? String(err);
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: `error: ${msg}`, is_error: true });
        onEvent({ type: "tool_result", name: tu.name, ok: false, preview: msg, ms: Date.now() - t0 });
      }
    }
    if (doneSummary !== null) {
      onEvent({ type: "done", summary: doneSummary, iterations: iter });
      return messages;
    }
    messages.push({ role: "assistant", content: finalMsg.content });
    messages.push({ role: "user", content: toolResults });
  }
}

// ../../src/main/hl/cli.ts
var CDP_URL = process.env.CDP_URL;
var API_KEY = process.env.ANTHROPIC_API_KEY;
var PROMPT = process.env.TASK_PROMPT;
var TASK_ID = process.env.TASK_ID ?? "anonymous";
function emit(event) {
  process.stdout.write(JSON.stringify({ task_id: TASK_ID, event }) + "\n");
}
function fatal(msg) {
  emit({ type: "error", message: msg });
  process.exit(1);
}
async function main() {
  if (!CDP_URL) fatal("CDP_URL env var is required");
  if (!API_KEY) fatal("ANTHROPIC_API_KEY env var is required");
  if (!PROMPT) fatal("TASK_PROMPT env var is required");
  emit({ type: "thinking", text: `[container] connecting to ${CDP_URL}` });
  const ctx = await createContext({ name: TASK_ID, cdpUrl: CDP_URL });
  emit({ type: "thinking", text: "[container] CDP connected, starting agent loop" });
  await runAgent({
    ctx,
    prompt: PROMPT,
    apiKey: API_KEY,
    onEvent: emit
  });
  emit({ type: "done", summary: "Task completed" });
  await ctx.cdp.close();
  process.exit(0);
}
main().catch((err) => {
  fatal(`Agent crashed: ${err.message}`);
});
