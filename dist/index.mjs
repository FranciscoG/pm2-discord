import pm2 from 'pm2';
import pmx from 'pmx';
import stripAnsi from 'strip-ansi';
import { loadConfig } from './config.mjs';
import { debug } from './debug.mjs';
import { checkProcessName, format, parseIncomingLog, parseProcessName } from './log-utils.mjs';
import { MessageQueue } from './message-queue.mjs';
import { sendToDiscord } from './send-to-discord.mjs';
import { gracefulShutdown } from './shutdown.mjs';
import { isValidDiscordWebhookUrl } from './webhook-utils.mjs';
const config = loadConfig();
if (!isValidDiscordWebhookUrl(config.discord_url)) {
    // Invalid Discord webhook URL, exit the module
    process.exit(1);
}
const configFromInit = pmx.initModule(null, onInit);
debug('pm2-discord: Module initialized with config:', configFromInit);
function onInit() {
    const messageQueue = new MessageQueue({
        discord_url: config.discord_url,
        rate_limit_messages: config.rate_limit_messages,
        rate_limit_window_seconds: config.rate_limit_window_seconds,
        buffer: config.buffer,
        buffer_seconds: config.buffer_seconds,
        queue_max: config.queue_max,
    }, sendToDiscord);
    // Handle graceful shutdown
    const handleShutdown = () => gracefulShutdown(messageQueue).catch(e => {
        console.error('pm2-discord: Error during graceful shutdown:', e);
        process.exit(1);
    });
    process.on('SIGINT', handleShutdown);
    process.on('SIGTERM', handleShutdown);
    pm2.launchBus(function (err, bus) {
        // The error arg of the callback for pm2.launchBus will always be null
        // see: 
        // - https://github.com/Unitech/pm2/blob/v6.0.14/lib/API.js#L260
        // which calls:
        // - https://github.com/Unitech/pm2/blob/v6.0.14/lib/Client.js#L439
        // Listen for process logs
        if (config.log) {
            bus.on('log:out', async function (data) {
                if (!checkProcessName(data, config.process_name)) {
                    return;
                }
                const parsedLog = await parseIncomingLog(data.data || '', config.format);
                messageQueue.addMessage({
                    name: parseProcessName(data.process),
                    event: 'log',
                    description: parsedLog.description,
                    timestamp: parsedLog.timestamp,
                });
            });
        }
        // Listen for process errors
        if (config.error) {
            bus.on('log:err', async function (data) {
                if (!checkProcessName(data, config.process_name)) {
                    return;
                }
                const parsedLog = await parseIncomingLog(data.data || '', config.format);
                messageQueue.addMessage({
                    name: parseProcessName(data.process),
                    event: 'error',
                    description: parsedLog.description,
                    timestamp: parsedLog.timestamp,
                });
            });
        }
        // Listen for PM2 kill
        if (config.kill) {
            bus.on('pm2:kill', function (data) {
                messageQueue.addMessage({
                    name: 'PM2',
                    event: 'kill',
                    description: config.format ? format(data.msg) : data.msg,
                    timestamp: Math.floor(Date.now() / 1000),
                });
            });
        }
        // Listen for process exceptions
        if (config.exception) {
            bus.on('process:exception', async function (data) {
                if (!checkProcessName(data, config.process_name)) {
                    return;
                }
                // If it is instance of Error, use it. If type is unknown, stringify it.
                const rawDescription = (data.data && data.data.message) ? (data.data.code || '') + data.data.message : JSON.stringify(data.data);
                const description = config.format ? format(stripAnsi(rawDescription)) : stripAnsi(rawDescription);
                messageQueue.addMessage({
                    name: parseProcessName(data.process),
                    event: 'exception',
                    description,
                    timestamp: Math.floor(Date.now() / 1000),
                });
            });
        }
        // PM2 process events (restart, stop, start, exit, online, delete, "restart overlimit")
        bus.on('process:event', function (data) {
            const setting = config[data.event];
            if (typeof setting === 'boolean' && !setting) {
                return;
            } // This event type is disabled by configuration.
            if (!checkProcessName(data, config.process_name)) {
                return;
            }
            const message = `The following event has occurred on the PM2 process ${data.process.name}: ${data.event}`;
            messageQueue.addMessage({
                name: parseProcessName(data.process),
                event: data.event,
                description: config.format ? format(message) : message,
                timestamp: Math.floor(Date.now() / 1000),
            });
        });
    });
}
