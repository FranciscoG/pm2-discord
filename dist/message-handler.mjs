import { MessageQueue } from './message-queue.mjs';
import { sendToDiscord } from './send-to-discord.mjs';
import pmx from 'pmx';
// initModule will read the configuration from the package.json file
const moduleConfig = pmx.initModule();
function getConfig(processName, item) {
    return moduleConfig[`${item}-${processName}`] ?? moduleConfig[item];
}
const messageQueues = new Map();
export function addMessage(message) {
    const processName = message.name;
    const discordUrl = getConfig(processName, 'discord_url');
    if (typeof discordUrl !== 'string') {
        console.warn('pm2-discord: "discord_url" is undefined. No message sent.');
        console.warn('pm2-discord: Set the Discord URL using the following command:');
        console.warn('pm2-discord: `pm2 set pm2-discord:discord_url YOUR_URL`');
        return;
    }
    if (!messageQueues.has(discordUrl)) {
        const config = {
            discord_url: discordUrl,
            rate_limit_messages: Number(getConfig(processName, 'rate_limit_messages')),
            rate_limit_window_seconds: Number(getConfig(processName, 'rate_limit_window_seconds')),
            buffer: Boolean(getConfig(processName, 'buffer')),
            buffer_seconds: Number(getConfig(processName, 'buffer_seconds')),
            queue_max: Number(getConfig(processName, 'queue_max')),
        };
        messageQueues.set(discordUrl, new MessageQueue(config, sendToDiscord));
    }
    messageQueues.get(discordUrl).addMessage(message);
}
process.on('SIGINT', () => {
    // Flush all queues before exit
    Array.from(messageQueues.values()).forEach(q => q.flushBuffer());
});
