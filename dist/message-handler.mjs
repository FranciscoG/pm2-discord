import { MessageQueue } from './message-queue.mjs';
import { sendToDiscord } from './send-to-discord.mjs';
import { getConfigValue } from './config.mjs';
const messageQueues = new Map();
export function addMessage(message, moduleConfig) {
    const processName = message.name;
    const discordUrl = getConfigValue(processName, 'discord_url', moduleConfig);
    if (typeof discordUrl !== 'string') {
        console.warn('pm2-discord: "discord_url" is undefined. No message sent.');
        console.warn('pm2-discord: Set the Discord URL using the following command:');
        console.warn('pm2-discord: `pm2 set pm2-discord:discord_url YOUR_URL`');
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
    // Flush buffers to queue
    queues.forEach(q => q.flushBuffer());
    // Process all messages in the queue with timeout protection
    const maxWaitMs = 5000; // Max 5 seconds to flush
    const startTime = Date.now();
    for (const queue of queues) {
        let attempts = 0;
        const maxAttempts = 50;
        while (queue.messageQueue.length > 0 && !queue.webhookInvalid && attempts < maxAttempts) {
            if (Date.now() - startTime > maxWaitMs) {
                console.warn('pm2-discord: Shutdown timeout reached, exiting with remaining messages', new Date().toISOString());
                break;
            }
            await queue.processTick();
            attempts++;
            // Small delay to allow async operations to complete
            await new Promise(r => setTimeout(r, 50));
        }
    }
    console.log('pm2-discord: Message queues flushed, exiting.');
    process.exit(0);
}
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
