import pm2 from 'pm2';
import pmx from 'pmx';
import { addMessage } from './message-handler.mjs';
import stripAnsi from 'strip-ansi';
import { loadConfig } from './config.mjs';
pmx.initModule();
const config = loadConfig();
/**
 * PM2 is storing log messages with date in format "YYYY-MM-DD hh:mm:ss +-zz:zz"
 * Parses this date from begin of message
 */
async function parseIncomingLog(logMessage) {
    let description = null;
    let timestamp = null;
    if (typeof logMessage === "string") {
        // Parse date on begin (if exists)
        const dateRegex = /([0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{1,2}:[0-9]{2}:[0-9]{2}(\.[0-9]{3})? [+\-]?[0-9]{1,2}:[0-9]{2}(\.[0-9]{3})?)[:\-\s]+/;
        const parsedDescription = dateRegex.exec(logMessage);
        // Note: The `parsedDescription[0]` is datetime with separator(s) on the end.
        //       The `parsedDescription[1]` is datetime only (without separators).
        //       The `parsedDescription[2]` are ".microseconds"
        if (parsedDescription && parsedDescription.length >= 2) {
            // Use timestamp from message
            timestamp = Math.floor(Date.parse(parsedDescription[1]) / 1000);
            // Use message without date, strip ANSI codes
            description = stripAnsi(logMessage.replace(parsedDescription[0], ""));
        }
        else {
            // Use whole original message, strip ANSI codes
            description = stripAnsi(logMessage);
        }
    }
    if (config.format && description) {
        description = "```" + description + "```";
    }
    return {
        description,
        timestamp
    };
}
/**
 * Get pm2 app display name.
 * If the app is running in cluster mode, id will append [pm_id] as the suffix.
 */
function parseProcessName(process) {
    const suffix = process.exec_mode === 'cluster_mode' &&
        process.instances > 1 ? `[${process.pm_id}]` : '';
    return process.name + suffix;
}
function checkProcessName(data) {
    // We don't want to publish messages from pm2-discord itself
    if (data.process.name === 'pm2-discord') {
        return false;
    }
    // if a specific process name was specified then we check to make sure only 
    // that process gets output
    if (typeof config.process_name === 'string' &&
        data.process.name !== config.process_name) {
        return false;
    }
    return true;
}
// Start listening on the PM2 BUS
pm2.launchBus(function (err, bus) {
    if (err) {
        console.error('pm2-discord: Error launching PM2 bus:', err);
        process.exit(2);
    }
    if (!config.discord_url) {
        // we can't use this module without a discord_url so we should exit
        console.error('pm2-discord: "discord_url" is required and is undefined.');
        console.error('pm2-discord: Set the Discord URL using the following command:');
        console.error('pm2-discord: `pm2 set pm2-discord:discord_url DISCORD_WEBHOOK_URL`');
        process.exit(1);
    }
    // Listen for process logs
    if (config.log) {
        bus.on('log:out', async function (data) {
            if (!checkProcessName(data)) {
                return;
            }
            const parsedLog = await parseIncomingLog(data.data || '');
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
            if (!checkProcessName(data)) {
                return;
            }
            const parsedLog = await parseIncomingLog(data.data || '');
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
            if (!checkProcessName(data)) {
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
        if (!checkProcessName(data)) {
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
