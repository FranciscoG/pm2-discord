import type { Headers } from 'node-fetch';
import type { DiscordMessage, SendToDiscordResult, DiscordRateLimitInfo } from './types/index.js';
import fetch from 'node-fetch';
import { debug } from './debug.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

// Get version from package.json
const __dirname = join(fileURLToPath(import.meta.url), '..');
let VERSION = 'unknown version'; // fallback
try {
  const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
  VERSION = packageJson.version || VERSION;
  debug(`pm2-discord version: ${VERSION}`);
} catch (e) {
  // If we can't read package.json, use fallback version
  console.error('pm2-discord: Could not read version from package.json:', e);
}

/**
 * Parse rate limit headers from Discord API response
 */
function parseRateLimitHeaders(headers: Headers): DiscordRateLimitInfo {
  const limit = headers.get('x-ratelimit-limit');
  const remaining = headers.get('x-ratelimit-remaining');
  const reset = headers.get('x-ratelimit-reset');
  const resetAfter = headers.get('x-ratelimit-reset-after');
  return {
    limit: limit ? parseInt(limit, 10) : undefined,
    remaining: remaining ? parseInt(remaining, 10) : undefined,
    reset: reset ? parseInt(reset, 10) : undefined,
    resetAfter: resetAfter ? parseFloat(resetAfter) : undefined,
    bucket: headers.get('x-ratelimit-bucket') || undefined
  };
}

/**
 * Generates username for Discord webhook from process names.
 * When multiple messages are batched together, combines unique process names
 * into a comma-separated list. Falls back to default bot name if no valid names.
 * 
 * @param messages - Array of Discord messages to extract names from
 * @returns Comma-separated process names or 'PM2 Discord Bot' if none found
 * @example
 * // Single process:
 * getUserName([{ name: 'api', ... }]) // => "api"
 * 
 * // Multiple processes batched:
 * getUserName([{ name: 'api', ... }, { name: 'worker', ... }]) // => "api, worker"
 * 
 * // Duplicate names filtered:
 * getUserName([{ name: 'api', ... }, { name: 'api', ... }]) // => "api"
 * 
 * // Empty names handled:
 * getUserName([{ name: '', ... }]) // => "PM2 Discord Bot"
 */
export function getUserName(messages: DiscordMessage[]): string {
  const names = new Set(messages.map(msg => msg.name.trim()).filter(name => name.length > 0));
  return Array.from(names).join(', ') || 'PM2 Discord Bot';
}

/**
 * Send messages to Discord's Incoming Webhook with rate limit handling
 */
export async function sendToDiscord(
  messages: DiscordMessage[],
  discord_url: string | null
): Promise<SendToDiscordResult> {
  if (!messages || messages.length === 0) {
    return {
      success: true,
      rateLimitInfo: {}
    };
  }

  // If a Discord URL is not set, we do not want to continue and notify the user that it needs to be set
  if (!discord_url) {
    console.error("pm2-discord: Discord URL is not configured.");
    return {
      success: false,
      error: "Discord URL not configured",
      rateLimitInfo: {}
    };
  }

  // The JSON payload to send to the Webhook
  const payload = {
    content: messages.map(msg => msg.description || '').join('\n'),
    // because multiple messages from multiple processes can be batched, set username to combined names
    username: getUserName(messages),
  };

  // Options for the post request
  const options = {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': `pm2-discord/${VERSION}`
    }
  };

  // Set up timeout protection (Discord should respond quickly)
  const FETCH_TIMEOUT_MS = 5000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    debug('Sending to Discord with payload:', payload);
    const res = await fetch(discord_url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    debug(`Discord webhook responded with status ${res.status}`);

    // Parse rate limit headers from response
    const rateLimitInfo = parseRateLimitHeaders(res.headers);

    // Handle 429 Too Many Requests
    if (res.status === 429) {
      let retryAfter: number;
      let isGlobal = false;

      // Try to get retry_after from response body
      try {
        const body: any = await res.json();
        retryAfter = body.retry_after || 0;
        isGlobal = body.global || false;
      } catch (e) {
        // If JSON parsing fails, use header
        retryAfter = res.headers.get('retry-after') ? parseFloat(res.headers.get('retry-after')!) : 0;
      }

      // Check if it's a global rate limit from headers
      if (res.headers.get('x-ratelimit-global')) {
        isGlobal = true;
      }

      console.error(`pm2-discord: Discord rate limit hit. ${isGlobal ? 'Global' : 'Route'} limit. Retry after ${retryAfter}s`);

      return {
        success: false,
        rateLimited: true,
        retryAfter,
        isGlobal,
        rateLimitInfo
      };
    }

    // A successful POST to Discord's webhook responds with a 204 NO CONTENT
    if (res.status === 204) {
      return {
        success: true,
        rateLimitInfo
      };
    }

    // Handle 404 - webhook no longer exists, stop trying to use it
    if (res.status === 404) {
      console.error(`Discord webhook returned 404 Not Found. Webhook is invalid and will not be retried.`);
      return {
        success: false,
        webhookInvalid: true,
        error: `HTTP ${res.status}: ${res.statusText}`,
        rateLimitInfo
      };
    }

    // Handle other error statuses
    console.error(`pm2-discord: Discord webhook returned status ${res.status}: ${res.statusText}`);
    return {
      success: false,
      error: `HTTP ${res.status}: ${res.statusText}`,
      rateLimitInfo
    };

  } catch (error: any) {
    clearTimeout(timeoutId);
    
    // Handle timeout specifically
    if (error.name === 'AbortError') {
      console.error(`pm2-discord: Discord webhook request timed out after ${FETCH_TIMEOUT_MS}ms`);
      return {
        success: false,
        error: 'Webhook request timeout',
        rateLimited: false,
        rateLimitInfo: {}
      };
    }

    console.error('pm2-discord: Error sending to Discord:', error.message);
    return {
      success: false,
      error: error.message,
      rateLimited: false,
      rateLimitInfo: {}
    };
  }
}
