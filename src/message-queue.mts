import type { MessageQueueConfig, DiscordMessage, SendToDiscord, RequestHistoryEntry, DiscordRateLimitInfo } from './types/index.js';
import { debug } from './debug.mjs';

// Rate limit constants
// Discord webhooks have a specific limit: 30 requests per 60 seconds = 0.5 req/sec
const WEBHOOK_RATE_LIMIT = 30;
const WEBHOOK_RATE_WINDOW_SECONDS = 60;
const DEFAULT_TICK_INTERVAL_MS = 100;

export class MessageQueue {
  config: MessageQueueConfig
  messageQueue: DiscordMessage[] = []
  sender: SendToDiscord
  requestHistory: RequestHistoryEntry[] = []
  discordRateLimit: DiscordRateLimitInfo | null = null
  flushInterval: NodeJS.Timeout | null = null
  isSending: boolean = false
  webhookInvalid: boolean = false

  // Buffer-related properties
  bufferTimer: NodeJS.Timeout | null = null
  currentBuffer: DiscordMessage[] = []

  // Throttle settings (calculated from config)
  requestsPerTick: number
  tickIntervalMs: number

  // Track if we're in a rate-limited backoff period
  rateLimitedUntil: number = 0

  characterCount: number = 0

  constructor(config: MessageQueueConfig, sender: SendToDiscord) {
    this.config = config;
    this.sender = sender;

    // Calculate throttle settings from user config
    // User sets: rate_limit_messages per rate_limit_window_seconds
    // We convert to: how many requests per tick

    // Get user config or use webhook defaults
    const messages = config.rate_limit_messages ?? WEBHOOK_RATE_LIMIT;
    const windowSeconds = config.rate_limit_window_seconds ?? WEBHOOK_RATE_WINDOW_SECONDS;

    const userRatePerSecond = messages / windowSeconds;

    // Cap at webhook limit (0.5/sec = 30 per 60 seconds)
    const webhookMaxRatePerSecond = WEBHOOK_RATE_LIMIT / WEBHOOK_RATE_WINDOW_SECONDS;
    const safeRatePerSecond = Math.min(userRatePerSecond, webhookMaxRatePerSecond);

    // For very low rates (< 1/sec), adjust the tick interval
    // For example: 0.5/sec = 1 request every 2 seconds = 2000ms interval
    if (safeRatePerSecond < 1) {
      this.requestsPerTick = 1;
      this.tickIntervalMs = Math.floor(1000 / safeRatePerSecond);
    } else {
      // For rates >= 1/sec, use default 100ms tick and calculate requests per tick
      this.tickIntervalMs = DEFAULT_TICK_INTERVAL_MS;
      this.requestsPerTick = Math.max(1, Math.floor(safeRatePerSecond * (this.tickIntervalMs / 1000)));
    }
  }

  /**
   * Get the effective rate in requests per second (for testing)
   */
  getEffectiveRate(): number {
    return this.requestsPerTick * (1000 / this.tickIntervalMs);
  }

  /**
   * Get the time window in milliseconds (for testing)
   */
  getEffectiveWindow(): number {
    const windowSeconds = this.config.rate_limit_window_seconds ?? WEBHOOK_RATE_WINDOW_SECONDS;
    return windowSeconds * 1000;
  }

  /**
   * Check if webhook has been marked as invalid (404)
   */
  isWebhookInvalid(): boolean {
    return this.webhookInvalid;
  }

  /**
   * Record a request in the history (for testing)
   */
  recordRequest(timestamp?: number): void {
    this.requestHistory.push({
      timestamp: timestamp || Date.now(),
      messageCount: 1
    });
  }

  /**
   * Clean up old request history outside the current window
   */
  cleanupRequestHistory(): void {
    const now = Date.now();
    const window = this.getEffectiveWindow();
    this.requestHistory = this.requestHistory.filter(entry => {
      return (now - entry.timestamp) < window;
    });
  }

  /**
   * Get request history (for testing)
   */
  getRequestHistory(): RequestHistoryEntry[] {
    return this.requestHistory;
  }

  /**
   * Check if we can send a request now (not in rate limit backoff)
   */
  canSendNow(): boolean {
    return Date.now() >= this.rateLimitedUntil;
  }

  /**
   * Calculate delay in milliseconds until next send is allowed
   */
  getDelayUntilNextSend(): number {
    const now = Date.now();
    if (now >= this.rateLimitedUntil) {
      return 0;
    }
    return this.rateLimitedUntil - now;
  }

