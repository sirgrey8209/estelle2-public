# Direct Connection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** C1(회사 클라이언트)과 P1(회사 Pylon)이 Relay를 거치지 않고 로컬 WebSocket으로 직접 통신하는 기능 구현

**Architecture:** core에 DirectRouter(스플릿 라우팅)를 추가하고, pylon에 DirectServer(직접 WS 서버) + RelayClientV2, client에 RelayServiceV2를 구현. Message 타입에 exclude 필드를 추가하고 Relay router에서 exclude 필터링 처리.

**Tech Stack:** TypeScript, ws, vitest, Estelle monorepo (pnpm)

---

### Task 1: Core - Message 타입에 exclude 필드 추가

**Files:**
- Modify: `packages/core/src/types/message.ts`
- Test: `packages/core/src/types/message.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/core/src/types/message.test.ts
import { describe, it, expect } from 'vitest';
import type { Message } from './message.js';

describe('Message type', () => {
  it('supports exclude field', () => {
    const msg: Message = {
      type: 'test',
      payload: {},
      timestamp: Date.now(),
      broadcast: 'all',
      exclude: [65, 66],
    };
    expect(msg.exclude).toEqual([65, 66]);
  });

  it('exclude is optional', () => {
    const msg: Message = {
      type: 'test',
      payload: {},
      timestamp: Date.now(),
    };
    expect(msg.exclude).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @estelle/core vitest run src/types/message.test.ts`
Expected: FAIL — `exclude` 필드가 Message 인터페이스에 없음

**Step 3: Write minimal implementation**

`packages/core/src/types/message.ts`의 Message 인터페이스에 추가:
```typescript
export interface Message<T = unknown> {
  type: string;
  payload: T;
  timestamp: number;
  from?: DeviceId | null;
  to?: number[] | null;
  exclude?: number[];              // 추가: Relay가 이 deviceId들에는 보내지 않음
  requestId?: string | null;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @estelle/core vitest run src/types/message.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/types/message.ts packages/core/src/types/message.test.ts
git commit -m "feat(core): Message 타입에 exclude 필드 추가"
```

---

### Task 2: Core - DirectRouter 구현

**Files:**
- Create: `packages/core/src/network/direct-router.ts`
- Test: `packages/core/src/network/direct-router.test.ts`
- Modify: `packages/core/src/network/index.ts`

**참고 문서:**
- `packages/core/src/utils/id-system.ts` — `decodeDeviceId()` 함수
- `packages/core/src/types/message.ts` — Message 인터페이스

**Step 1: Write the failing tests**

