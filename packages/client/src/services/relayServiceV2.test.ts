// packages/client/src/services/relayServiceV2.test.ts
import { describe, it, expect, vi } from 'vitest';
import { RelayServiceV2 } from './relayServiceV2.js';

function createMockWs() {
  return { send: vi.fn(), readyState: 1, OPEN: 1 };
}

describe('RelayServiceV2', () => {
  it('sends to relay when no direct connections', () => {
    const relaySend = vi.fn();
    const service = new RelayServiceV2({ relaySend });
    service.send({ type: 'test', payload: {}, timestamp: 0, to: [65] });
    expect(relaySend).toHaveBeenCalledWith(expect.objectContaining({ type: 'test', to: [65] }));
  });

  it('sends to direct when device is directly connected', () => {
    const relaySend = vi.fn();
    const directWs = createMockWs();
    const service = new RelayServiceV2({ relaySend });
    service.addDirect(65, directWs as any);
    service.send({ type: 'test', payload: {}, timestamp: 0, to: [65] });
    expect(directWs.send).toHaveBeenCalled();
    expect(relaySend).not.toHaveBeenCalled();
  });

  it('adds exclude for broadcast', () => {
    const relaySend = vi.fn();
    const directWs = createMockWs();
    const service = new RelayServiceV2({ relaySend });
    service.addDirect(65, directWs as any);
    service.send({ type: 'test', payload: {}, timestamp: 0, broadcast: 'pylons' } as any);
    expect(directWs.send).toHaveBeenCalled();
    expect(relaySend).toHaveBeenCalledWith(expect.objectContaining({ exclude: [65] }));
  });

  it('handleDirectMessage calls onMessage callback', () => {
    const service = new RelayServiceV2({ relaySend: vi.fn() });
    const callback = vi.fn();
    service.onMessage(callback);
    service.handleDirectMessage({ type: 'test', payload: 'hello' });
    expect(callback).toHaveBeenCalledWith({ type: 'test', payload: 'hello' });
  });

  it('hasDirect returns correct state', () => {
    const service = new RelayServiceV2({ relaySend: vi.fn() });
    const ws = createMockWs();
    expect(service.hasDirect(65)).toBe(false);
    service.addDirect(65, ws as any);
    expect(service.hasDirect(65)).toBe(true);
    service.removeDirect(65);
    expect(service.hasDirect(65)).toBe(false);
  });
});

describe('RelayServiceV2.parseDirectUrl', () => {
  it('extracts URL from ?direct param', () => {
    expect(RelayServiceV2.parseDirectUrl('?direct=ws://192.168.1.100:5000'))
      .toBe('ws://192.168.1.100:5000');
  });

  it('returns null when no direct param', () => {
    expect(RelayServiceV2.parseDirectUrl('?foo=bar')).toBeNull();
  });

  it('returns null for empty search', () => {
    expect(RelayServiceV2.parseDirectUrl('')).toBeNull();
  });

  it('handles direct param with other params', () => {
    expect(RelayServiceV2.parseDirectUrl('?theme=dark&direct=ws://10.0.0.1:3000&lang=ko'))
      .toBe('ws://10.0.0.1:3000');
  });
});
