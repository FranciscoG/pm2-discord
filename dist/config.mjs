export const defaultConfig = {
    "discord_url": null,
    "process_name": null,
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
    "buffer": true,
    "buffer_seconds": 1,
    "queue_max": 100,
    "rate_limit_messages": 30,
    "rate_limit_window_seconds": 60
};
export function getConfig(processName, item, config) {
    // @ts-expect-error -- dynamic key access
    return config[`${item}-${processName}`] ?? config[item];
}
export function loadConfig() {
    // Read config directly from environment (PM2 sets this for modules)
    let moduleConfig = {};
    try {
        if (process.env['pm2-discord']) {
            moduleConfig = JSON.parse(process.env['pm2-discord']);
        }
    }
    catch (e) {
        console.error('pm2-discord: Error parsing module config from env:', e);
    }
    return { ...defaultConfig, ...moduleConfig };
}
