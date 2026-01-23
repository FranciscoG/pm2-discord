// in order for PM2_DISCORD_DEBUG to work you must add it when installing pm2-discord during local testing
// PM2_DISCORD_DEBUG=1 pm2 install .
export function debug(...args) {
    if (process.env['PM2_DISCORD_DEBUG'] === '1') {
        console.debug(`pm2-discord [DEBUG]: ${new Date().toISOString()} - `, ...args);
    }
}
