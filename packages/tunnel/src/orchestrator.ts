// src/orchestrator.ts
import type { Config } from './config.js';
import { SlackTransport } from './slack-transport.js';
import { Throttle } from './throttle.js';
import { encode, decode, chunk, reassemble, type Chunk } from './codec.js';
import { ListenTunnel, ConnectTunnel } from './tunnel.js';

/** Slack auto-links URLs with angle brackets: <ws://host:port> → ws://host:port */
function stripSlackUrl(text: string): string {
  return text.replace(/^<(.+?)>$/, '$1');
}

const DEFAULT_THROTTLE_MS = 1000;
const DEFAULT_MAX_METADATA_SIZE = 4000;
const METADATA_ENVELOPE_OVERHEAD = 100;

export class Orchestrator {
  private slackTransport: SlackTransport;
  private throttle: Throttle;
  private listenTunnel: ListenTunnel | null = null;
  private connectTunnel: ConnectTunnel | null = null;
  private connectTarget: string | null = null;
  private lastTunnelArgs: { url: string; port: number } | null = null;
  private seq = 0;
  private maxMetadataSize = DEFAULT_MAX_METADATA_SIZE;
  private pendingChunks = new Map<number, Chunk[]>();

  constructor(private config: Config) {
    this.slackTransport = new SlackTransport(config.slack);

    this.throttle = new Throttle(DEFAULT_THROTTLE_MS, (messages) => {
      this.flushToSlack(messages);
    });

    this.slackTransport.setDataHandler((event) => {
      this.handleSlackData(event);
    });

    this.slackTransport.setControlHandler((cmd) => {
      this.handleSlackControl(cmd);
    });

    this.slackTransport.setCommandHandler((cmd, args) => {
      this.handleSlackCommand(cmd, args);
    });
  }

  async start(): Promise<void> {
    await this.slackTransport.start();

    // config에 tunnel 설정이 있으면 자동 시작
    if (this.config.tunnel) {
      const { connectPort, listenPort } = this.config.tunnel;
      this.lastTunnelArgs = { url: `ws://localhost:${connectPort}`, port: listenPort };

      if (this.config.mode === 'listen') {
        await this.startListen(listenPort);
      } else {
        this.connectTarget = `ws://localhost:${connectPort}`;
        await this.slackTransport.reply(`connect target set: ws://localhost:${connectPort} (waiting for tunnel_open)`);
      }
    } else {
      await this.slackTransport.reply(`${this.config.mode} mode ready, waiting for command`);
    }
  }

  private async startListen(port: number): Promise<void> {
    // 기존 listen이 있으면 먼저 정리
    if (this.listenTunnel) {
      await this.listenTunnel.stop();
      this.listenTunnel = null;
    }

    this.listenTunnel = new ListenTunnel(port);

    this.listenTunnel.onConnection = () => {
      this.slackTransport.sendControl('tunnel_open');
      this.slackTransport.reply(`tunnel opened (ws client connected on :${port})`);
    };

    this.listenTunnel.onMessage = (data) => {
      this.throttle.push(data);
    };

    this.listenTunnel.onDisconnect = () => {
      this.slackTransport.sendControl('tunnel_close');
      this.slackTransport.reply('tunnel closed (ws client disconnected)');
      this.throttle.destroy();
      this.seq = 0;
    };

    await this.listenTunnel.start();
    await this.slackTransport.reply(`listening on :${port}`);
  }

  private async startConnect(target: string): Promise<void> {
    // 기존 connect가 있으면 먼저 정리
    if (this.connectTunnel) {
      await this.connectTunnel.disconnect();
      this.connectTunnel = null;
    }

    this.connectTunnel = new ConnectTunnel(target);

    this.connectTunnel.onMessage = (data) => {
      this.throttle.push(data);
    };

    this.connectTunnel.onDisconnect = () => {
      this.slackTransport.reply('target connection lost');
    };

    await this.connectTunnel.connect();
    await this.slackTransport.reply(`connected to ${target}`);
  }

  /** WS 터널만 중지. Slack 연결은 유지. */
  private async stopTunnel(): Promise<void> {
    this.throttle.destroy();
    this.seq = 0;
    if (this.listenTunnel) {
      await this.listenTunnel.stop();
      this.listenTunnel = null;
    }
    if (this.connectTunnel) {
      await this.connectTunnel.disconnect();
      this.connectTunnel = null;
    }
  }

  /** 전체 종료. SIGINT/SIGTERM에서 호출. */
  async shutdown(): Promise<void> {
    await this.stopTunnel();
    await this.slackTransport.stop();
  }

