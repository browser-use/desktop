import { ipcMain } from 'electron';
import { mainLogger } from '../logger';
import type { ChannelRouter } from './ChannelRouter';
import type { WhatsAppAdapter } from './WhatsAppAdapter';

const CH_WA_CONNECT = 'channels:whatsapp:connect';
const CH_WA_DISCONNECT = 'channels:whatsapp:disconnect';
const CH_WA_STATUS = 'channels:whatsapp:status';
const CH_WA_CLEAR_AUTH = 'channels:whatsapp:clear-auth';

export function registerChannelHandlers(
  _router: ChannelRouter,
  adapter: WhatsAppAdapter,
): void {
  mainLogger.info('channels.ipc.register');

  ipcMain.handle(CH_WA_CONNECT, async () => {
    mainLogger.info('channels.whatsapp.connect');
    await adapter.connect();
    return { status: adapter.status };
  });

  ipcMain.handle(CH_WA_DISCONNECT, async () => {
    mainLogger.info('channels.whatsapp.disconnect');
    await adapter.disconnect();
    return { status: adapter.status };
  });

  ipcMain.handle(CH_WA_STATUS, () => {
    return {
      status: adapter.status,
      identity: adapter.getIdentity(),
    };
  });

  ipcMain.handle(CH_WA_CLEAR_AUTH, async () => {
    mainLogger.info('channels.whatsapp.clearAuth');
    await adapter.clearAuth();
    return { status: adapter.status };
  });
}

export function unregisterChannelHandlers(): void {
  mainLogger.info('channels.ipc.unregister');
  ipcMain.removeHandler(CH_WA_CONNECT);
  ipcMain.removeHandler(CH_WA_DISCONNECT);
  ipcMain.removeHandler(CH_WA_STATUS);
  ipcMain.removeHandler(CH_WA_CLEAR_AUTH);
}