```typescript
// packages/core/src/network/direct-router.test.ts
import { describe, it, expect, vi } from 'vitest';
import { DirectRouter } from './direct-router.js';

// Mock WebSocket
function createMockWs() {
  return {
    send: vi.fn(),
    readyState: 1, // OPEN
    OPEN: 1,
  } as unknown as import('ws').WebSocket;
}

describe('DirectRouter', () => {
  describe('addDirect / removeDirect / hasDirect', () => {
    it('manages direct connections', () => {
      const router = new DirectRouter();
      const ws = createMockWs();

      expect(router.hasDirect(65)).toBe(false);
      router.addDirect(65, ws);
      expect(router.hasDirect(65)).toBe(true);
      router.removeDirect(65);
      expect(router.hasDirect(65)).toBe(false);
    });
  });

  describe('splitTargets', () => {
    it('routes to: [directDevice] entirely to direct', () => {
      const router = new DirectRouter();
      const ws = createMockWs();
      router.addDirect(65, ws);

      const msg = { type: 'test', payload: {}, timestamp: 0, to: [65] };
      const result = router.splitTargets(msg);

      expect(result.directTargets.size).toBe(1);
      expect(result.directTargets.get(65)).toBe(ws);
      expect(result.relayMessage).toBeNull();
    });

    it('routes to: [directDevice, relayDevice] to both', () => {
      const router = new DirectRouter();
      const ws = createMockWs();
      router.addDirect(65, ws);

      const msg = { type: 'test', payload: {}, timestamp: 0, to: [65, 80] };
      const result = router.splitTargets(msg);

      expect(result.directTargets.size).toBe(1);
      expect(result.relayMessage).not.toBeNull();
      expect(result.relayMessage!.to).toEqual([80]);
    });

    it('routes broadcast with exclude for direct devices', () => {
      const router = new DirectRouter();
      const ws = createMockWs();
      router.addDirect(65, ws);

      const msg = { type: 'test', payload: {}, timestamp: 0, broadcast: 'all' as const };
      const result = router.splitTargets(msg);

      expect(result.directTargets.size).toBe(1);
      expect(result.relayMessage).not.toBeNull();
      expect(result.relayMessage!.broadcast).toBe('all');
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
      router.addDirect(65, ws);

      const msg = { type: 'test', payload: {}, timestamp: 0 };
      const result = router.splitTargets(msg);

      expect(result.directTargets.size).toBe(0);
      expect(result.relayMessage).toEqual(msg);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @estelle/core vitest run src/network/direct-router.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// packages/core/src/network/direct-router.ts
import type { Message } from '../types/message.js';

// WebSocket-like interface (ws 라이브러리 의존 없이)
interface WsLike {
  send(data: string): void;
  readonly readyState: number;
  readonly OPEN: number;
}

export interface SplitResult {
  directTargets: Map<number, WsLike>;  // deviceId → ws
  relayMessage: Message | null;         // relay로 보낼 메시지 (null이면 안 보냄)
}

export class DirectRouter {
  private connections = new Map<number, WsLike>();  // deviceId → ws

  addDirect(deviceId: number, ws: WsLike): void {
    this.connections.set(deviceId, ws);
  }

  removeDirect(deviceId: number): void {
    this.connections.delete(deviceId);
  }

  hasDirect(deviceId: number): boolean {
    return this.connections.has(deviceId);
  }

  getDirectDeviceIds(): number[] {
    return Array.from(this.connections.keys());
  }

  splitTargets(msg: Message): SplitResult {
    const directTargets = new Map<number, WsLike>();

    // to도 broadcast도 없으면 relay로 그대로 전달
    if (!msg.to && !msg.broadcast) {
      return { directTargets, relayMessage: msg };
    }

    // 직접 연결이 없으면 relay로 그대로 전달
    if (this.connections.size === 0) {
      return { directTargets, relayMessage: msg };
    }

    // to 필드가 있는 경우: 대상별로 분리
    if (msg.to && Array.isArray(msg.to)) {
      const relayTo: number[] = [];

      for (const deviceId of msg.to) {
        const ws = this.connections.get(deviceId);
        if (ws && ws.readyState === ws.OPEN) {
          directTargets.set(deviceId, ws);
        } else {
          relayTo.push(deviceId);
        }
      }

      const relayMessage = relayTo.length > 0
        ? { ...msg, to: relayTo }
        : null;

      return { directTargets, relayMessage };
    }

    // broadcast인 경우: 직접 연결 대상에게는 직접 보내고, relay에는 exclude 추가
    if (msg.broadcast) {
      const excludeIds: number[] = [];

      for (const [deviceId, ws] of this.connections) {
        if (ws.readyState === ws.OPEN) {
          directTargets.set(deviceId, ws);
          excludeIds.push(deviceId);
        }
      }

      const existingExclude = msg.exclude ?? [];
      const relayMessage: Message = {
        ...msg,
        exclude: [...existingExclude, ...excludeIds],
      };

      return { directTargets, relayMessage };
    }

    return { directTargets, relayMessage: msg };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @estelle/core vitest run src/network/direct-router.test.ts`
Expected: PASS

**Step 5: Export from index**

`packages/core/src/network/index.ts`에 추가:
```typescript
export { DirectRouter, type SplitResult } from './direct-router.js';
```

**Step 6: Commit**

```bash
git add packages/core/src/network/direct-router.ts packages/core/src/network/direct-router.test.ts packages/core/src/network/index.ts
git commit -m "feat(core): DirectRouter - 스플릿 라우팅 로직"
```

---

### Task 3: Relay - exclude 필터링 추가

**Files:**
- Modify: `packages/relay/src/router.ts`
- Test: `packages/relay/src/router.test.ts` (기존 테스트에 추가)

