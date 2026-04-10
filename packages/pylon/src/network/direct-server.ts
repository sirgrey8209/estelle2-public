// packages/pylon/src/network/direct-server.ts
import { WebSocketServer, WebSocket } from 'ws';

export interface DirectServerOptions {
  port: number;
  pylonIndex: number;
  deviceId: number;
  onConnection: (ws: WebSocket) => void;
  onMessage: (data: unknown, ws: WebSocket) => void;
  onDisconnect: (ws: WebSocket) => void;
}

function isPrivateIp(ip: string): boolean {
  if (ip === '::1' || ip === '::ffff:127.0.0.1' || ip === '127.0.0.1') return true;
  const v4 = ip.replace('::ffff:', '');
  const parts = v4.split('.').map(Number);
  if (parts.length !== 4) return true; // localhost variants
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  return false;
}

export class DirectServer {
  private wss: WebSocketServer | null = null;
  private clients = new Set<WebSocket>();

  constructor(private options: DirectServerOptions) {}

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ port: this.options.port }, () => resolve());

      this.wss.on('connection', (ws, req) => {
        const ip = req.socket.remoteAddress ?? '';

        if (!isPrivateIp(ip)) {
          ws.close(1008, 'non-local connection rejected');
          return;
        }

        this.clients.add(ws);

        // Handshake: send pylonIndex and deviceId
        ws.send(JSON.stringify({
          type: 'direct_auth',
          pylonIndex: this.options.pylonIndex,
          deviceId: this.options.deviceId,
        }));

        this.options.onConnection(ws);

        ws.on('message', (data) => {
          try {
            const parsed = JSON.parse(data.toString());
            this.options.onMessage(parsed, ws);
          } catch {
            // invalid message — ignore
          }
        });

        ws.on('close', () => {
          this.clients.delete(ws);
          this.options.onDisconnect(ws);
        });

        // No heartbeat — local network doesn't need it
      });
    });
  }

  sendTo(ws: WebSocket, data: string): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }

  async stop(): Promise<void> {
    for (const ws of this.clients) {
      ws.close();
    }
    this.clients.clear();
    return new Promise((resolve) => {
      this.wss?.close(() => resolve());
      if (!this.wss) resolve();
    });
  }
}
