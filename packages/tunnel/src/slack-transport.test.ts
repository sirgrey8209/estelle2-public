import { describe, it, expect, vi } from 'vitest';
import { SlackTransport } from './slack-transport.js';

// Mock @slack/bolt
vi.mock('@slack/bolt', () => {
  const MockApp = class {
    client = {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ok: true }),
      },
    };
    start = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn().mockResolvedValue(undefined);
    event = vi.fn();
  };
  return { App: MockApp };
});

describe('SlackTransport', () => {
  it('constructs with config', () => {
    const transport = new SlackTransport({
      botToken: 'xoxb-test',
      appToken: 'xapp-test',
      channelId: 'C123',
    });
    expect(transport).toBeDefined();
  });

  it('sends data message with correct metadata format', async () => {
    const transport = new SlackTransport({
      botToken: 'xoxb-test',
      appToken: 'xapp-test',
      channelId: 'C123',
    });

    await transport.start();
    await transport.sendData('base64data', 0);

    const postMessage = transport.getClient().chat.postMessage;
    expect(postMessage).toHaveBeenCalledWith({
      channel: 'C123',
      text: ' ',
      metadata: {
        event_type: 'wst',
        event_payload: { d: 'base64data', s: '0' },
      },
    });
  });

  it('sends control message with correct metadata format', async () => {
    const transport = new SlackTransport({
      botToken: 'xoxb-test',
      appToken: 'xapp-test',
      channelId: 'C123',
    });

    await transport.start();
    await transport.sendControl('tunnel_open');

    const postMessage = transport.getClient().chat.postMessage;
    expect(postMessage).toHaveBeenCalledWith({
      channel: 'C123',
      text: ' ',
      metadata: {
        event_type: 'wst_ctrl',
        event_payload: { cmd: 'tunnel_open' },
      },
    });
  });
});
