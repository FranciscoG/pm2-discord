
export interface DiscordMessage {
  name: string,
  event: string,
  description: string | null,
  timestamp: number | null,
  /**
   * Internal: Number of times this message has been attempted to send.
   * Used to prevent infinite retries in case of persistent failures.
   */
  _retryAttempts?: number
}

export interface Process {
  name: string,
  exec_mode: string,
  instances: number,
  pm_id: string | number
}

// data.process.name
export interface BusData {
  process: Process,
  data?: string
}

export interface LogMessage {
  description: string | null,
  timestamp: number | null
}

/**
 * Discord API rate limit information from response headers
 */
export interface DiscordRateLimitInfo {
  /** The number of requests that can be made */
  limit?: number,
  /** The number of remaining requests that can be made */
  remaining?: number,
  /** Epoch time (seconds) at which the rate limit resets */
  reset?: number,
  /** Total time (in seconds) of when the current rate limit bucket will reset */
  resetAfter?: number,
  /** A unique string denoting the rate limit being encountered */
  bucket?: string
}

/**
 * Result from sending messages to Discord
 */
export interface SendToDiscordResult {
  /** Whether the request was successful */
  success: boolean,
  /** Whether the request was rate limited (429 response) */
  rateLimited?: boolean,
  /** Seconds to wait before retrying (from Retry-After header or response body) */
  retryAfter?: number,
  /** Whether this is a global rate limit */
  isGlobal?: boolean,
  /** Whether the webhook is invalid (404 response) - should stop sending */
  webhookInvalid?: boolean,
  /** Rate limit information from response headers */
  rateLimitInfo: DiscordRateLimitInfo,
  /** Error message if request failed */
  error?: string
}

export interface SendToDiscord {
  (messages: DiscordMessage[], discord_url: string | null): Promise<SendToDiscordResult>
}

/**
 * Tracks a single request in the rate limit history
 */
export interface RequestHistoryEntry {
  timestamp: number,
  messageCount: number
}

/**
 * These config items are custom to pm2-discord
 */
export interface MessageQueueConfig {
  discord_url: string | null,
  rate_limit_messages: number,
  rate_limit_window_seconds: number,
  buffer: boolean,
  buffer_seconds: number,
  queue_max: number,
}

export interface Config extends MessageQueueConfig {
  process_name: string | null
  log: boolean
  error: boolean
  kill: boolean
  exception: boolean
  restart: boolean
  delete: boolean
  stop: boolean
  "restart overlimit": boolean
  exit: boolean
  start: boolean
  online: boolean,
  format: boolean
}