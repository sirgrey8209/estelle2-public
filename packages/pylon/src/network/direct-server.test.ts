import { describe, it, expect, vi, afterEach } from 'vitest';
import { DirectServer } from './direct-server.js';
import { WebSocket } from 'ws';
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

/**
 * Connect a client and collect all received messages in a buffer.
 * Returns the client and the messages array.
 * The message listener is registered BEFORE the open event to avoid race conditions.
 */
function connectClient(port: number): Promise<{ ws: WebSocket; messages: unknown[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const messages: unknown[] = [];

    // Register message listener BEFORE open to avoid missing early messages
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    ws.on('open', () => resolve({ ws, messages }));
    ws.on('error', reject);
  });
}

/** Wait until the messages array has at least `count` items */
function waitForMessages(messages: unknown[], count: number, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (messages.length >= count) {
      resolve();
      return;
    }
    const start = Date.now();
    const interval = setInterval(() => {
      if (messages.length >= count) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error(`Timed out waiting for ${count} messages, got ${messages.length}`));
      }
    }, 10);
  });
}

describe('DirectServer', () => {
  let server: DirectServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it('should accept local connection and send handshake with correct pylonIndex/deviceId', async () => {
    const port = await getPort();
    const onConnection = vi.fn();
    const onMessage = vi.fn();
    const onDisconnect = vi.fn();

    server = new DirectServer({
      port,
      pylonIndex: 3,
      deviceId: 42,
      onConnection,
      onMessage,
      onDisconnect,
    });

    await server.start();

    const { ws: client, messages } = await connectClient(port);
    await waitForMessages(messages, 1);

    expect(messages[0]).toEqual({
      type: 'direct_auth',
      pylonIndex: 3,
      deviceId: 42,
    });

    expect(onConnection).toHaveBeenCalledOnce();

    client.close();
    await new Promise((r) => setTimeout(r, 100));
  });

  it('should forward messages via onMessage callback', async () => {
    const port = await getPort();
    const onConnection = vi.fn();
    const onMessage = vi.fn();
    const onDisconnect = vi.fn();

    server = new DirectServer({
      port,
      pylonIndex: 1,
      deviceId: 10,
      onConnection,
      onMessage,
      onDisconnect,
    });

    await server.start();

    const { ws: client, messages } = await connectClient(port);
    // Wait for handshake
    await waitForMessages(messages, 1);

    const testPayload = { type: 'test', value: 'hello' };
    client.send(JSON.stringify(testPayload));

    // Wait for server to process the message
    await new Promise((r) => setTimeout(r, 100));

    expect(onMessage).toHaveBeenCalledOnce();
    expect(onMessage).toHaveBeenCalledWith(
      testPayload,
      expect.any(Object), // WebSocket instance
    );

    client.close();
    await new Promise((r) => setTimeout(r, 100));
  });

  it('should NOT send heartbeat (only handshake message received after 2 seconds)', async () => {
    const port = await getPort();
    const onConnection = vi.fn();
    const onMessage = vi.fn();
    const onDisconnect = vi.fn();

    server = new DirectServer({
      port,
      pylonIndex: 0,
      deviceId: 1,
      onConnection,
      onMessage,
      onDisconnect,
    });

    await server.start();

    const { ws: client, messages } = await connectClient(port);

    // Wait 2 seconds — should only receive the handshake, no heartbeat
    await new Promise((r) => setTimeout(r, 2000));

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      type: 'direct_auth',
      pylonIndex: 0,
      deviceId: 1,
    });

    client.close();
    await new Promise((r) => setTimeout(r, 100));
  }, 5000);

  it('should call onDisconnect when client disconnects', async () => {
    const port = await getPort();
    const onConnection = vi.fn();
    const onMessage = vi.fn();
    const onDisconnect = vi.fn();

    server = new DirectServer({
      port,
      pylonIndex: 2,
      deviceId: 5,
      onConnection,
      onMessage,
      onDisconnect,
    });

    await server.start();

    const { ws: client, messages } = await connectClient(port);
    // Wait for handshake
    await waitForMessages(messages, 1);

    expect(onDisconnect).not.toHaveBeenCalled();

    client.close();

    // Wait for the close event to propagate
    await new Promise((r) => setTimeout(r, 200));

    expect(onDisconnect).toHaveBeenCalledOnce();
  });

  it('should allow sending data to a specific client via sendTo', async () => {
    const port = await getPort();
    let connectedWs: WebSocket | null = null;
    const onConnection = vi.fn((ws: WebSocket) => {
      connectedWs = ws;
    });
    const onMessage = vi.fn();
    const onDisconnect = vi.fn();

    server = new DirectServer({
      port,
      pylonIndex: 1,
      deviceId: 7,
      onConnection,
      onMessage,
      onDisconnect,
    });

    await server.start();

    const { ws: client, messages } = await connectClient(port);
    // Wait for handshake
    await waitForMessages(messages, 1);

    // Now send a message via sendTo
    server.sendTo(connectedWs!, JSON.stringify({ type: 'test_response', data: 123 }));

    await waitForMessages(messages, 2);

    expect(messages[1]).toEqual({ type: 'test_response', data: 123 });

    client.close();
    await new Promise((r) => setTimeout(r, 100));
  });
});