**참고:** Relay의 `routeMessage()`에서 `exclude` 필드를 처리. 현재 broadcast 함수들은 `excludeClientId` (발신자 제외)만 지원. `exclude` 배열은 deviceId 기반이므로 다른 로직.

**Step 1: Write the failing test**

기존 router.test.ts에 추가:
```typescript
describe('exclude filtering', () => {
  it('excludes devices listed in message.exclude from routeByTo', () => {
    // Client Map에 deviceId 65 (Pylon 1)와 deviceId 80 (Client)가 있는 상태
    // message.to = [65, 80], message.exclude = [65]
    // → 65는 제외, 80만 targetClientIds에 포함
    const clients = createTestClients([
      { clientId: 'c1', deviceId: 65, deviceType: 'pylon', authenticated: true },
      { clientId: 'c2', deviceId: 80, deviceType: 'app', authenticated: true },
    ]);

    const msg = { type: 'test', to: [65, 80], exclude: [65] };
    const result = routeMessage(msg as any, 'sender', 'app', clients);

    expect(result.targetClientIds).not.toContain('c1');
    expect(result.targetClientIds).toContain('c2');
  });

  it('excludes devices from broadcast', () => {
    const clients = createTestClients([
      { clientId: 'c1', deviceId: 65, deviceType: 'pylon', authenticated: true },
      { clientId: 'c2', deviceId: 80, deviceType: 'app', authenticated: true },
    ]);

    const msg = { type: 'test', broadcast: 'all', exclude: [65] };
    const result = routeMessage(msg as any, 'sender', 'app', clients);

    expect(result.targetClientIds).not.toContain('c1');
    expect(result.targetClientIds).toContain('c2');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @estelle/relay vitest run src/router.test.ts`
Expected: FAIL — exclude가 무시됨

**Step 3: Write implementation**

`packages/relay/src/router.ts`의 `routeMessage()` 끝부분에 exclude 필터링 추가:

```typescript
export function routeMessage(
  message: RelayMessage,
  senderClientId: string,
  senderDeviceType: RelayDeviceType,
  clients: Map<string, Client>
): RouteResult {
  let result: RouteResult;

  if (message.to !== undefined && Array.isArray(message.to)) {
    result = routeByTo(message.to, clients);
  } else if (message.broadcast !== undefined) {
    result = routeByBroadcast(message.broadcast, clients, senderClientId);
  } else {
    console.error(`[ROUTE ERROR] No routing target...`);
    return { targetClientIds: [], success: false };
  }

  // exclude 필드가 있으면 해당 deviceId를 가진 클라이언트를 제거
  if (message.exclude && Array.isArray(message.exclude) && message.exclude.length > 0) {
    const excludeSet = new Set(message.exclude);
    result.targetClientIds = result.targetClientIds.filter(clientId => {
      const client = clients.get(clientId);
      return !client?.deviceId || !excludeSet.has(client.deviceId);
    });
    result.success = result.targetClientIds.length > 0;
  }

  return result;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @estelle/relay vitest run src/router.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/relay/src/router.ts packages/relay/src/router.test.ts
git commit -m "feat(relay): routeMessage에 exclude 필터링 추가"
```

---

### Task 4: Pylon - DirectServer (직접 연결 WS 서버)

**Files:**
- Create: `packages/pylon/src/network/direct-server.ts`
- Test: `packages/pylon/src/network/direct-server.test.ts`

**Step 1: Write the failing tests**

