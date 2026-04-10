// packages/updater/src/config.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

vi.mock('fs');

describe('config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should load config from file', async () => {
    const mockConfig = {
      masterUrl: 'ws://YOUR_SERVER_IP:9900',
      whitelist: ['YOUR_SERVER_IP', '121.0.0.1'],
    };
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

    const { loadConfig } = await import('./config.js');
    const config = loadConfig('/path/to/config.json');

    expect(config.masterUrl).toBe('ws://YOUR_SERVER_IP:9900');
    expect(config.whitelist).toContain('YOUR_SERVER_IP');
  });

  it('should derive whitelist from machines when whitelist is absent', async () => {
    vi.resetModules();
    const mockConfig = {
      masterUrl: 'ws://YOUR_SERVER_IP:9900',
      machines: {
        'YOUR_SERVER_IP': { environmentFile: 'environments.cloud.json' },
        '192.168.1.10': { environmentFile: 'environments.office.json' },
      },
    };
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

    const { loadConfig } = await import('./config.js');
    const config = loadConfig('/path/to/config.json');

    expect(config.whitelist).toEqual(['YOUR_SERVER_IP', '192.168.1.10']);
    expect(config.machines).toBeDefined();
  });

  it('should not override whitelist when both whitelist and machines are present', async () => {
    vi.resetModules();
    const mockConfig = {
      masterUrl: 'ws://YOUR_SERVER_IP:9900',
      whitelist: ['YOUR_SERVER_IP'],
      machines: {
        'YOUR_SERVER_IP': { environmentFile: 'environments.cloud.json' },
        '192.168.1.10': { environmentFile: 'environments.office.json' },
      },
    };
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

    const { loadConfig } = await import('./config.js');
    const config = loadConfig('/path/to/config.json');

    expect(config.whitelist).toEqual(['YOUR_SERVER_IP']);
  });

  it('should parse masterUrl to extract IP', async () => {
    vi.resetModules();
    const { parseMasterIp } = await import('./config.js');

    expect(parseMasterIp('ws://YOUR_SERVER_IP:9900')).toBe('YOUR_SERVER_IP');
    expect(parseMasterIp('ws://192.168.1.1:8080')).toBe('192.168.1.1');
  });
});
