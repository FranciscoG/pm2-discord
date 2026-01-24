import pm2 from 'pm2';
import pmx from 'pmx';
import { addMessage, gracefulShutdown } from './message-handler.mjs';
import stripAnsi from 'strip-ansi';
import { loadConfig } from './config.mjs';
import { parseIncomingLog, parseProcessName, checkProcessName } from './log-utils.mjs';
// Only initialize PMX when not running tests
// PMX starts background connections that prevent test processes from exiting
if (process.env.NODE_ENV !== 'test') {
    pmx.initModule();
}
const config = loadConfig();
pm2.launchBus(function (err, bus) {
    if (err) {
        console.error('pm2-discord: Error launching PM2 bus:', err);
        // Trigger graceful shutdown which will flush any pending messages before exiting
        gracefulShutdown().catch(e => {
            console.error('pm2-discord: Error during graceful shutdown:', e);
            process.exit(2);
        });
        return;
    }
    if (!config.discord_url) {
        // we can't use this module without a discord_url so we should exit
        console.error('pm2-discord: "discord_url" is required and is undefined.');
        console.error('pm2-discord: Set the Discord URL using the following command:');
        console.error('pm2-discord: `pm2 set pm2-discord:discord_url DISCORD_WEBHOOK_URL`');
        // we don't need to flush messages here since none could have been sent
        process.exit(3);
    }
    // Listen for process logs
    if (config.log) {
        bus.on('log:out', async function (data) {
            if (!checkProcessName(data, config.process_name)) {
                return;
            }
            const parsedLog = await parseIncomingLog(data.data || '', config.format);
            addMessage({
                name: parseProcessName(data.process),
                event: 'log',
                description: parsedLog.description,
                timestamp: parsedLog.timestamp,
            }, config);
        });
    }
    // Listen for process errors
    if (config.error) {
        bus.on('log:err', async function (data) {
            if (!checkProcessName(data, config.process_name)) {
                return;
            }
            const parsedLog = await parseIncomingLog(data.data || '', config.format);
            addMessage({
                name: parseProcessName(data.process),
                event: 'error',
                description: parsedLog.description,
                timestamp: parsedLog.timestamp,
            }, config);
        });
    }
    // Listen for PM2 kill
    if (config.kill) {
        bus.on('pm2:kill', function (data) {
            addMessage({
                name: 'PM2',
                event: 'kill',
                description: data.msg,
                timestamp: Math.floor(Date.now() / 1000),
            }, config);
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
            const description = stripAnsi(rawDescription);
            addMessage({
                name: parseProcessName(data.process),
                event: 'exception',
                description: description,
                timestamp: Math.floor(Date.now() / 1000),
            }, config);
        });
    }
    // Listen for PM2 events
    bus.on('process:event', function (data) {
        const setting = config[data.event];
        if (typeof setting === 'boolean' && !setting) {
            return;
        } // This event type is disabled by configuration.
        if (!checkProcessName(data, config.process_name)) {
            return;
        }
        addMessage({
            name: parseProcessName(data.process),
            event: data.event,
            description: `The following event has occurred on the PM2 process ${data.process.name}: ${data.event}`,
            timestamp: Math.floor(Date.now() / 1000),
        }, config);
    });
});
