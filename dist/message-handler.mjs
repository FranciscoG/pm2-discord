import { MessageQueue } from './message-queue.mjs';
import { sendToDiscord } from './send-to-discord.mjs';
import { getConfigValue } from './config.mjs';
// Shutdown timeout constants
const SHUTDOWN_TIMEOUT_MS = 5000; // Max 5 seconds to flush remaining messages
const MAX_SHUTDOWN_ATTEMPTS = 50; // Max iterations to drain queue
const SHUTDOWN_RETRY_DELAY_MS = 50; // Delay between queue processing attempts
const messageQueues = new Map();
/**
 * Validates that a URL is a valid Discord webhook URL
 * Prevents SSRF attacks by ensuring the URL is HTTPS and from Discord's domain
 */
export function isValidDiscordWebhookUrl(url) {
    if (typeof url !== 'string') {
        return false;
    }
    const isTestEnv = process.env['PM2_DISCORD_DEBUG'] === '1';
    if (isTestEnv && url.includes('http://127.0.0.1')) {
        // Allow localhost URLs in test environment for testing purposes
        return true;
    }
    try {
        const parsed = new URL(url);
        // Must use HTTPS for security
        if (parsed.protocol !== 'https:') {
            console.warn('pm2-discord: Discord URL must use HTTPS protocol');
            return false;
        }
        // Must be from Discord's domain
        if (!parsed.hostname.includes('discord.com') && !parsed.hostname.includes('discordapp.com')) {
            console.warn('pm2-discord: Discord URL must be from discord.com or discordapp.com domain');
            return false;
        }
        // Must have a pathname (webhook endpoint)
        if (!parsed.pathname || parsed.pathname === '/') {
            console.warn('pm2-discord: Discord URL must include the webhook endpoint');
            return false;
        }
        return true;
    }
    catch (e) {
        console.warn('pm2-discord: Invalid Discord URL format');
        return false;
    }
}
export function addMessage(message, moduleConfig) {
    const processName = message.name;
    const discordUrl = getConfigValue(processName, 'discord_url', moduleConfig);
    if (typeof discordUrl !== 'string') {
        console.warn('pm2-discord: "discord_url" is undefined. No message sent.');
        console.warn('pm2-discord: Set the Discord URL using the following command:');
        console.warn('pm2-discord: `pm2 set pm2-discord:discord_url YOUR_URL`');
        return;
    }
    // Validate the Discord URL for security (SSRF prevention)
    if (!isValidDiscordWebhookUrl(discordUrl)) {
        console.warn('pm2-discord: Invalid Discord webhook URL. No message sent.');
        return;
    }
    if (!messageQueues.has(discordUrl)) {
        const config = {
            discord_url: discordUrl,
            rate_limit_messages: Number(getConfigValue(processName, 'rate_limit_messages', moduleConfig)),
            rate_limit_window_seconds: Number(getConfigValue(processName, 'rate_limit_window_seconds', moduleConfig)),
            buffer: Boolean(getConfigValue(processName, 'buffer', moduleConfig)),
            buffer_seconds: Number(getConfigValue(processName, 'buffer_seconds', moduleConfig)),
            queue_max: Number(getConfigValue(processName, 'queue_max', moduleConfig)),
        };
        console.log(`pm2-discord: Creating message queue with config:`, config);
        messageQueues.set(discordUrl, new MessageQueue(config, sendToDiscord));
    }
    messageQueues.get(discordUrl).addMessage(message);
}
async function gracefulShutdown() {
    // Flush all queues before exit
    console.log('pm2-discord: Caught shutdown signal, flushing message queues before exit.', new Date().toISOString());
    const queues = Array.from(messageQueues.values());
    // Mark all queues as shutting down to prevent race conditions
    queues.forEach(q => q.beginShutdown());
    // Flush buffers to queue
    queues.forEach(q => q.flushBuffer());
    // Process all messages in the queue with timeout protection
    const startTime = Date.now();
    for (const queue of queues) {
        let attempts = 0;
        while (queue.messageQueue.length > 0 && !queue.webhookInvalid && attempts < MAX_SHUTDOWN_ATTEMPTS) {
            if (Date.now() - startTime > SHUTDOWN_TIMEOUT_MS) {
                console.warn('pm2-discord: Shutdown timeout reached, exiting with remaining messages', new Date().toISOString());
                break;
            }
            await queue.processTick();
            attempts++;
            // Small delay to allow async operations to complete
            await new Promise(r => setTimeout(r, SHUTDOWN_RETRY_DELAY_MS));
        }
    }
    console.log('pm2-discord: Message queues flushed, exiting.');
    process.exit(0);
}
/**
 * Export graceful shutdown for use in other modules
 * Allows other parts of the app to trigger shutdown if needed
 */
export { gracefulShutdown };
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
