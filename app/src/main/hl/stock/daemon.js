#!/usr/bin/env node
/**
 * Long-running CDP WebSocket holder + local IPC relay.
 *
 * Chrome 144+: reads ws URL from <profile>/DevToolsActivePort (written when user
 * enables chrome://inspect/#remote-debugging). Avoids the per-connect "Allow?"
 * dialog that repeated WebSocket handshakes would trigger.
 *
 * Single-file port of harnessless/daemon.js — paths inlined so it has zero
 * external deps beyond Node built-ins (and optionally `ws` for old Node).
 */

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

// ─── inlined paths.js ──────────────────────────────────────────────────────

function safeName(name) {
  return name.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function runtimePaths(opts = {}) {
  const platform = opts.platform || process.platform;
  const env = opts.env || process.env;
  const name = opts.name || env.BU_NAME || 'default';
  const sanitized = safeName(name);
  const pathMod = platform === 'win32' ? path.win32 : path.posix;
  const runDir = opts.runDir || env.BU_RUN_DIR || os.tmpdir();

  return {
    name,
    safeName: sanitized,
    runDir,
    socketPath: platform === 'win32'
      ? `\\\\.\\pipe\\browser-use-bh-${sanitized}`
      : pathMod.join(runDir, `bh-${sanitized}.sock`),
    logPath: pathMod.join(runDir, `bh-${sanitized}.log`),
    pidPath: pathMod.join(runDir, `bh-${sanitized}.pid`),
  };
}

function chromeProfileCandidates(opts = {}) {
  const platform = opts.platform || process.platform;
  const env = opts.env || process.env;
  const home = opts.home || os.homedir();
  const pathMod = platform === 'win32' ? path.win32 : path.posix;

  if (platform === 'darwin') {
    return [
      pathMod.join(home, 'Library', 'Application Support', 'Google', 'Chrome'),
      pathMod.join(home, 'Library', 'Application Support', 'Chromium'),
      pathMod.join(home, 'Library', 'Application Support', 'Google', 'Chrome Canary'),
    ];
  }
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || pathMod.join(home, 'AppData', 'Local');
    return [
      pathMod.join(localAppData, 'Google', 'Chrome', 'User Data'),
      pathMod.join(localAppData, 'Google', 'Chrome SxS', 'User Data'),
      pathMod.join(localAppData, 'Chromium', 'User Data'),
    ];
  }
  const configHome = env.XDG_CONFIG_HOME || pathMod.join(home, '.config');
  return [
    pathMod.join(configHome, 'google-chrome'),
    pathMod.join(configHome, 'google-chrome-beta'),
    pathMod.join(configHome, 'google-chrome-unstable'),
    pathMod.join(configHome, 'chromium'),
  ];
}

// ─── config ────────────────────────────────────────────────────────────────

const PATHS = runtimePaths();
const NAME = PATHS.name;
const RUN_DIR = PATHS.runDir;
const SOCK = PATHS.socketPath;
const LOG = PATHS.logPath;
const PID = PATHS.pidPath;
const BUF = 500;

const INTERNAL = ['chrome://', 'chrome-untrusted://', 'devtools://', 'chrome-extension://', 'about:'];

function log(msg) {
  try { fs.mkdirSync(RUN_DIR, { recursive: true }); } catch {}
  fs.appendFileSync(LOG, msg + '\n');
}

function getWsUrl() {
  const override = process.env.BU_CDP_WS;
  if (override) return override;
  const profiles = chromeProfileCandidates();
  for (const base of profiles) {
    try {
      const raw = fs.readFileSync(path.join(base, 'DevToolsActivePort'), 'utf-8').trim();
      const [port, wsPath] = raw.split('\n', 2);
      return `ws://127.0.0.1:${port.trim()}${wsPath.trim()}`;
    } catch { continue; }
  }
  throw new Error(`DevToolsActivePort not found — enable chrome://inspect/#remote-debugging or set BU_CDP_WS`);
}

