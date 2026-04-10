import { App } from '@slack/bolt';
import type { SlackConfig } from './config.js';

export interface DataEvent {
  data: string;
  seq: number;
  chunkIndex?: number;   // undefined = not chunked
  totalChunks?: number;
}
export type DataHandler = (event: DataEvent) => void;
export type ControlHandler = (cmd: string) => void;
export type CommandHandler = (command: string, args: string) => void;

export class SlackTransport {
  private app: App;
  private channelId: string;
  private myBotId: string | null = null;
  private onData: DataHandler | null = null;
  private onControl: ControlHandler | null = null;
  private onCommand: CommandHandler | null = null;

  constructor(config: SlackConfig) {
    this.channelId = config.channelId;
    this.app = new App({
      token: config.botToken,
      appToken: config.appToken,
      socketMode: true,
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.app.event('message', async ({ event }) => {
      const msg = event as unknown as Record<string, unknown>;

      // Ignore own messages
      if (msg.bot_id && msg.bot_id === this.myBotId) return;

      // Plain text commands from humans (no bot_id, no subtype)
      if (!msg.bot_id && msg.subtype === undefined && typeof msg.text === 'string') {
        const text = (msg.text as string).trim();
        if (text && this.onCommand) {
          const spaceIdx = text.indexOf(' ');
          if (spaceIdx === -1) {
            this.onCommand(text, '');
          } else {
            this.onCommand(text.slice(0, spaceIdx), text.slice(spaceIdx + 1).trim());
          }
        }
        return;
      }

      // Metadata messages from the other bot
      const metadata = msg.metadata as
        | { event_type: string; event_payload: Record<string, string> }
        | undefined;
      if (!metadata) return;

      if (metadata.event_type === 'wst' && this.onData) {
        const ep = metadata.event_payload;
        this.onData({
          data: ep.d,
          seq: Number(ep.s),
          chunkIndex: ep.c !== undefined ? Number(ep.c) : undefined,
          totalChunks: ep.t !== undefined ? Number(ep.t) : undefined,
        });
      } else if (metadata.event_type === 'wst_ctrl' && this.onControl) {
        this.onControl(metadata.event_payload.cmd);
      }
    });
  }

  setDataHandler(handler: DataHandler): void {
    this.onData = handler;
  }

  setControlHandler(handler: ControlHandler): void {
    this.onControl = handler;
  }

  setCommandHandler(handler: CommandHandler): void {
    this.onCommand = handler;
  }

  async start(): Promise<void> {
    await this.app.start();

    // Fetch own bot_id to filter self-messages
    try {
      const auth = await this.app.client.auth.test();
      this.myBotId = (auth as unknown as Record<string, unknown>).bot_id as string ?? null;
    } catch {
      // If auth.test fails, fall back to no filtering
      // (will still work with 2 separate apps since bot_ids differ)
    }
  }

  async stop(): Promise<void> {
    await this.app.stop();
  }

  async sendData(encoded: string, seq: number): Promise<void> {
    await this.app.client.chat.postMessage({
      channel: this.channelId,
      text: ' ',
      metadata: {
        event_type: 'wst',
        event_payload: { d: encoded, s: String(seq) },
      },
    });
  }

  async sendChunkedData(chunks: Array<{ d: string; c: string; t: string }>, seq: number): Promise<void> {
    for (const ck of chunks) {
      await this.app.client.chat.postMessage({
        channel: this.channelId,
        text: ' ',
        metadata: {
          event_type: 'wst',
          event_payload: { d: ck.d, s: String(seq), c: ck.c, t: ck.t },
        },
      });
    }
  }

  async sendControl(cmd: string): Promise<void> {
    await this.app.client.chat.postMessage({
      channel: this.channelId,
      text: ' ',
      metadata: {
        event_type: 'wst_ctrl',
        event_payload: { cmd },
      },
    });
  }

  async reply(text: string): Promise<void> {
    await this.app.client.chat.postMessage({
      channel: this.channelId,
      text,
    });
  }

  /** Delete bot messages older than maxAgeMs. Returns number of deleted messages. */
  async clearOldMessages(maxAgeMs: number = 5 * 60 * 1000): Promise<number> {
    let deleted = 0;
    const cutoff = (Date.now() - maxAgeMs) / 1000; // Slack uses seconds

    try {
      const result = await this.app.client.conversations.history({
        channel: this.channelId,
        limit: 100,
      });

      const messages = (result.messages ?? []) as Array<Record<string, unknown>>;
      for (const msg of messages) {
        const ts = Number(msg.ts);
        if (ts >= cutoff) continue; // too recent, skip

        // Only delete bot messages (not human commands)
        if (!msg.bot_id) continue;

        try {
          await this.app.client.chat.delete({
            channel: this.channelId,
            ts: msg.ts as string,
          });
          deleted++;
        } catch {
          // Permission error or already deleted — skip
        }
      }
    } catch {
      // conversations.history failed — skip silently
    }

    return deleted;
  }

  getClient() {
    return this.app.client;
  }
}
