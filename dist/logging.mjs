/**
 * Wrapper around console.debug that only logs if `PM2_DISCORD_DEBUG` env var is set.
 * `PM2_DISCORD_DEBUG` must be '1' or 'true' (case insensitive) to enable debug logging.
 * @param args
 */
export function debug(...args) {
    const debugEnv = process.env['PM2_DISCORD_DEBUG'];
    if (debugEnv && (debugEnv === '1' || debugEnv.toLowerCase() === 'true')) {
        console.debug(`pm2-discord [DEBUG]: ${new Date().toISOString()} - `, ...args);
    }
}
export function log(level, ...args) {
    const timestamp = `pm2-discord [${level.toUpperCase()}]: ${new Date().toISOString()} - `;
    switch (level) {
        case 'log':
        case 'info':
        case 'warn':
        case 'error':
        case 'debug':
            console[level](timestamp, ...args);
            break;
        default:
            console[level](...args);
    }
}