function isRealPage(t) {
  return t.type === 'page' && !INTERNAL.some(p => (t.url || '').startsWith(p));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── WebSocket ─────────────────────────────────────────────────────────────

function wsConnect(url) {
  return new Promise((resolve, reject) => {
    let WebSocketCtor = globalThis.WebSocket;
    if (!WebSocketCtor) {
      try { WebSocketCtor = require('ws'); } catch { /* no ws package */ }
    }
    if (!WebSocketCtor) throw new Error('No WebSocket available (Node >=22 or `ws` package needed)');

    const ws = new WebSocketCtor(url);
    const onOpen = () => { cleanup(); resolve(ws); };
    const onError = (err) => { cleanup(); reject(err instanceof Error ? err : new Error(String(err))); };
    function cleanup() {
      ws.removeEventListener?.('open', onOpen); ws.removeEventListener?.('error', onError);
      ws.off?.('open', onOpen); ws.off?.('error', onError);
    }
    ws.addEventListener?.('open', onOpen); ws.addEventListener?.('error', onError);
    ws.on?.('open', onOpen); ws.on?.('error', onError);
  });
}

class CdpWs {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.onEvent = null;
    this.onReconnect = null;
    this._reconnecting = false;
  }

  async connect() {
    this.ws = await wsConnect(this.url);
    const messageHandler = (raw) => {
      let msg;
      try { msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString()); } catch { return; }
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else p.resolve(msg.result || {});
      } else if (msg.method && this.onEvent) {
        this.onEvent(msg.method, msg.params || {}, msg.sessionId || null);
      }
    };

    const onClose = async () => {
      log('ws closed');
      for (const p of this.pending.values()) p.reject(new Error('CDP websocket closed'));
      this.pending.clear();
      if (this._reconnecting || !this.onReconnect) return;
      this._reconnecting = true;
      try {
        await this.onReconnect();
        this._reconnecting = false;
      } catch (e) {
        log(`reconnect failed: ${e.message}`);
        process.exit(1);
      }
    };

    if (typeof this.ws.addEventListener === 'function') {
      this.ws.addEventListener('message', (e) => messageHandler(e.data));
      this.ws.addEventListener('close', onClose);
    } else {
      this.ws.on('message', messageHandler);
      this.ws.on('close', onClose);
    }
  }

  send(method, params = {}, sessionId = null) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        // Node 22+ native WebSocket.send() does not accept a callback;
        // the `ws` npm package does. Use a try/catch only; transport errors
        // are surfaced via the on('close') handler.
        this.ws.send(JSON.stringify(payload));
      } catch (err) {
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  close() { if (this.ws) { try { this.ws.close(); } catch {} } }
}

// ─── Daemon ────────────────────────────────────────────────────────────────

class Daemon {
  constructor() {
    this.cdp = null;
    this.session = null;
    this.events = [];
  }

  async attachFirstPage() {
    const r = await this.cdp.send('Target.getTargets');
    const targets = r.targetInfos || [];
    let pages = targets.filter(isRealPage);
    if (!pages.length) pages = targets.filter(t => t.type === 'page');
    if (!pages.length) { this.session = null; return null; }

    const a = await this.cdp.send('Target.attachToTarget', { targetId: pages[0].targetId, flatten: true });
    this.session = a.sessionId;
    log(`attached ${pages[0].targetId} (${(pages[0].url || '').slice(0, 80)}) session=${this.session}`);

    for (const d of ['Page', 'DOM', 'Runtime', 'Network']) {
      try { await this.cdp.send(`${d}.enable`, {}, this.session); }
      catch (e) { log(`enable ${d}: ${e.message}`); }
    }
    return pages[0];
  }

  async start() {
    const url = getWsUrl();
    log(`connecting to ${url}`);
    this.cdp = new CdpWs(url);
    this.cdp.onReconnect = () => this._doReconnect();
    await this._connectWithRetry();
    await this.attachFirstPage();
    this.cdp.onEvent = (method, params, sessionId) => {
      this.events.push({ method, params, session_id: sessionId });
      if (this.events.length > BUF) this.events.shift();
    };
  }

