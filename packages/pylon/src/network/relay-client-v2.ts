// packages/pylon/src/network/relay-client-v2.ts
import { DirectRouter, type WsLike } from '@estelle/core';
import type { Message } from '@estelle/core';

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

  hasDirect(deviceId: number): boolean {
    return this.directRouter.hasDirect(deviceId);
  }

  send(msg: Message): void {
    const { directTargets, relayMessage } = this.directRouter.splitTargets(msg);

    // Send to direct connections
    const msgStr = JSON.stringify(msg);
    for (const [, ws] of directTargets) {
      ws.send(msgStr);
    }

    // Send remainder to relay
    if (relayMessage) {
      this.relaySend(relayMessage);
    }
  }
}
