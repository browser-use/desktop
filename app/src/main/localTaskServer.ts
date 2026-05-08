import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';

export const LOCAL_TASK_CONTROL_FILE = 'local-task-server.json';

export interface LocalTaskPayload {
  prompt: string;
  engine?: string;
}

export interface LocalTaskServerOptions {
  userDataPath: string;
  submitTask: (payload: LocalTaskPayload) => Promise<Record<string, unknown>>;
  log?: {
    info(msg: string, extra?: Record<string, unknown>): void;
    warn(msg: string, extra?: Record<string, unknown>): void;
  };
}

export interface LocalTaskServerHandle {
  url: string;
  token: string;
  controlPath: string;
  close(): Promise<void>;
}

interface ControlFile {
  version: 1;
  pid: number;
  url: string;
  token: string;
  createdAt: string;
}

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(raw),
  });
  res.end(raw);
}

function readBody(req: IncomingMessage, maxBytes = 256 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    req.setEncoding('utf-8');
    req.on('data', (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxBytes) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function isAuthorized(req: IncomingMessage, token: string): boolean {
  const auth = req.headers.authorization;
  if (auth === `Bearer ${token}`) return true;
  return req.headers['x-browser-use-token'] === token;
}

function parsePayload(raw: string): LocalTaskPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('request body must be JSON');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('request body must be an object');
  }
  const obj = parsed as { prompt?: unknown; engine?: unknown };
  if (typeof obj.prompt !== 'string' || obj.prompt.trim().length === 0) {
    throw new Error('prompt must be a non-empty string');
  }
  if (obj.prompt.length > 10000) {
    throw new Error('prompt is too long');
  }
  if (obj.engine != null && (typeof obj.engine !== 'string' || obj.engine.length > 50)) {
    throw new Error('engine must be a string up to 50 characters');
  }
  const engine = typeof obj.engine === 'string' ? obj.engine : undefined;
  return {
    prompt: obj.prompt,
    engine,
  };
}

function writeControlFile(controlPath: string, control: ControlFile): void {
  fs.mkdirSync(path.dirname(controlPath), { recursive: true });
  const tmp = `${controlPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(control, null, 2), { encoding: 'utf-8', mode: 0o600 });
  fs.renameSync(tmp, controlPath);
  try {
    fs.chmodSync(controlPath, 0o600);
  } catch {
    // Best effort on platforms without POSIX-style chmod.
  }
}

function removeControlFile(controlPath: string, token: string): void {
  try {
    const raw = fs.readFileSync(controlPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ControlFile>;
    if (parsed.token !== token) return;
    fs.rmSync(controlPath, { force: true });
  } catch {
    // Missing or malformed files are safe to ignore during shutdown.
  }
}

export async function createLocalTaskServer(opts: LocalTaskServerOptions): Promise<LocalTaskServerHandle> {
  const token = randomBytes(24).toString('base64url');
  const controlPath = path.join(opts.userDataPath, LOCAL_TASK_CONTROL_FILE);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (url.pathname === '/health' && req.method === 'GET') {
      if (!isAuthorized(req, token)) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname !== '/tasks' || req.method !== 'POST') {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }

    if (!isAuthorized(req, token)) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }

    try {
      const payload = parsePayload(await readBody(req));
      const result = await opts.submitTask(payload);
      sendJson(res, 200, { ok: true, ...result });
    } catch (err) {
      const message = (err as Error).message || 'local task submission failed';
      opts.log?.warn('localTaskServer.submit.failed', { error: message });
      sendJson(res, 400, { ok: false, error: message });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('local task server did not bind to a TCP port');
  }

  const url = `http://127.0.0.1:${address.port}`;
  writeControlFile(controlPath, {
    version: 1,
    pid: process.pid,
    url,
    token,
    createdAt: new Date().toISOString(),
  });
  opts.log?.info('localTaskServer.started', { url, controlPath });

  return {
    url,
    token,
    controlPath,
    close: () => new Promise<void>((resolve) => {
      removeControlFile(controlPath, token);
      server.close(() => {
        opts.log?.info('localTaskServer.stopped', { controlPath });
        resolve();
      });
    }),
  };
}