  private async flushToSlack(messages: string[]): Promise<void> {
    try {
      const encoded = encode(messages);
      const currentSeq = this.seq++;

      const dataLimit = this.maxMetadataSize - METADATA_ENVELOPE_OVERHEAD;
      if (encoded.length <= dataLimit) {
        await this.slackTransport.sendData(encoded, currentSeq);
      } else {
        const chunks = chunk(encoded, dataLimit);
        await this.slackTransport.sendChunkedData(chunks, currentSeq);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[wst] flush failed (${messages.length} msgs): ${msg}`);
    }
  }

  private handleSlackData(event: import('./slack-transport.js').DataEvent): void {
    let encoded: string;

    if (event.totalChunks !== undefined && event.totalChunks > 1) {
      // Chunked message — collect pieces
      const key = event.seq;
      if (!this.pendingChunks.has(key)) {
        this.pendingChunks.set(key, []);
      }
      const chunks = this.pendingChunks.get(key)!;
      chunks.push({ d: event.data, c: String(event.chunkIndex ?? 0), t: String(event.totalChunks) });

      if (chunks.length < event.totalChunks) {
        return; // still waiting for more chunks
      }

      // All chunks arrived — reassemble
      encoded = reassemble(chunks);
      this.pendingChunks.delete(key);
    } else {
      // Single message, no chunking
      encoded = event.data;
    }

    const messages = decode(encoded);
    if (!messages) return;
    for (const msg of messages) {
      if (this.config.mode === 'listen') {
        this.listenTunnel?.sendToClient(msg);
      } else {
        this.connectTunnel?.sendToTarget(msg);
      }
    }
  }

  private async handleSlackControl(cmd: string): Promise<void> {
    if (cmd === 'tunnel_open' && this.config.mode === 'connect' && this.connectTarget) {
      await this.startConnect(this.connectTarget);
    } else if (cmd === 'tunnel_close' && this.config.mode === 'connect') {
      await this.connectTunnel?.disconnect();
      this.connectTunnel = null;
      this.throttle.destroy();
      this.seq = 0;
    }
  }

  private async handleSlackCommand(cmd: string, args: string): Promise<void> {
    switch (cmd) {
      case 'tunnel': {
        const parts = args.split(/\s+/);
        if (parts.length < 2) {
          await this.slackTransport.reply('usage: tunnel <ws-url> <port>');
          break;
        }
        const [rawUrl, portStr] = parts;
        const url = stripSlackUrl(rawUrl);
        const port = parseInt(portStr, 10);
        if (isNaN(port)) {
          await this.slackTransport.reply('invalid port');
          break;
        }

        this.lastTunnelArgs = { url, port };

        if (this.config.mode === 'listen') {
          await this.startListen(port);
        } else {
          this.connectTarget = url;
          await this.slackTransport.reply(`connect target set: ${url} (waiting for tunnel_open)`);
        }
        break;
      }

      case 'start': {
        if (!this.lastTunnelArgs) {
          await this.slackTransport.reply('no previous tunnel config. use: tunnel <ws-url> <port>');
          break;
        }
        const { url, port } = this.lastTunnelArgs;
        if (this.config.mode === 'listen') {
          await this.startListen(port);
        } else {
          this.connectTarget = url;
          await this.slackTransport.reply(`connect target set: ${url} (waiting for tunnel_open)`);
        }
        break;
      }

      case 'stop':
        await this.stopTunnel();
        await this.slackTransport.reply('tunnel stopped');
        break;

      case 'status': {
        const wsConnected = this.config.mode === 'listen'
          ? this.listenTunnel?.isConnected ?? false
          : this.connectTunnel?.isConnected ?? false;
        await this.slackTransport.reply(
          `mode: ${this.config.mode} | ws: ${wsConnected ? 'connected' : 'disconnected'} | seq: ${this.seq} | rate: ${this.throttle.getInterval()}ms | maxsize: ${this.maxMetadataSize}`
        );
        break;
      }

      case 'set': {
        const parts = args.split(/\s+/);
        if (parts.length < 2) {
          await this.slackTransport.reply('usage: set <rate|maxsize> <value>');
          break;
        }
        const [key, value] = parts;
        const num = parseInt(value, 10);
        if (isNaN(num) || num <= 0) {
          await this.slackTransport.reply('invalid value');
          break;
        }

        if (key === 'rate') {
          this.throttle.setInterval(num);
          await this.slackTransport.reply(`throttle rate set: ${num}ms`);
        } else if (key === 'maxsize') {
          this.maxMetadataSize = num;
          await this.slackTransport.reply(`max metadata size set: ${num}`);
        } else {
          await this.slackTransport.reply(`unknown setting: ${key}. available: rate, maxsize`);
        }
        break;
      }

      case 'ping':
        await this.slackTransport.reply('pong');
        break;

      case 'clear': {
        const deleted = await this.slackTransport.clearOldMessages(0);
        await this.slackTransport.reply(`cleared ${deleted} messages`);
        break;
      }

      case 'help':
        await this.slackTransport.reply(
          [
            '`tunnel <ws-url> <port>` — 터널 설정',
            '`start` — 마지막 설정으로 재시작',
            '`stop` — WS 터널 중지',
            '`status` — 현재 상태',
            '`set rate <ms>` — 쓰로틀 간격',
            '`set maxsize <bytes>` — 메타데이터 크기',
            '`ping` — 생존 확인',
            '`clear` — 봇 메시지 삭제',
            '`help` — 이 목록',
          ].join('\n')
        );
        break;

      default:
        break;
    }
  }
}