```typescript
// packages/pylon/src/network/direct-server.test.ts
import { describe, it, expect, vi } from 'vitest';
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

describe('DirectServer', () => {
  it('accepts local connection and sends handshake', async () => {
    const port = await getPort();
    const onConnection = vi.fn();

    const server = new DirectServer({
      port,
      pylonIndex: 1,
      deviceId: 65,
      onConnection,
      onMessage: vi.fn(),
      onDisconnect: vi.fn(),
    });

    await server.start();

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const handshake = await new Promise<string>((resolve) => {
      ws.on('message', (data) => resolve(data.toString()));
    });

    const parsed = JSON.parse(handshake);
    expect(parsed.type).toBe('direct_auth');
    expect(parsed.pylonIndex).toBe(1);
    expect(parsed.deviceId).toBe(65);
    expect(onConnection).toHaveBeenCalled();

    ws.close();
    await server.stop();
  });

  it('forwards messages via onMessage callback', async () => {
    const port = await getPort();
    const onMessage = vi.fn();

    const server = new DirectServer({
      port,
      pylonIndex: 1,
      deviceId: 65,
      onConnection: vi.fn(),
      onMessage,
      onDisconnect: vi.fn(),
    });

    await server.start();

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve) => ws.on('open', resolve));
    // Skip handshake
    await new Promise<void>((resolve) => ws.on('message', () => resolve()));

    ws.send(JSON.stringify({ type: 'claude_send', payload: 'hello' }));
    await new Promise((r) => setTimeout(r, 50));

    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'claude_send' }),
      expect.any(Object) // ws
    );

    ws.close();
    await server.stop();
  });

  it('does not send heartbeat to direct clients', async () => {
    const port = await getPort();
    const server = new DirectServer({
      port,
      pylonIndex: 1,
      deviceId: 65,
      onConnection: vi.fn(),
      onMessage: vi.fn(),
      onDisconnect: vi.fn(),
    });

    await server.start();

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const messages: string[] = [];
    ws.on('message', (data) => messages.push(data.toString()));

    await new Promise<void>((resolve) => ws.on('open', resolve));
    // Wait 2 seconds — no ping should arrive
    await new Promise((r) => setTimeout(r, 2000));

    // Only handshake message, no ping
    expect(messages.length).toBe(1);
    expect(JSON.parse(messages[0]).type).toBe('direct_auth');

    ws.close();
    await server.stop();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @estelle/pylon vitest run src/network/direct-server.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// packages/pylon/src/network/direct-server.ts
import { WebSocketServer, WebSocket } from 'ws';
import net from 'net';

export interface DirectServerOptions {
  port: number;
  pylonIndex: number;
  deviceId: number;
  onConnection: (clientDeviceId: number | null, ws: WebSocket) => void;
  onMessage: (data: unknown, ws: WebSocket) => void;
  onDisconnect: (ws: WebSocket) => void;
}

function isPrivateIp(ip: string): boolean {
  // IPv6 loopback, IPv4 mapped IPv6, or standard private ranges
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

        // 핸드셰이크: pylonIndex와 deviceId 전달
        ws.send(JSON.stringify({
          type: 'direct_auth',
          pylonIndex: this.options.pylonIndex,
          deviceId: this.options.deviceId,
        }));

        this.options.onConnection(null, ws);

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

        // heartbeat 없음 — 로컬 네트워크이므로 불필요
      });
    });
  }

  broadcast(data: string): void {
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
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
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @estelle/pylon vitest run src/network/direct-server.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/pylon/src/network/direct-server.ts packages/pylon/src/network/direct-server.test.ts
git commit -m "feat(pylon): DirectServer - 직접 연결용 WS 서버"
```

---

### Task 5: Pylon - RelayClientV2

**Files:**
- Create: `packages/pylon/src/network/relay-client-v2.ts`
- Test: `packages/pylon/src/network/relay-client-v2.test.ts`

**핵심:** 기존 RelayClient를 감싸고, DirectRouter를 내장하여 send() 시 스플릿 라우팅.

**Step 1: Write the failing tests**

