// packages/core/src/network/direct-router.test.ts
import { describe, it, expect, vi } from 'vitest';
import { DirectRouter } from './direct-router.js';

// Mock WebSocket-like object
function createMockWs() {
  return {
    send: vi.fn(),
    readyState: 1, // OPEN
    OPEN: 1,
  };
}

describe('DirectRouter', () => {
  describe('addDirect / removeDirect / hasDirect', () => {
    it('manages direct connections', () => {
      const router = new DirectRouter();
      const ws = createMockWs();

      expect(router.hasDirect(65)).toBe(false);
      router.addDirect(65, ws as any);
      expect(router.hasDirect(65)).toBe(true);
      router.removeDirect(65);
      expect(router.hasDirect(65)).toBe(false);
    });
  });

  describe('splitTargets', () => {
    it('routes to: [directDevice] entirely to direct', () => {
      const router = new DirectRouter();
      const ws = createMockWs();
      router.addDirect(65, ws as any);

      const msg = { type: 'test', payload: {}, timestamp: 0, to: [65] };
      const result = router.splitTargets(msg);

      expect(result.directTargets.size).toBe(1);
      expect(result.directTargets.get(65)).toBe(ws);
      expect(result.relayMessage).toBeNull();
    });

    it('routes to: [directDevice, relayDevice] to both', () => {
      const router = new DirectRouter();
      const ws = createMockWs();
      router.addDirect(65, ws as any);

      const msg = { type: 'test', payload: {}, timestamp: 0, to: [65, 80] };
      const result = router.splitTargets(msg);

      expect(result.directTargets.size).toBe(1);
      expect(result.relayMessage).not.toBeNull();
      expect(result.relayMessage!.to).toEqual([80]);
    });

    it('routes broadcast with exclude for direct devices', () => {
      const router = new DirectRouter();
      const ws = createMockWs();
      router.addDirect(65, ws as any);

      const msg = { type: 'test', payload: {}, timestamp: 0, broadcast: 'all' as const };
      const result = router.splitTargets(msg as any);

      expect(result.directTargets.size).toBe(1);
      expect(result.relayMessage).not.toBeNull();
      expect((result.relayMessage as any).broadcast).toBe('all');
      expect(result.relayMessage!.exclude).toEqual([65]);
    });

    it('passes through when no direct connections', () => {
      const router = new DirectRouter();
      const msg = { type: 'test', payload: {}, timestamp: 0, to: [80] };
      const result = router.splitTargets(msg);

      expect(result.directTargets.size).toBe(0);
      expect(result.relayMessage).toEqual(msg);
    });

    it('passes through when no to/broadcast', () => {
      const router = new DirectRouter();
      const ws = createMockWs();
      router.addDirect(65, ws as any);

      const msg = { type: 'test', payload: {}, timestamp: 0 };
      const result = router.splitTargets(msg);

      expect(result.directTargets.size).toBe(0);
      expect(result.relayMessage).toEqual(msg);
    });

    it('merges with existing exclude', () => {
      const router = new DirectRouter();
      const ws = createMockWs();
      router.addDirect(65, ws as any);

      const msg = { type: 'test', payload: {}, timestamp: 0, broadcast: 'all' as const, exclude: [99] };
      const result = router.splitTargets(msg as any);

      expect(result.relayMessage!.exclude).toEqual([99, 65]);
    });

    it('skips disconnected direct ws', () => {
      const router = new DirectRouter();
      const ws = createMockWs();
      ws.readyState = 3; // CLOSED
      router.addDirect(65, ws as any);

      const msg = { type: 'test', payload: {}, timestamp: 0, to: [65] };
      const result = router.splitTargets(msg);

      expect(result.directTargets.size).toBe(0);
      expect(result.relayMessage).toEqual(msg); // falls back to relay
    });

    it('getDirectDeviceIds returns all registered ids', () => {
      const router = new DirectRouter();
      const ws1 = createMockWs();
      const ws2 = createMockWs();
      router.addDirect(65, ws1 as any);
      router.addDirect(80, ws2 as any);

      expect(router.getDirectDeviceIds().sort()).toEqual([65, 80]);
    });
  });
});
