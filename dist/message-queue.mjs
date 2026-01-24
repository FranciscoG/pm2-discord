import { debug } from './debug.mjs';
// Rate limit constants
// Discord webhooks have a specific limit: 30 requests per 60 seconds = 0.5 req/sec
const WEBHOOK_RATE_LIMIT = 30;
const WEBHOOK_RATE_WINDOW_SECONDS = 60;
const DEFAULT_TICK_INTERVAL_MS = 100;
// Max number of retry attempts per message to prevent infinite loops
// and reduce duplicate message risk in edge cases
const MAX_RETRY_ATTEMPTS = 5;
// Discord message character limit per message
// https://discord.com/developers/docs/resources/channel#create-message
const DISCORD_MESSAGE_CHAR_LIMIT = 2000;
export class MessageQueue {
    constructor(config, sender) {
        this.messageQueue = [];
        this.requestHistory = [];
        this.discordRateLimit = null;
        this.flushInterval = null;
        this.isSending = false;
        this.webhookInvalid = false;
        // Buffer-related properties
        this.bufferTimer = null;
        this.currentBuffer = [];
        // Backoff timeout for rate limit delays
        this.backoffTimeout = null;
        // Track if we're in a rate-limited backoff period
        this.rateLimitedUntil = 0;
        this.characterCount = 0;
        // Shutdown state to prevent new operations during graceful shutdown
        this.isShuttingDown = false;
        this.config = config;
        this.sender = sender;
        // Calculate throttle settings from user config
        // User specifies: rate_limit_messages per rate_limit_window_seconds
        // We need to convert this to: how many requests to send per tick interval
        // Step 1: Extract user's rate limit settings (or use Discord webhook defaults)
        // Discord webhooks: max 30 requests per 60 seconds
        const messages = config.rate_limit_messages ?? WEBHOOK_RATE_LIMIT;
        const windowSeconds = config.rate_limit_window_seconds ?? WEBHOOK_RATE_WINDOW_SECONDS;
        // Step 2: Convert to requests per second
        // Example: 30 messages / 60 seconds = 0.5 requests/second
        const userRatePerSecond = messages / windowSeconds;
        // Step 3: Enforce Discord's hard limit (never exceed 0.5 req/sec)
        // This ensures we respect Discord's rate limits even if user config is too aggressive
        const webhookMaxRatePerSecond = WEBHOOK_RATE_LIMIT / WEBHOOK_RATE_WINDOW_SECONDS;
        const safeRatePerSecond = Math.min(userRatePerSecond, webhookMaxRatePerSecond);
        // Step 4: Calculate tick interval and requests per tick
        // Two cases:
        // Case A: Very low rates (< 1/sec) - use longer intervals
        //   Example: 0.5/sec = 1 request every 2 seconds = 2000ms between ticks
        // Case B: Higher rates (>= 1/sec) - use standard 100ms tick and send multiple per tick
        //   Example: 2/sec with 100ms tick = send 0.2 requests per tick (rounded to 0)
        if (safeRatePerSecond < 1) {
            // Low rate: send 1 request per extended interval
            this.requestsPerTick = 1;
            this.tickIntervalMs = Math.floor(1000 / safeRatePerSecond);
        }
        else {
            // Higher rate: use standard interval and calculate requests per tick
            // Formula: (requests/sec) * (tick_duration_sec) = requests/tick
            // Example: 2 req/sec * 0.1 sec = 0.2 requests/tick (min 1)
            this.tickIntervalMs = DEFAULT_TICK_INTERVAL_MS;
            this.requestsPerTick = Math.max(1, Math.floor(safeRatePerSecond * (this.tickIntervalMs / 1000)));
        }
    }
    /**
     * Get the effective rate in requests per second.
     * Useful for testing and debugging rate limit calculations.
     *
     * @returns Effective rate limit in requests per second
     * @example
     * // With default config (30 messages per 60 seconds):
     * queue.getEffectiveRate() // => 0.5 (30/60)
     */
    getEffectiveRate() {
        return this.requestsPerTick * (1000 / this.tickIntervalMs);
    }
    /**
     * Get the time window for rate limiting in milliseconds.
     * Useful for testing and debugging rate limit window calculations.
     *
     * @returns Rate limit window duration in milliseconds
     * @example
     * // With default 60 second window:
     * queue.getEffectiveWindow() // => 60000
     */
    getEffectiveWindow() {
        const windowSeconds = this.config.rate_limit_window_seconds ?? WEBHOOK_RATE_WINDOW_SECONDS;
        return windowSeconds * 1000;
    }
    /**
     * Checks if webhook has been marked as invalid (404 response).
     * When a webhook returns 404, it's marked invalid to prevent repeated failed requests.
     *
     * @returns true if webhook is invalid and should not be used, false otherwise
     */
    isWebhookInvalid() {
        return this.webhookInvalid;
    }
    /**
     * Records a request in the history for rate limit tracking.
     * Used for testing and monitoring request patterns.
     *
     * @param timestamp - Optional timestamp in milliseconds. Defaults to Date.now()
     */
    recordRequest(timestamp) {
        this.requestHistory.push({
            timestamp: timestamp || Date.now(),
            messageCount: 1
        });
    }
    /**
     * Removes old request history entries outside the current rate limit window.
     * Prevents unbounded memory growth by cleaning up stale tracking data.
     * Called automatically during processTick to maintain a bounded history array.
     */
    cleanupRequestHistory() {
        const now = Date.now();
        const window = this.getEffectiveWindow();
        this.requestHistory = this.requestHistory.filter(entry => {
            return (now - entry.timestamp) < window;
        });
    }
    /**
     * Returns the complete request history for monitoring and testing.
     * History includes timestamps of all requests within the rate limit window.
     *
     * @returns Array of request history entries with timestamps
     */
    getRequestHistory() {
        return this.requestHistory;
    }
    /**
     * Checks if a request can be sent immediately (not in rate limit backoff).
     * Returns false when Discord has rate limited us and we're waiting for retry_after to expire.
     *
     * @returns true if we can send now, false if we're in backoff period
     */
    canSendNow() {
        return Date.now() >= this.rateLimitedUntil;
    }
    /**
     * Calculates delay in milliseconds until next send is allowed.
     * Returns 0 if we can send immediately, otherwise returns remaining backoff time.
     *
     * @returns Milliseconds to wait before next send attempt (0 if ready now)
     * @example
     * // If rate limited for 2 more seconds:
     * queue.getDelayUntilNextSend() // => 2000
     *
     * // If ready to send:
     * queue.getDelayUntilNextSend() // => 0
     */
    getDelayUntilNextSend() {
        const now = Date.now();
        if (now >= this.rateLimitedUntil) {
            return 0;
        }
        return this.rateLimitedUntil - now;
    }
    /**
     * Process one tick of the queue - send up to requestsPerTick messages
     */
    async processTick() {
        // Don't process if already sending, webhook is invalid, or we're shutting down
        if (this.isSending || this.webhookInvalid || this.isShuttingDown) {
            return;
        }
        // If in backoff, schedule a check for when it expires (unless shutting down)
        if (!this.canSendNow()) {
            if (this.flushInterval) {
                this.stopInterval();
            }
            if (!this.isShuttingDown) {
                const delay = this.getDelayUntilNextSend();
                console.debug(`pm2-discord: In rate limit backoff, delaying next send by ${delay}ms`);
                this.backoffTimeout = setTimeout(() => {
                    this.backoffTimeout = null;
                    this.startInterval();
                }, delay);
            }
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
            // Clean up old request history to prevent memory leak
            this.cleanupRequestHistory();
            // Send to Discord
            const result = await this.sender(messagesToSend, this.config.discord_url);
            // Update Discord rate limit info if provided
            if (result.rateLimitInfo) {
                this.discordRateLimit = result.rateLimitInfo;
            }
            // Handle webhook invalid (404) - stop sending
            if (result.webhookInvalid) {
                console.error('pm2-discord: Webhook marked as invalid. Stopping message processing.');
                this.webhookInvalid = true;
                this.stopInterval();
                // Don't put messages back - they can't be sent to an invalid webhook
                return;
            }
            // Handle rate limit response - enter backoff period
            if (result.rateLimited && result.retryAfter) {
                console.log(`pm2-discord: Rate limited by Discord. Backing off for ${result.retryAfter}s`);
                this.rateLimitedUntil = Date.now() + (result.retryAfter * 1000);
                // Put messages back at front of queue for retry (if not exceeding max attempts)
                // Track retry attempts to prevent infinite loops in edge cases
                messagesToSend.forEach(msg => {
                    msg._retryAttempts = (msg._retryAttempts ?? 0) + 1;
                    if (msg._retryAttempts <= MAX_RETRY_ATTEMPTS) {
                        this.messageQueue.unshift(msg);
                    }
                    else {
                        console.warn(`pm2-discord: Message exceeded max retry attempts (${MAX_RETRY_ATTEMPTS}), discarding`);
                    }
                });
            }
            else if (!result.success) {
                // Handle other errors - retry with attempt tracking
                messagesToSend.forEach(msg => {
                    msg._retryAttempts = (msg._retryAttempts ?? 0) + 1;
                    if (msg._retryAttempts <= MAX_RETRY_ATTEMPTS) {
                        // Put failed messages back for retry
                        this.messageQueue.unshift(msg);
                    }
                    else {
                        console.warn(`pm2-discord: Message exceeded max retry attempts (${MAX_RETRY_ATTEMPTS}), discarding: ${result.error}`);
                    }
                });
            }
        }
        catch (error) {
            console.error('pm2-discord: Error sending to Discord:', error);
        }
        finally {
            this.isSending = false;
        }
    }
    /**
     * Start the throttling interval
     * Will not start if shutdown is in progress
     */
    startInterval() {
        if (this.flushInterval || this.isShuttingDown) {
            return; // Already running or shutting down
        }
        this.flushInterval = setInterval(() => {
            this.processTick().catch(err => {
                console.error('pm2-discord: Error in processTick:', err);
            });
        }, this.tickIntervalMs);
    }
    /**
     * Stops all timers and intervals for this queue.
     * Clears both the processing interval and buffer flush timer.
     * Called during shutdown or when queue is empty.
     */
    stopInterval() {
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
            this.flushInterval = null;
        }
        if (this.bufferTimer) {
            clearTimeout(this.bufferTimer);
            this.bufferTimer = null;
        }
        if (this.backoffTimeout) {
            clearTimeout(this.backoffTimeout);
            this.backoffTimeout = null;
        }
    }
    /**
     * Initiates graceful shutdown of this message queue.
     * Sets shutdown flag to prevent new operations and stops all timers.
     * Should be called before flushing remaining messages during process exit.
     */
    beginShutdown() {
        this.isShuttingDown = true;
        this.stopInterval();
    }
    /**
     * Flushes the current message buffer by combining all buffered messages into one.
     * Messages are joined with newlines and added to the processing queue.
     * Resets the buffer and character count to start fresh.
     * Called either when buffer timer expires or when buffer reaches size/character limits.
     */
    flushBuffer() {
        this.characterCount = 0;
        if (this.currentBuffer.length === 0) {
            return;
        }
        // Combine all buffered messages into one
        const combinedMessage = {
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
    /**
     * Checks if the buffer should be flushed immediately.
     * Flushes when character count reaches Discord's 2000 char limit or queue_max messages.
     *
     * @returns true if buffer should flush now, false otherwise
     */
    shouldFlushBuffer() {
        return this.characterCount >= DISCORD_MESSAGE_CHAR_LIMIT || this.currentBuffer.length >= (this.config.queue_max ?? 100);
    }
    /**
     * Adds a message to the queue for sending to Discord.
     * If buffering is enabled, messages are combined within buffer_seconds window.
     * If buffering is disabled, messages are added directly to the processing queue.
     * Automatically handles character limits and truncates oversized messages.
     *
     * During shutdown, new messages are rejected with a warning.
     *
     * @param message - Discord message to add (will be mutated if truncation needed)
     */
    addMessage(message) {
        if (this.isShuttingDown) {
            console.warn('pm2-discord: Ignoring message received during shutdown');
            return;
        }
        const bufferEnabled = this.config.buffer ?? true;
        const bufferSeconds = this.config.buffer_seconds ?? 1;
        debug('Buffer is set to:', bufferEnabled, 'Buffer seconds:', bufferSeconds);
        let newMessageLength = message.description?.length ?? 0;
        // Truncate single messages that exceed the limit
        if (newMessageLength > DISCORD_MESSAGE_CHAR_LIMIT) {
            console.warn('pm2-discord: Single message exceeds 2000 character limit, truncating...');
            message.description = message.description?.substring(0, DISCORD_MESSAGE_CHAR_LIMIT - 3) + '...';
            // Recalculate length after truncation
            newMessageLength = message.description?.length ?? 0;
        }
        if (bufferEnabled) {
            // if adding this new message would exceed Discord's 2000 character limit, flush current buffer first
            // When joining messages with '\n', we add (buffer.length) newline characters total
            // For current buffer of size N, adding 1 message means (N) newlines between all messages
            const newlinesThatWillExist = this.currentBuffer.length; // Each message except first has a newline before it
            if (this.characterCount + newlinesThatWillExist + newMessageLength > DISCORD_MESSAGE_CHAR_LIMIT) {
                console.log('pm2-discord: Adding this message would exceed 2000 character limit, flushing current buffer first.');
                this.flushBuffer();
            }
            // Add to current buffer
            this.currentBuffer.push(message);
            // Track message length (newlines are accounted for during character count check)
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
            // Set timer to flush buffer after buffer_seconds (unless shutting down)
            if (!this.isShuttingDown) {
                this.bufferTimer = setTimeout(() => {
                    this.flushBuffer();
                }, bufferSeconds * 1000);
            }
        }
        else {
            // No buffering - add directly to queue
            this.messageQueue.push(message);
            // Start the interval if not already running
            if (!this.flushInterval) {
                this.startInterval();
            }
        }
    }
    /**
     * Triggers immediate processing of queued messages (for testing).
     * Calls processTick once to send up to requestsPerTick messages.
     * Used primarily in unit tests to synchronously process the queue.
     *
     * @returns Promise that resolves when the tick completes
     */
    async flush() {
        await this.processTick();
    }
}
