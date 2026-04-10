import { describe, it, expect } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { ListenTunnel, ConnectTunnel } from './tunnel.js';
import { Throttle } from './throttle.js';
import { encode, decode } from './codec.js';
import net from 'net';

function getPort(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
  });
}

describe('integration: WS → encode → decode → WS', () => {
  it('round-trips messages through the full pipeline', async () => {
    const listenPort = await getPort();
    const targetPort = await getPort();

    const received: string[] = [];

    // 1. Set up "target" WS server (simulates Relay)
    const targetWss = new WebSocketServer({ port: targetPort });
    targetWss.on('connection', (ws) => {
      ws.on('message', (data) => received.push(data.toString()));
    });

    // 2. Set up connect tunnel (connects to target)
    const connectTunnel = new ConnectTunnel(`ws://localhost:${targetPort}`);
    await connectTunnel.connect();

    // 3. Set up listen tunnel with throttle → encode → decode → connect
    const listenTunnel = new ListenTunnel(listenPort);

    const throttle = new Throttle(100, (messages) => {
      // Simulate: encode → slack → decode
      const encoded = encode(messages);
      const decoded = decode(encoded);
      if (!decoded) return;
      for (const msg of decoded) {
        connectTunnel.sendToTarget(msg);
      }
    });

    listenTunnel.onMessage = (data) => {
      throttle.push(data);
    };

    await listenTunnel.start();

    // 4. Client connects to listen tunnel (simulates Pylon)
    const client = new WebSocket(`ws://localhost:${listenPort}`);
    await new Promise<void>((resolve) => client.on('open', resolve));

    // 5. Send messages
    client.send('{"type":"ping"}');
    client.send('{"type":"claude_send","payload":"hello"}');

    // Wait for throttle flush + delivery
    await new Promise((r) => setTimeout(r, 300));

    expect(received).toContain('{"type":"ping"}');
    expect(received).toContain('{"type":"claude_send","payload":"hello"}');

    // Cleanup
    client.close();
    throttle.destroy();
    await connectTunnel.disconnect();
    await listenTunnel.stop();
    await new Promise<void>((resolve) => targetWss.close(() => resolve()));
  });
});
