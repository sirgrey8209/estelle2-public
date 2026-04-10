/**
 * @file direct-router.ts
 * @description Direct Connection 스플릿 라우팅 로직
 *
 * 메시지 전송 시 Direct WebSocket 연결이 있는 디바이스와
 * Relay를 경유해야 하는 디바이스를 분리하여 라우팅합니다.
 */

import type { Message } from '../types/message.js';

/** WebSocket-like interface (ws 라이브러리 의존 없이) */
export interface WsLike {
  send(data: string): void;
  readonly readyState: number;
  readonly OPEN: number;
}

export interface SplitResult {
  directTargets: Map<number, WsLike>;
  relayMessage: Message | null;
}

export class DirectRouter {
  private connections = new Map<number, WsLike>();

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

    if ((!msg.to && !(msg as any).broadcast) || this.connections.size === 0) {
      return { directTargets, relayMessage: msg };
    }

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
      const relayMessage = relayTo.length > 0 ? { ...msg, to: relayTo } : null;
      return { directTargets, relayMessage };
    }

    if ((msg as any).broadcast) {
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
