import { describe, it, expect, vi } from 'vitest';
import { ListenTunnel, ConnectTunnel } from './tunnel.js';
import { WebSocketServer, WebSocket } from 'ws';
import net from 'net';

// Find available port
function getPort(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
  });
}

describe('ListenTunnel', () => {
  it('accepts WebSocket connection and calls onConnection', async () => {
    const port = await getPort();
    const onConnection = vi.fn();
    const onMessage = vi.fn();

    const tunnel = new ListenTunnel(port);
    tunnel.onConnection = onConnection;
    tunnel.onMessage = onMessage;
    await tunnel.start();

    const ws = new WebSocket(`ws://localhost:${port}`);
    await new Promise<void>((resolve) => {
      ws.on('open', resolve);
    });

    expect(onConnection).toHaveBeenCalled();

    ws.send('hello');
    await new Promise((r) => setTimeout(r, 50));
    expect(onMessage).toHaveBeenCalledWith('hello');

    ws.close();
    await tunnel.stop();
  });
});

describe('ConnectTunnel', () => {
  it('connects to target and forwards messages', async () => {
    const port = await getPort();
    const received: string[] = [];

    // Start a mock WS server (acting as Relay)
    const wss = new WebSocketServer({ port });
    wss.on('connection', (ws) => {
      ws.on('message', (data) => received.push(data.toString()));
    });

    const tunnel = new ConnectTunnel(`ws://localhost:${port}`);
    await tunnel.connect();

    tunnel.sendToTarget('msg1');
    tunnel.sendToTarget('msg2');
    await new Promise((r) => setTimeout(r, 50));

    expect(received).toEqual(['msg1', 'msg2']);

    await tunnel.disconnect();
    wss.close();
  });
});
