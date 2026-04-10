// src/index.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from './config.js';
import { Orchestrator } from './orchestrator.js';

async function main(): Promise<void> {
  const configPath = process.env['CONFIG_PATH'] || './config.json';
  const absolutePath = resolve(configPath);

  let raw: Record<string, unknown>;
  try {
    const content = readFileSync(absolutePath, 'utf-8');
    raw = JSON.parse(content);
  } catch (err) {
    console.error(`Failed to read config: ${absolutePath}`);
    process.exit(1);
  }

  const config = loadConfig(raw);
  console.log(`slack-ws-tunnel starting in ${config.mode} mode`);

  const orchestrator = new Orchestrator(config);

  process.on('SIGINT', async () => {
    console.log('Shutting down...');
    await orchestrator.shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await orchestrator.shutdown();
    process.exit(0);
  });

  await orchestrator.start();
  console.log('slack-ws-tunnel running');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
