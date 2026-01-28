
/**
 * Wrapper around console.debug that only logs if `PM2_DISCORD_DEBUG` env var is set.
 * `PM2_DISCORD_DEBUG` must be '1' or 'true' (case insensitive) to enable debug logging.
 * @param args 
 */
export function debug(...args: any[]): void {
	const debugEnv = process.env['PM2_DISCORD_DEBUG'];
	if (debugEnv && (debugEnv === '1' || debugEnv.toLowerCase() === 'true')) {
		console.debug(`pm2-discord [DEBUG]: ${new Date().toISOString()} - `, ...args);
	}
}