  /**
   * Process one tick of the queue - send up to requestsPerTick messages
   */
  async processTick(): Promise<void> {
    // Don't process if already sending or webhook is invalid
    if (this.isSending || this.webhookInvalid) {
      return;
    }

    // If in backoff, schedule a check for when it expires
    if (!this.canSendNow()) {
      if (this.flushInterval) {
        this.stopInterval();
      }
      const delay = this.getDelayUntilNextSend();
      setTimeout(() => this.startInterval(), delay);
      return;
    }

    // If queue is empty, stop the interval
    if (this.messageQueue.length === 0) {
      this.stopInterval();
      return;
    }

    this.isSending = true;

    try {
      // Take up to requestsPerTick messages from the queue
      const messagesToSend = this.messageQueue.splice(0, this.requestsPerTick);

      if (messagesToSend.length === 0) {
        return;
      }

      // Record the request
      this.recordRequest();

      // Send to Discord
      const result = await this.sender(messagesToSend, this.config.discord_url);

      // Update Discord rate limit info if provided
      if (result.rateLimitInfo) {
        this.discordRateLimit = result.rateLimitInfo;
      }

      // Handle webhook invalid (404) - stop sending
      if (result.webhookInvalid) {
        console.error('Webhook marked as invalid. Stopping message processing.');
        this.webhookInvalid = true;
        this.stopInterval();
        // Don't put messages back - they can't be sent to an invalid webhook
        return;
      }

      // Handle rate limit response - enter backoff period
      if (result.rateLimited && result.retryAfter) {
        console.log(`Rate limited by Discord. Backing off for ${result.retryAfter}s`);
        this.rateLimitedUntil = Date.now() + (result.retryAfter * 1000);
        // Put messages back at front of queue for retry
        this.messageQueue.unshift(...messagesToSend);
      }
    } catch (error) {
      console.error('Error sending to Discord:', error);
    } finally {
      this.isSending = false;
    }
  }

  /**
   * Start the throttling interval
   */
  startInterval(): void {
    if (this.flushInterval) {
      return; // Already running
    }

    this.flushInterval = setInterval(() => {
      this.processTick().catch(err => {
        console.error('pm2-discord: Error in processTick:', err);
      });
    }, this.tickIntervalMs);
  }

  /**
   * Stop the throttling interval
   */
  stopInterval(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    if (this.bufferTimer) {
      clearTimeout(this.bufferTimer);
      this.bufferTimer = null;
    }
  }

  /**
   * Flush the current buffer by combining messages and adding to queue
   */
  flushBuffer(): void {
    this.characterCount = 0;

    if (this.currentBuffer.length === 0) {
      return;
    }

    // Combine all buffered messages into one
    const combinedMessage: DiscordMessage = {
      name: this.currentBuffer[0].name,
      event: this.currentBuffer[0].event,
      description: this.currentBuffer.map(m => m.description || '').join('\n'),
      timestamp: this.currentBuffer[0].timestamp
    };

    // Add combined message to the queue
    this.messageQueue.push(combinedMessage);

    // Clear the buffer
    this.currentBuffer = [];

    // Start the interval if not already running
    if (!this.flushInterval) {
      this.startInterval();
    }
  }

  shouldFlushBuffer(): boolean {
    return this.characterCount >= 2000 || this.currentBuffer.length >= (this.config.queue_max ?? 100)
  }

  /**
   * Add a message to the queue
   * Messages will be sent at the throttled rate
   */
  addMessage(message: DiscordMessage): void {
    const bufferEnabled = this.config.buffer ?? true;
    const bufferSeconds = this.config.buffer_seconds ?? 1;

    debug('Buffer is set to:', bufferEnabled, 'Buffer seconds:', bufferSeconds);
    const newMessageLength = message.description?.length ?? 0;

    // Truncate single messages that exceed the limit
    if (newMessageLength > 2000) {
      console.warn('pm2-discord: Single message exceeds 2000 character limit, truncating...');
      message.description = message.description?.substring(0, 1997) + '...';
    }
    
    if (bufferEnabled) {
      // if adding this new message would exceed Discord's 2000 character limit, flush current buffer first
      // Account for the newline character that will be added when joining (unless buffer is empty)
      const newlineLength = this.currentBuffer.length > 0 ? 1 : 0;
      
      if (this.characterCount + newMessageLength + newlineLength > 2000) {
        console.log('pm2-discord: Adding this message would exceed 2000 character limit, flushing current buffer first.');
        this.flushBuffer();
      }

      // Add to current buffer
      this.currentBuffer.push(message);
      // Add message length + newline length (for the next message that will be added)
      this.characterCount += newMessageLength;
      // Check if buffer has reached queue_max - if so, flush immediately
      if (this.shouldFlushBuffer()) {
        console.log('pm2-discord: Buffer reached queue_max, flushing immediately.');
        // Cancel the timer since we're flushing now
        if (this.bufferTimer) {
          clearTimeout(this.bufferTimer);
          this.bufferTimer = null;
        }
        this.flushBuffer();
        return;
      }

      // Reset the buffer timer
      if (this.bufferTimer) {
        clearTimeout(this.bufferTimer);
      }

      // Set timer to flush buffer after buffer_seconds
      this.bufferTimer = setTimeout(() => {
        this.flushBuffer();
      }, bufferSeconds * 1000);
    } else {
      // No buffering - add directly to queue
      this.messageQueue.push(message);

      // Start the interval if not already running
      if (!this.flushInterval) {
        this.startInterval();
      }
    }
  }

  /**
   * Flush method for testing - triggers immediate processing
   */
  async flush(): Promise<void> {
    await this.processTick();
  }
}
