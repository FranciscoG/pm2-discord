import { MessageQueue } from './message-queue.mjs';
import { sendToDiscord } from './send-to-discord.mjs';
import { getConfig } from './config.mjs';
const messageQueues = new Map();
export function addMessage(message, moduleConfig) {
    console.log('pm2-discord: Adding message to queue:', message);
    const processName = message.name;
    const discordUrl = getConfig(processName, 'discord_url', moduleConfig);
    if (typeof discordUrl !== 'string') {
        console.warn('pm2-discord: "discord_url" is undefined. No message sent.');
        console.warn('pm2-discord: Set the Discord URL using the following command:');
        console.warn('pm2-discord: `pm2 set pm2-discord:discord_url YOUR_URL`');
        return;
    }
    if (!messageQueues.has(discordUrl)) {
        const config = {
            discord_url: discordUrl,
            rate_limit_messages: Number(getConfig(processName, 'rate_limit_messages', moduleConfig)),
            rate_limit_window_seconds: Number(getConfig(processName, 'rate_limit_window_seconds', moduleConfig)),
            buffer: Boolean(getConfig(processName, 'buffer', moduleConfig)),
            buffer_seconds: Number(getConfig(processName, 'buffer_seconds', moduleConfig)),
            queue_max: Number(getConfig(processName, 'queue_max', moduleConfig)),
        };
        console.log(`pm2-discord: Creating message queue with config:`, config);
        messageQueues.set(discordUrl, new MessageQueue(config, sendToDiscord));
    }
    messageQueues.get(discordUrl).addMessage(message);
}
// process.on('SIGINT', () => {
//   // Flush all queues before exit
// 	console.log('pm2-discord: Caught SIGINT, flushing message queues before exit.');
//   Array.from(messageQueues.values()).forEach(q => q.flushBuffer());
// });
