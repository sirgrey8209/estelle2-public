// packages/pylon/src/network/relay-client-v2.test.ts
import { describe, it, expect, vi } from 'vitest';
import { RelayClientV2 } from './relay-client-v2.js';

function createMockWs() {
  return { send: vi.fn(), readyState: 1, OPEN: 1 };
}

describe('RelayClientV2', () => {
  it('sends to relay when no direct connections', () => {
    const relaySend = vi.fn();
    const client = new RelayClientV2({ relaySend });
    client.send({ type: 'test', payload: {}, timestamp: 0, to: [80] });
    expect(relaySend).toHaveBeenCalledWith(expect.objectContaining({ type: 'test', to: [80] }));
  });

  it('sends to direct when device is directly connected', () => {
    const relaySend = vi.fn();
    const directWs = createMockWs();
    const client = new RelayClientV2({ relaySend });
    client.addDirect(80, directWs as any);
    client.send({ type: 'test', payload: {}, timestamp: 0, to: [80] });
    expect(directWs.send).toHaveBeenCalled();
    expect(relaySend).not.toHaveBeenCalled();
  });

  it('splits to direct + relay for mixed targets', () => {
    const relaySend = vi.fn();
    const directWs = createMockWs();
    const client = new RelayClientV2({ relaySend });
    client.addDirect(65, directWs as any);
    client.send({ type: 'test', payload: {}, timestamp: 0, to: [65, 80] });
    expect(directWs.send).toHaveBeenCalled();
    expect(relaySend).toHaveBeenCalledWith(expect.objectContaining({ to: [80] }));
  });

  it('adds exclude for broadcast with direct connections', () => {
    const relaySend = vi.fn();
    const directWs = createMockWs();
    const client = new RelayClientV2({ relaySend });
    client.addDirect(65, directWs as any);
    client.send({ type: 'test', payload: {}, timestamp: 0, broadcast: 'all' } as any);
    expect(directWs.send).toHaveBeenCalled();
    expect(relaySend).toHaveBeenCalledWith(expect.objectContaining({ exclude: [65] }));
  });

  it('hasDirect returns correct state', () => {
    const client = new RelayClientV2({ relaySend: vi.fn() });
    const ws = createMockWs();
    expect(client.hasDirect(65)).toBe(false);
    client.addDirect(65, ws as any);
    expect(client.hasDirect(65)).toBe(true);
    client.removeDirect(65);
    expect(client.hasDirect(65)).toBe(false);
  });
});
