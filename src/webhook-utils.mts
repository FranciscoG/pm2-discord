/**
 * Validates that a URL is a valid Discord webhook URL.
 * Prevents SSRF attacks by ensuring the URL is HTTPS and from Discord's domain.
 */
export function isValidDiscordWebhookUrl(url: string | null): boolean {
	if (typeof url !== 'string' || !url.trim()) {
		console.error('pm2-discord: "discord_url" is required and is undefined.')
		console.error('pm2-discord: Set the Discord URL using the following command:')
		console.error('pm2-discord: `pm2 set pm2-discord:discord_url DISCORD_WEBHOOK_URL`')
		return false;
	}

	const isTestEnv = process.env['NODE_ENV'] === 'test';
	if (isTestEnv && url.includes('http://127.0.0.1')) {
		// Allow localhost URLs in test environment for testing purposes
		return true;
	}

	try {

		const parsed = new URL(url);

		// Must use HTTPS for security
		if (parsed.protocol !== 'https:') {
			console.warn('pm2-discord: Discord URL must use HTTPS protocol');
			return false;
		}

		// Must be from Discord's domain
		if (!parsed.hostname.includes('discord.com') && !parsed.hostname.includes('discordapp.com')) {
			console.warn('pm2-discord: Discord URL must be from discord.com or discordapp.com domain');
			return false;
		}

		// Must have a pathname (webhook endpoint)
		if (!parsed.pathname || parsed.pathname === '/') {
			console.warn('pm2-discord: Discord URL must include the webhook endpoint');
			return false;
		}

		return true;
	} catch (e) {
		console.warn('pm2-discord: Invalid Discord URL format');
		return false;
	}
}
