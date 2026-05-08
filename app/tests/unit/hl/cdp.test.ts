import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

const { loggerSpy } = vi.hoisted(() => ({
  loggerSpy: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../src/main/logger', () => ({ mainLogger: loggerSpy }));

import { cdpForWebContents } from '../../../src/main/hl/cdp';

class FakeDebugger extends EventEmitter {
  attach = vi.fn();
  detach = vi.fn(() => {
    this.emit('detach', {}, 'closed');
  });
  sendCommand = vi.fn(async () => ({}));
}

function makeWebContents(debuggerInstance = new FakeDebugger()): Electron.WebContents {
  return { debugger: debuggerInstance } as unknown as Electron.WebContents;
}

describe('hl/cdp WebContents transport cleanup', () => {
  it('does not duplicate debugger listeners when reattaching after external detach', async () => {
    const dbg = new FakeDebugger();
    const client = cdpForWebContents(makeWebContents(dbg));

    expect(dbg.listenerCount('message')).toBe(1);
    expect(dbg.listenerCount('detach')).toBe(1);

    dbg.emit('detach', {}, 'external');
    await client.send('Runtime.evaluate');

    expect(dbg.listenerCount('message')).toBe(1);
    expect(dbg.listenerCount('detach')).toBe(1);
  });

  it('removes debugger listeners even if the debugger detached before close', async () => {
    const dbg = new FakeDebugger();
    const client = cdpForWebContents(makeWebContents(dbg));

    dbg.emit('detach', {}, 'external');
    await client.close();

    expect(dbg.listenerCount('message')).toBe(0);
    expect(dbg.listenerCount('detach')).toBe(0);
  });
});
