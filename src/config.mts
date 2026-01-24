import { debug } from './debug.mjs';
import type { Config } from './types/index.js';

// Configuration limits - buffer and queue bounds
const MIN_BUFFER_SECONDS = 1;
const MAX_BUFFER_SECONDS = 5;
const MIN_QUEUE_MAX = 10;
const MAX_QUEUE_MAX = 100;

export const defaultConfig: Config = {
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
  "process_name": null,
  "discord_url": null,
  "buffer": true,
  "buffer_seconds": 1,
  "queue_max": 100,
  "rate_limit_messages": 30,
  "rate_limit_window_seconds": 60,
  "format": true
}

function clamp(num: number, min: number, max: number): number {
  return Math.min(Math.max(num, min), max);
}

/**
 * Convert string values to correct types
 * PM2 passes config as stringified JSON, so values like "true", "1" need conversion
 */
export function convertConfigValue(key: string, value: unknown): unknown {
  // Boolean keys - these should always be booleans
  const booleanKeys = new Set<string>([
    'log', 'error', 'kill', 'exception', 'restart', 'delete', 'stop',
    'exit', 'start', 'online', 'buffer', 'format'
  ]);

  // Numeric keys - these should always be numbers
  const numericKeys = new Set<string>([
    'buffer_seconds', 'queue_max', 'rate_limit_messages', 'rate_limit_window_seconds'
  ]);

  if (booleanKeys.has(key)) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const lower = value.toLowerCase().trim();
      return lower === 'true' || lower === '1';
    }
    return Boolean(value);
  }

  if (numericKeys.has(key)) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const num = Number(value.trim());
      return isNaN(num) ? undefined : num;
    }
    return undefined;
  }

  // String keys (like 'discord_url', 'process_name') - keep as-is
  if (typeof value === 'string') return value;
  return value;
}

let cachedConfig: Config | null = null;

export function loadConfig(): Config {
  if (cachedConfig) {
    return cachedConfig;
  }

  // Read config directly from environment (PM2 sets this for modules)
  const rawConfig: Record<string, unknown> = {};
  debug(`process.env['pm2-discord'] = ${process.env['pm2-discord']}`)
  try {
    if (process.env['pm2-discord']) {
      const parsed = JSON.parse(process.env['pm2-discord']);
      if (typeof parsed === 'object' && parsed !== null) {
        Object.assign(rawConfig, parsed);
      }
    }
  } catch (e) {
    console.error('pm2-discord: Error parsing module config from env:', e);
  }

  // Convert values to correct types based on key
  const moduleConfig: Partial<Config> = {};
  for (const key in rawConfig) {
    const convertedValue = convertConfigValue(key, rawConfig[key]);
    if (convertedValue !== undefined) {
      // TypeScript: we know these are valid config keys after conversion
      (moduleConfig as Record<string, unknown>)[key] = convertedValue;
    }
  }

  debug('moduleConfig from env with corrected types:', moduleConfig)

  const finalConfig = { ...defaultConfig, ...moduleConfig } as Config;

  // buffer seconds can be between MIN_BUFFER_SECONDS and MAX_BUFFER_SECONDS, inclusive
  finalConfig.buffer_seconds = clamp(finalConfig.buffer_seconds, MIN_BUFFER_SECONDS, MAX_BUFFER_SECONDS);

  // queue max can be between MIN_QUEUE_MAX and MAX_QUEUE_MAX, inclusive
  finalConfig.queue_max = clamp(finalConfig.queue_max, MIN_QUEUE_MAX, MAX_QUEUE_MAX);

  debug('finalConfig after merge and clamp:', finalConfig)
  cachedConfig = finalConfig;
  return finalConfig;
}