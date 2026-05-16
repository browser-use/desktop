import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('chatfile protocol', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('electron');
  });

  it('allows files under outputs when userData is reached through a symlink', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chatfile-root-'));
    const realUserData = path.join(tmp, 'real-user-data');
    const symlinkUserData = path.join(tmp, 'linked-user-data');
    const realOutputs = path.join(realUserData, 'harness', 'outputs');
    fs.mkdirSync(realOutputs, { recursive: true });
    fs.symlinkSync(realUserData, symlinkUserData, 'dir');
    const realFile = path.join(realOutputs, 'shot.png');
    fs.writeFileSync(realFile, 'png');
    const requestedViaSymlink = path.join(symlinkUserData, 'harness', 'outputs', 'shot.png');

    let handler: ((req: { url: string }) => Promise<Response>) | null = null;
    const fetch = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.doMock('electron', () => ({
      app: {
        getPath: (name: string) => (name === 'userData' ? symlinkUserData : tmp),
      },
      protocol: {
        handle: vi.fn((_scheme: string, cb: (req: { url: string }) => Promise<Response>) => {
          handler = cb;
        }),
      },
      net: { fetch },
    }));

    const { registerChatfileHandler } = await import('../../../src/main/protocols/chatfile');
    registerChatfileHandler();
    expect(handler).not.toBeNull();

    const res = await handler!({ url: `chatfile://files${encodeURI(requestedViaSymlink)}` });

    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(pathToFileURL(fs.realpathSync(realFile)).toString());
  });
});
