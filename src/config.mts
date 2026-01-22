import type { Config, MessageQueueConfig } from './types/index.js';

export const defaultConfig: Config = {
  // these are 
  "log": true,
  "error": false,
  "kill": true,
  "exception": true,
  "restart": false,
  "delete": false,
  "stop": true,
  "restart overlimit": true,
  "exit": false,
  "start": false,
  "online": false,

  // custom options
  "process_name": null,
  "discord_url": null,
  "buffer": true,
  "buffer_seconds": 1,
  "queue_max": 100,
  "rate_limit_messages": 30,
  "rate_limit_window_seconds": 60,
  "format": true
}

export function getConfigValue(processName: string, item: keyof MessageQueueConfig, config: Config) {
  // @ts-expect-error -- dynamic key access
  return config[`${item}-${processName}`] ?? config[item];
}

function clamp(num: number, min: number, max: number): number {
  return Math.min(Math.max(num, min), max);
}

export function loadConfig(): Config {
  // Read config directly from environment (PM2 sets this for modules)
  let moduleConfig: Partial<Config> = {};
  try {
    if (process.env['pm2-discord']) {
      moduleConfig = JSON.parse(process.env['pm2-discord']);
    }
  } catch (e) {
    console.error('pm2-discord: Error parsing module config from env:', e);
  }
  const finalConfig = { ...defaultConfig, ...moduleConfig } as Config;

  // buffer seconds can be between 1 and 5, inclusive
  finalConfig.buffer_seconds = clamp(finalConfig.buffer_seconds, 1, 5);

  // queue max can be between 10 and 100, inclusive
  finalConfig.queue_max = clamp(finalConfig.queue_max, 10, 100);

  return finalConfig;
}