import { describe, it, expect } from 'vitest';
import { loadConfig, type Config } from './config.js';

describe('loadConfig', () => {
  it('loads valid listen config', () => {
    const raw = {
      mode: 'listen',
      slack: {
        botToken: 'xoxb-test',
        appToken: 'xapp-test',
        channelId: 'C123',
      },
    };
    const config = loadConfig(raw);
    expect(config.mode).toBe('listen');
    expect(config.slack.channelId).toBe('C123');
  });

  it('loads valid connect config', () => {
    const raw = {
      mode: 'connect',
      slack: {
        botToken: 'xoxb-test',
        appToken: 'xapp-test',
        channelId: 'C123',
      },
    };
    const config = loadConfig(raw);
    expect(config.mode).toBe('connect');
  });

  it('throws on missing mode', () => {
    expect(() => loadConfig({ slack: {} })).toThrow();
  });

  it('throws on missing slack config', () => {
    expect(() => loadConfig({ mode: 'listen' })).toThrow();
  });

  it('throws on invalid mode', () => {
    const raw = {
      mode: 'invalid',
      slack: { botToken: 'x', appToken: 'x', channelId: 'C1' },
    };
    expect(() => loadConfig(raw)).toThrow();
  });

  it('loads tunnel config when present', () => {
    const raw = {
      mode: 'listen',
      slack: { botToken: 'x', appToken: 'x', channelId: 'C1' },
      tunnel: { connectPort: 8080, listenPort: 4000 },
    };
    const config = loadConfig(raw);
    expect(config.tunnel).toEqual({ connectPort: 8080, listenPort: 4000 });
  });

  it('tunnel is undefined when not provided', () => {
    const raw = {
      mode: 'listen',
      slack: { botToken: 'x', appToken: 'x', channelId: 'C1' },
    };
    const config = loadConfig(raw);
    expect(config.tunnel).toBeUndefined();
  });
});
