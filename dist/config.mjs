import { debug } from './debug.mjs';
export const defaultConfig = {
    // these are 
    "log": true,
    "error": false,
    "kill": true,
    "exception": true,
    "restart": false,
    "delete": false,
    "stop": true,
    "restart overlimit": true,
    "exit": false,
    "start": false,
    "online": false,
    // custom options
    "process_name": null,
    "discord_url": null,
    "buffer": true,
    "buffer_seconds": 1,
    "queue_max": 100,
    "rate_limit_messages": 30,
    "rate_limit_window_seconds": 60,
    "format": true
};
export function getConfigValue(processName, item, config) {
    // @ts-expect-error -- dynamic key access
    return config[`${item}-${processName}`] ?? config[item];
}
function clamp(num, min, max) {
    return Math.min(Math.max(num, min), max);
}
export function loadConfig() {
    // Read config directly from environment (PM2 sets this for modules)
    let moduleConfig = {};
    debug(`process.env['pm2-discord'] = ${process.env['pm2-discord']}`);
    try {
        if (process.env['pm2-discord']) {
            moduleConfig = JSON.parse(process.env['pm2-discord']);
        }
    }
    catch (e) {
        console.error('pm2-discord: Error parsing module config from env:', e);
    }
    // need to convert values to correct types
    for (const key in moduleConfig) {
        const value = moduleConfig[key];
        if (value === 'true') {
            moduleConfig[key] = true;
        }
        else if (value === 'false') {
            moduleConfig[key] = false;
        }
        else if (typeof value === 'string' && value.trim() !== '' && !isNaN(Number(value))) {
            moduleConfig[key] = Number(value.trim());
        }
    }
    debug('moduleConfig from env with corrected types:', moduleConfig);
    const finalConfig = { ...defaultConfig, ...moduleConfig };
    // buffer seconds can be between 1 and 5, inclusive
    finalConfig.buffer_seconds = clamp(finalConfig.buffer_seconds, 1, 5);
    // queue max can be between 10 and 100, inclusive
    finalConfig.queue_max = clamp(finalConfig.queue_max, 10, 100);
    debug('finalConfig after merge and clamp:', finalConfig);
    return finalConfig;
}
