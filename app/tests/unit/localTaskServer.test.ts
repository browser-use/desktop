import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLocalTaskServer, LOCAL_TASK_CONTROL_FILE } from '../../src/main/localTaskServer';

const handles: Array<{ close(): Promise<void> }> = [];
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-task-server-'));
  tempDirs.push(dir);
  return dir;
}

describe('localTaskServer', () => {
  afterEach(async () => {
    await Promise.all(handles.splice(0).map((h) => h.close()));
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes a control file and accepts authorized task submissions', async () => {
    const userDataPath = makeTempDir();
    const seen: unknown[] = [];
    const handle = await createLocalTaskServer({
      userDataPath,
      submitTask: async (payload) => {
        seen.push(payload);
        return { id: 'session-1', started: true };
      },
    });
    handles.push(handle);

    const controlPath = path.join(userDataPath, LOCAL_TASK_CONTROL_FILE);
    expect(fs.existsSync(controlPath)).toBe(true);

    const res = await fetch(`${handle.url}/tasks`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${handle.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ prompt: 'test prompt', engine: 'codex' }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, id: 'session-1', started: true });
    expect(seen).toEqual([{ prompt: 'test prompt', engine: 'codex' }]);
  });

  it('rejects requests without the control token', async () => {
    const handle = await createLocalTaskServer({
      userDataPath: makeTempDir(),
      submitTask: async () => ({ id: 'should-not-run' }),
    });
    handles.push(handle);

    const res = await fetch(`${handle.url}/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'test prompt' }),
    });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'unauthorized' });
  });

  it('removes its own control file when closed', async () => {
    const userDataPath = makeTempDir();
    const handle = await createLocalTaskServer({
      userDataPath,
      submitTask: async () => ({ id: 'session-1' }),
    });
    const controlPath = path.join(userDataPath, LOCAL_TASK_CONTROL_FILE);
    expect(fs.existsSync(controlPath)).toBe(true);

    await handle.close();

    expect(fs.existsSync(controlPath)).toBe(false);
  });
});