```typescript
// packages/pylon/src/network/relay-client-v2.test.ts
import { describe, it, expect, vi } from 'vitest';
import { RelayClientV2 } from './relay-client-v2.js';

describe('RelayClientV2', () => {
  it('sends to relay when no direct connections', () => {
    const relaySend = vi.fn();
    const client = new RelayClientV2({ relaySend });

    client.send({ type: 'test', payload: {}, timestamp: 0, to: [80] });

    expect(relaySend).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'test', to: [80] })
    );
  });

  it('sends to direct when device is directly connected', () => {
    const relaySend = vi.fn();
    const directWs = { send: vi.fn(), readyState: 1, OPEN: 1 };
    const client = new RelayClientV2({ relaySend });

    client.addDirect(80, directWs as any);
    client.send({ type: 'test', payload: {}, timestamp: 0, to: [80] });

    expect(directWs.send).toHaveBeenCalled();
    expect(relaySend).not.toHaveBeenCalled();
  });

  it('splits to direct + relay for mixed targets', () => {
    const relaySend = vi.fn();
    const directWs = { send: vi.fn(), readyState: 1, OPEN: 1 };
    const client = new RelayClientV2({ relaySend });

    client.addDirect(65, directWs as any);
    client.send({ type: 'test', payload: {}, timestamp: 0, to: [65, 80] });

    expect(directWs.send).toHaveBeenCalled();
    expect(relaySend).toHaveBeenCalledWith(
      expect.objectContaining({ to: [80] })
    );
  });

  it('adds exclude for broadcast with direct connections', () => {
    const relaySend = vi.fn();
    const directWs = { send: vi.fn(), readyState: 1, OPEN: 1 };
    const client = new RelayClientV2({ relaySend });

    client.addDirect(65, directWs as any);
    client.send({ type: 'test', payload: {}, timestamp: 0, broadcast: 'all' });

    expect(directWs.send).toHaveBeenCalled();
    expect(relaySend).toHaveBeenCalledWith(
      expect.objectContaining({ broadcast: 'all', exclude: [65] })
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @estelle/pylon vitest run src/network/relay-client-v2.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// packages/pylon/src/network/relay-client-v2.ts
import { DirectRouter } from '@estelle/core';
import type { Message } from '@estelle/core';

interface WsLike {
  send(data: string): void;
  readonly readyState: number;
  readonly OPEN: number;
}

export interface RelayClientV2Options {
  relaySend: (msg: Message) => void;
}

export class RelayClientV2 {
  private directRouter = new DirectRouter();
  private relaySend: (msg: Message) => void;

  constructor(options: RelayClientV2Options) {
    this.relaySend = options.relaySend;
  }

  addDirect(deviceId: number, ws: WsLike): void {
    this.directRouter.addDirect(deviceId, ws);
  }

  removeDirect(deviceId: number): void {
    this.directRouter.removeDirect(deviceId);
  }

  send(msg: Message): void {
    const { directTargets, relayMessage } = this.directRouter.splitTargets(msg);

    // 직접 연결 대상에게 전송
    for (const [, ws] of directTargets) {
      ws.send(JSON.stringify(msg));
    }

    // 나머지는 Relay로
    if (relayMessage) {
      this.relaySend(relayMessage);
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @estelle/pylon vitest run src/network/relay-client-v2.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/pylon/src/network/relay-client-v2.ts packages/pylon/src/network/relay-client-v2.test.ts
git commit -m "feat(pylon): RelayClientV2 - DirectRouter 내장 스플릿 라우팅"
```

---

### Task 6: Pylon - bin.ts에 directPort 설정 + DirectServer 연결

**Files:**
- Modify: `packages/pylon/src/bin.ts`

**Step 1: directPort 설정 읽기 + DirectServer 시작**

`packages/pylon/src/bin.ts`에서 config 로딩 부분 (라인 86-96 근처)에 directPort 추가:

```typescript
const directPort = envConfig?.pylon?.directPort
  ? parseInt(envConfig.pylon.directPort, 10)
  : undefined;
```

RelayClient 생성 이후 (라인 368-372 근처)에 DirectServer 시작:

```typescript
// 기존 relayClient 생성 유지
const relayClient = createRelayClient({ ... });

// directPort가 설정되어 있으면 DirectServer 시작
let directServer: DirectServer | undefined;
let relayClientV2: RelayClientV2 | undefined;

if (directPort) {
  relayClientV2 = new RelayClientV2({
    relaySend: (msg) => relayClient.send(msg),
  });

  directServer = new DirectServer({
    port: directPort,
    pylonIndex,
    deviceId: computedDeviceId,
    onConnection: (clientDeviceId, ws) => {
      // 직접 연결된 클라이언트의 deviceId는 핸드셰이크 후 등록
      // 현재는 단일 연결이므로 간단하게 처리
      console.log(`[Direct] Client connected`);
    },
    onMessage: (data, ws) => {
      // Pylon의 메시지 핸들러로 전달 (기존 relayClient.onMessage 콜백과 동일)
      pylon.handleMessage(data);
    },
    onDisconnect: (ws) => {
      console.log(`[Direct] Client disconnected`);
    },
  });

  await directServer.start();
  console.log(`[Direct] Server listening on :${directPort}`);
}

// Pylon의 send를 V2로 교체 (directPort가 있을 때만)
// pylon.setSendFunction()을 통해 send 교체
```

