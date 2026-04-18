/**
 * ipc.ts — history IPC bindings.
 * Registers `history:*` handlers for querying, searching, and deleting
 * browsing history entries.
 */

import { ipcMain } from 'electron';
import { HistoryStore } from './HistoryStore';
import { assertString } from '../ipc-validators';
import { mainLogger } from '../logger';

const CHANNELS = [
  'history:query',
  'history:remove',
  'history:remove-bulk',
  'history:clear-all',
] as const;

export interface HistoryIpcOptions {
  store: HistoryStore;
}

export function registerHistoryHandlers(opts: HistoryIpcOptions): void {
  const { store } = opts;

  ipcMain.handle('history:query', (_e, payload?: { query?: string; limit?: number; offset?: number }) => {
    const query = payload?.query ?? '';
    const limit = typeof payload?.limit === 'number' ? Math.min(payload.limit, 500) : 100;
    const offset = typeof payload?.offset === 'number' ? Math.max(payload.offset, 0) : 0;
    mainLogger.debug('history:query', { query, limit, offset });
    return store.query({ query, limit, offset });
  });

  ipcMain.handle('history:remove', (_e, id: string) => {
    assertString(id, 'id', 128);
    mainLogger.debug('history:remove', { id });
    return store.removeEntry(id);
  });

  ipcMain.handle('history:remove-bulk', (_e, ids: string[]) => {
    if (!Array.isArray(ids)) throw new Error('ids must be an array');
    if (ids.length > 1000) throw new Error('Too many ids (max 1000)');
    for (const id of ids) assertString(id, 'id', 128);
    mainLogger.debug('history:remove-bulk', { count: ids.length });
    return store.removeEntries(ids);
  });

  ipcMain.handle('history:clear-all', () => {
    mainLogger.info('history:clear-all');
    store.clearAll();
    return true;
  });
}

export function unregisterHistoryHandlers(): void {
  for (const channel of CHANNELS) {
    ipcMain.removeHandler(channel);
  }
}
