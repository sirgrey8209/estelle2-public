export interface SlackConfig {
  botToken: string;
  appToken: string;
  channelId: string;
}

export interface TunnelConfig {
  connectPort: number;   // connect 측이 접속할 포트
  listenPort: number;    // listen 측이 열 포트
}

export interface Config {
  mode: 'listen' | 'connect';
  slack: SlackConfig;
  tunnel?: TunnelConfig;
}

export function loadConfig(raw: Record<string, unknown>): Config {
  if (!raw.mode || (raw.mode !== 'listen' && raw.mode !== 'connect')) {
    throw new Error('config: mode must be "listen" or "connect"');
  }

  const slack = raw.slack as Record<string, unknown> | undefined;
  if (!slack || !slack.botToken || !slack.appToken || !slack.channelId) {
    throw new Error('config: slack.botToken, slack.appToken, slack.channelId required');
  }

  const config: Config = {
    mode: raw.mode as 'listen' | 'connect',
    slack: {
      botToken: slack.botToken as string,
      appToken: slack.appToken as string,
      channelId: slack.channelId as string,
    },
  };

  const tunnel = raw.tunnel as Record<string, unknown> | undefined;
  if (tunnel && typeof tunnel.connectPort === 'number' && typeof tunnel.listenPort === 'number') {
    config.tunnel = {
      connectPort: tunnel.connectPort,
      listenPort: tunnel.listenPort,
    };
  }

  return config;
}
