import { WebSocketServer, WebSocket } from 'ws';
import type { WebContents } from 'electron';
import { mainLogger } from '../logger';

export interface CdpProxy {
  wsUrl: string;
  port: number;
  close: () => void;
}

export function createCdpProxy(webContents: WebContents, sessionId: string): Promise<CdpProxy> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });

    wss.on('error', (err) => {
      mainLogger.error('cdpProxy.serverError', { sessionId, error: err.message });
      reject(err);
    });

    wss.on('listening', () => {
      const addr = wss.address();
      if (typeof addr === 'string' || !addr) {
        reject(new Error('Failed to get proxy address'));
        return;
      }
      const port = addr.port;
      const wsUrl = `ws://127.0.0.1:${port}`;
      mainLogger.info('cdpProxy.listening', { sessionId, port, wsUrl });

      try {
        if (!webContents.debugger.isAttached()) {
          webContents.debugger.attach('1.3');
        }
      } catch (err) {
        mainLogger.warn('cdpProxy.debuggerAttach', { sessionId, error: (err as Error).message });
      }

      wss.on('connection', (ws: WebSocket) => {
        mainLogger.info('cdpProxy.clientConnected', { sessionId });
        let nextId = 1;
        const pendingRequests = new Map<number, number>();

        ws.on('message', async (data: Buffer) => {
          try {
            const msg = JSON.parse(data.toString());
            const clientId = msg.id;
            const internalId = nextId++;
            pendingRequests.set(internalId, clientId);

            const result = await webContents.debugger.sendCommand(msg.method, msg.params || {});
            ws.send(JSON.stringify({ id: clientId, result }));
            pendingRequests.delete(internalId);
          } catch (err) {
            try {
              const msg = JSON.parse(data.toString());
              ws.send(JSON.stringify({ id: msg.id, error: { message: (err as Error).message } }));
            } catch { /* ignore parse errors */ }
          }
        });

        webContents.debugger.on('message', (_event: Electron.Event, method: string, params: unknown) => {
          try {
            ws.send(JSON.stringify({ method, params }));
          } catch { /* client disconnected */ }
        });

        ws.on('close', () => {
          mainLogger.info('cdpProxy.clientDisconnected', { sessionId });
        });
      });

      const close = () => {
        try { wss.close(); } catch { /* already closed */ }
        try { if (webContents.debugger.isAttached()) webContents.debugger.detach(); } catch { /* already detached */ }
        mainLogger.info('cdpProxy.closed', { sessionId });
      };

      resolve({ wsUrl, port, close });
    });
  });
}
