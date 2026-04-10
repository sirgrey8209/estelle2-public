// packages/client/src/services/relayServiceV2.ts
import { DirectRouter, type WsLike } from '@estelle/core';
import type { Message } from '@estelle/core';

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

  hasDirect(deviceId: number): boolean {
    return this.directRouter.hasDirect(deviceId);
  }

  onMessage(callback: (data: unknown) => void): void {
    this.onMessageCallback = callback;
  }

  /** Handle a message received from a direct connection */
  handleDirectMessage(data: unknown): void {
    this.onMessageCallback?.(data);
  }

  send(msg: Message): void {
    const { directTargets, relayMessage } = this.directRouter.splitTargets(msg);

    const msgStr = JSON.stringify(msg);
    for (const [, ws] of directTargets) {
      ws.send(msgStr);
    }

    if (relayMessage) {
      this.relaySend(relayMessage);
    }
  }

  /** Parse ?direct=ws://... from URL search string */
  static parseDirectUrl(search: string): string | null {
    const params = new URLSearchParams(search);
    return params.get('direct');
  }
}