**주의:** 이 Task는 기존 Pylon 코드와의 통합이므로, 정확한 구현은 실제 bin.ts 구조를 보면서 조정 필요. 핵심은 directPort가 있을 때만 DirectServer를 시작하고, Pylon의 send를 RelayClientV2로 우회시키는 것.

**Step 2: Verify build**

Run: `pnpm --filter @estelle/pylon build`
Expected: no errors

**Step 3: Commit**

```bash
git add packages/pylon/src/bin.ts
git commit -m "feat(pylon): directPort 설정 시 DirectServer 시작"
```

---

### Task 7: Client - RelayServiceV2

**Files:**
- Create: `packages/client/src/services/relayServiceV2.ts`
- Test: `packages/client/src/services/relayServiceV2.test.ts`

**핵심:** 기존 RelayService를 감싸고, DirectRouter를 내장. URL 파라미터에서 direct 주소를 읽어 직접 WS 연결.

**Step 1: Write the failing tests**

```typescript
// packages/client/src/services/relayServiceV2.test.ts
import { describe, it, expect, vi } from 'vitest';
import { RelayServiceV2 } from './relayServiceV2.js';

describe('RelayServiceV2', () => {
  it('sends to relay when no direct connections', () => {
    const relaySend = vi.fn();
    const service = new RelayServiceV2({ relaySend });

    service.send({ type: 'test', payload: {}, timestamp: 0, to: [65] });

    expect(relaySend).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'test', to: [65] })
    );
  });

  it('sends to direct when device is directly connected', () => {
    const relaySend = vi.fn();
    const directWs = { send: vi.fn(), readyState: 1, OPEN: 1 };
    const service = new RelayServiceV2({ relaySend });

    service.addDirect(65, directWs as any);
    service.send({ type: 'test', payload: {}, timestamp: 0, to: [65] });

    expect(directWs.send).toHaveBeenCalled();
    expect(relaySend).not.toHaveBeenCalled();
  });

  it('adds exclude for broadcast', () => {
    const relaySend = vi.fn();
    const directWs = { send: vi.fn(), readyState: 1, OPEN: 1 };
    const service = new RelayServiceV2({ relaySend });

    service.addDirect(65, directWs as any);
    service.send({ type: 'test', payload: {}, timestamp: 0, broadcast: 'pylons' });

    expect(directWs.send).toHaveBeenCalled();
    expect(relaySend).toHaveBeenCalledWith(
      expect.objectContaining({ broadcast: 'pylons', exclude: [65] })
    );
  });

  it('parseDirectUrl extracts URL from query param', () => {
    expect(RelayServiceV2.parseDirectUrl('?direct=ws://192.168.1.100:5000'))
      .toBe('ws://192.168.1.100:5000');
    expect(RelayServiceV2.parseDirectUrl('?foo=bar'))
      .toBeNull();
    expect(RelayServiceV2.parseDirectUrl(''))
      .toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @estelle/client vitest run src/services/relayServiceV2.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// packages/client/src/services/relayServiceV2.ts
import { DirectRouter } from '@estelle/core';
import type { Message } from '@estelle/core';

interface WsLike {
  send(data: string): void;
  readonly readyState: number;
  readonly OPEN: number;
}

export interface RelayServiceV2Options {
  relaySend: (msg: Message) => void;
}

export class RelayServiceV2 {
  private directRouter = new DirectRouter();
  private relaySend: (msg: Message) => void;
  private onMessageCallback: ((data: unknown) => void) | null = null;

  constructor(options: RelayServiceV2Options) {
    this.relaySend = options.relaySend;
  }

  addDirect(deviceId: number, ws: WsLike): void {
    this.directRouter.addDirect(deviceId, ws);
  }

  removeDirect(deviceId: number): void {
    this.directRouter.removeDirect(deviceId);
  }

  onMessage(callback: (data: unknown) => void): void {
    this.onMessageCallback = callback;
  }

  /** 직접 연결에서 수신한 메시지를 처리 */
  handleDirectMessage(data: unknown): void {
    this.onMessageCallback?.(data);
  }

  send(msg: Message): void {
    const { directTargets, relayMessage } = this.directRouter.splitTargets(msg);

    for (const [, ws] of directTargets) {
      ws.send(JSON.stringify(msg));
    }

    if (relayMessage) {
      this.relaySend(relayMessage);
    }
  }

  /** URL search string에서 ?direct=ws://... 파라미터 추출 */
  static parseDirectUrl(search: string): string | null {
    const params = new URLSearchParams(search);
    return params.get('direct');
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @estelle/client vitest run src/services/relayServiceV2.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/client/src/services/relayServiceV2.ts packages/client/src/services/relayServiceV2.test.ts
git commit -m "feat(client): RelayServiceV2 - DirectRouter 내장 스플릿 라우팅"
```

