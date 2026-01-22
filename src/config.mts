import { Config, MessageQueueConfig } from './types/index.js';

export const defaultConfig: Config = {
  "discord_url": null,
  "process_name": null,
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
  "buffer": true,
  "buffer_seconds": 1,
  "queue_max": 100,
  "rate_limit_messages": 30,
  "rate_limit_window_seconds": 60
}

export function getConfig(processName: string, item: keyof MessageQueueConfig, config: Config) {
  // @ts-expect-error -- dynamic key access
  return config[`${item}-${processName}`] ?? config[item];
}