import { WebSocketServer, WebSocket } from 'ws';

export class ListenTunnel {
  private wss: WebSocketServer | null = null;
  private client: WebSocket | null = null;

  onConnection: (() => void) | null = null;
  onMessage: ((data: string) => void) | null = null;
  onDisconnect: (() => void) | null = null;

  constructor(private port: number) {}

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ port: this.port }, () => resolve());

      this.wss.on('connection', (ws) => {
        // Single connection only — reject if already connected
        if (this.client) {
          ws.close(1013, 'tunnel busy');
          return;
        }

        this.client = ws;
        this.onConnection?.();

        ws.on('message', (data) => {
          this.onMessage?.(data.toString());
        });

        ws.on('close', () => {
          this.client = null;
          this.onDisconnect?.();
        });
      });
    });
  }

  sendToClient(data: string): void {
    if (this.client && this.client.readyState === WebSocket.OPEN) {
      this.client.send(data);
    }
  }

  get isConnected(): boolean {
    return this.client !== null && this.client.readyState === WebSocket.OPEN;
  }

  async stop(): Promise<void> {
    this.client?.close();
    this.client = null;
    return new Promise((resolve) => {
      this.wss?.close(() => resolve());
      if (!this.wss) resolve();
    });
  }
}

export class ConnectTunnel {
  private ws: WebSocket | null = null;

  onMessage: ((data: string) => void) | null = null;
  onDisconnect: (() => void) | null = null;

  constructor(private target: string) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.target);
      this.ws.on('open', () => resolve());
      this.ws.on('error', (err) => reject(err));

      this.ws.on('message', (data) => {
        this.onMessage?.(data.toString());
      });

      this.ws.on('close', () => {
        this.ws = null;
        this.onDisconnect?.();
      });
    });
  }

  sendToTarget(data: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  async disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.ws) {
        resolve();
        return;
      }
      this.ws.on('close', () => resolve());
      this.ws.close();
    });
  }
}