  async _connectWithRetry() {
    const url = this.cdp.url;
    for (let attempt = 0; attempt < 12; attempt++) {
      try { await this.cdp.connect(); return; }
      catch (e) {
        log(`ws handshake attempt ${attempt + 1} failed: ${e.message} -- retrying`);
        this.cdp = new CdpWs(url);
        this.cdp.onReconnect = () => this._doReconnect();
        await sleep(5000);
        if (attempt === 11) throw new Error("CDP WS handshake never succeeded -- did you accept Chrome's Allow dialog?");
      }
    }
  }

  async _doReconnect() {
    log('ws reconnecting after close...');
    await this._connectWithRetry();
    await this.attachFirstPage();
    log('ws reconnected and reattached');
    this.cdp.onEvent = (method, params, sessionId) => {
      this.events.push({ method, params, session_id: sessionId });
      if (this.events.length > BUF) this.events.shift();
    };
  }

  async handle(req) {
    const meta = req.meta;
    if (meta === 'drain_events') { const out = this.events.slice(); this.events.length = 0; return { events: out }; }
    if (meta === 'session')      return { session_id: this.session };
    if (meta === 'set_session')  { this.session = req.session_id || null; return { session_id: this.session }; }
    if (meta === 'shutdown')     return { ok: true, _shutdown: true };

    const method = req.method;
    const params = req.params || {};
    const sid = method.startsWith('Target.') ? null : (req.session_id || this.session);

    if (!this.cdp || !this.cdp.ws) {
      return { error: 'CDP connection not yet established' };
    }

    try {
      return { result: await this.cdp.send(method, params, sid) };
    } catch (e) {
      const msg = e.message || String(e);
      if (msg.includes('Session with given id not found') && sid === this.session && sid) {
        log(`stale session ${sid}, re-attaching`);
        if (await this.attachFirstPage()) {
          return { result: await this.cdp.send(method, params, this.session) };
        }
      }
      return { error: msg };
    }
  }
}

function alreadyRunning() {
  return new Promise(resolve => {
    const s = net.createConnection(SOCK, () => { s.end(); resolve(true); });
    s.on('error', () => resolve(false));
    s.setTimeout(1000, () => { s.destroy(); resolve(false); });
  });
}

async function serve(daemon) {
  if (process.platform !== 'win32') {
    try { fs.unlinkSync(SOCK); } catch {}
  }

  const server = net.createServer((conn) => {
    let buf = '';
    conn.on('data', (chunk) => {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        (async () => {
          try {
            const req = JSON.parse(line);
            const resp = await daemon.handle(req);
            conn.write(JSON.stringify(resp) + '\n');
            if (resp._shutdown) { server.close(); process.exit(0); }
          } catch (e) {
            log(`conn error: ${e.message}`);
            try { conn.write(JSON.stringify({ error: String(e) }) + '\n'); } catch {}
          }
        })();
      }
    });
    conn.on('error', (e) => log(`client conn error: ${e.message}`));
  });

  server.on('error', (err) => {
    log(`server error: ${err.message}`);
    process.exit(1);
  });
  server.listen(SOCK, () => {
    if (process.platform !== 'win32') fs.chmodSync(SOCK, 0o600);
    log(`listening on ${SOCK}`);
  });
}

async function main() {
  if (await alreadyRunning()) {
    process.stderr.write(`daemon already running on ${SOCK}\n`);
    process.exit(0);
  }
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(LOG, '');
  fs.writeFileSync(PID, String(process.pid));

  const d = new Daemon();
  // Start the IPC server first so the parent process can connect immediately.
  // The CDP WebSocket connection may block waiting for the user to accept
  // Chrome's "Allow remote debugging?" dialog, so we must not hold the IPC
  // server behind it.
  await serve(d);
  await d.start();
}

main().catch(e => {
  log(`fatal: ${e.message}`);
  console.error(e.message);
  process.exit(1);
});

function cleanup() {
  try { fs.unlinkSync(PID); } catch {}
  if (process.platform !== 'win32') {
    try { fs.unlinkSync(SOCK); } catch {}
  }
}

process.on('exit', cleanup);
process.on('SIGTERM', () => { cleanup(); process.exit(0); });
process.on('SIGINT', () => { cleanup(); process.exit(0); });