---

### Task 8: Client - URL 파라미터 파싱 + 직접 연결 통합

**Files:**
- Modify: `packages/client/src/App.tsx` (또는 RelayService 초기화 지점)
- Modify: `packages/client/src/services/relaySender.ts`

**핵심:** 앱 시작 시 `?direct=ws://...` 파라미터가 있으면 해당 주소로 WS 접속 시도. 핸드셰이크에서 deviceId를 받아 RelayServiceV2에 등록.

**Step 1: URL 파라미터 처리 + 직접 WS 연결**

기존 RelayService/relaySender 초기화 코드 근처에 추가:

```typescript
// App.tsx 또는 초기화 코드에서
const directUrl = RelayServiceV2.parseDirectUrl(window.location.search);

if (directUrl) {
  const directWs = new WebSocket(directUrl);

  directWs.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'direct_auth') {
      // 핸드셰이크: Pylon의 deviceId를 받아서 라우팅 테이블에 등록
      console.log(`[Direct] Connected to Pylon ${data.pylonIndex} (deviceId: ${data.deviceId})`);
      relayServiceV2.addDirect(data.deviceId, directWs);
      return;
    }

    // 일반 메시지: 기존 메시지 핸들러로 전달
    relayServiceV2.handleDirectMessage(data);
  };

  directWs.onclose = () => {
    // 직접 연결 끊김 → 라우팅 테이블에서 제거 → R2 fallback
    console.log('[Direct] Disconnected, falling back to Relay');
    // deviceId를 기억해뒀다가 removeDirect 호출
  };

  directWs.onerror = () => {
    console.warn('[Direct] Connection failed, using Relay only');
  };
}
```

**Step 2: relaySender의 sendMessage를 RelayServiceV2 경유로 변경**

기존 `sendMessage()` 함수가 globalWs에 직접 보내는 것을 RelayServiceV2.send()를 통하도록 변경. 이렇게 하면 직접 연결 대상은 자동으로 직접 WS로, 나머지는 Relay로 라우팅.

**Step 3: Verify build**

Run: `pnpm --filter @estelle/client build`
Expected: no errors

**Step 4: Commit**

```bash
git add packages/client/src/App.tsx packages/client/src/services/relaySender.ts
git commit -m "feat(client): URL ?direct 파라미터로 Pylon 직접 연결"
```

---

### Task 9: 전체 빌드 + 수동 테스트

**Step 1: 전체 타입체크**

Run: `pnpm typecheck`
Expected: no errors

**Step 2: 전체 테스트**

Run: `pnpm test`
Expected: all tests pass

**Step 3: 수동 테스트 시나리오**

1. P1에 `directPort: 5000` 설정 후 시작 → `[Direct] Server listening on :5000` 확인
2. P2에는 directPort 미설정 → DirectServer 안 뜸 확인
3. C1을 `?direct=ws://localhost:5000`으로 접속 → 핸드셰이크 로그 확인
4. C1에서 P1에게 메시지 전송 → 직접 WS로 전달 확인 (Relay 로그에 안 찍힘)
5. C1에서 broadcast 전송 → P1은 직접, P2는 Relay 경유 확인
6. C1 직접 연결 끊기 → Relay fallback 확인

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: Direct Connection 기능 완성 - C1↔P1 로컬 직접 WebSocket 연결"
```
