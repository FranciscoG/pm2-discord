const http = require('http');

/** @type {{ SUCCESS: 'success', RATE_LIMIT: 'rate-limit', GLOBAL_RATE_LIMIT: 'global-rate-limit', NOT_FOUND: 'not-found' }} */
const MODES = {
	'SUCCESS': 'success',
	'RATE_LIMIT': 'rate-limit',
	'GLOBAL_RATE_LIMIT': 'global-rate-limit',
	'NOT_FOUND': 'not-found'
};

/**
 * @typedef {object} StoredRequest
 * @property {http.IncomingHttpHeaders} headers
 * @property {object|null} body
 * @property {number} ts - timestamp when request was received
 */

/**
 * @typedef {object} RateLimitConfig
 * @property {number} retry_after - seconds to wait before retrying
 * @property {'user' | 'shared' | 'global'} scope
 * @property {number} limit - max requests in window
 * @property {number} remaining - remaining requests in window
 * @property {number} reset - epoch time when rate limit resets
 * @property {number} reset_after - seconds until rate limit resets
 * @property {string} bucket - rate limit bucket identifier
 */

/**
 * Simple mock Discord webhook server
 * - Captures requests for assertions
 * - Can return different statuses and headers to simulate rate limits, 404, etc.
 * @param {number} port
 * @returns {Promise<{
 *   server: http.Server,
 *   port: number,
 *   getRequests: () => StoredRequest[],
 *   clearRequests: () => void,
 *   setMode: (mode: typeof MODES[keyof typeof MODES]) => void,
 *   setRateLimitConfig: (cfg: Partial<RateLimitConfig>) => void
 * }>}
 */
function startMockDiscordServer(port = 0) {
	let requests = [];

	/** @type {typeof MODES[keyof typeof MODES]} */
	let mode = MODES.SUCCESS; // 'success' | 'rate-limit' | 'global-rate-limit' | 'not-found'

	/** @type {RateLimitConfig} */
	let rateLimitConfig = {
		// Defaults for 429 responses
		retry_after: 2.0,
		scope: 'user', // 'user' | 'shared' | 'global'
		limit: 30,
		remaining: 0,
		reset: Math.floor(Date.now() / 1000) + 2,
		reset_after: 2.0,
		bucket: 'webhook_bucket_test'
	};

	const server = http.createServer(async (req, res) => {
		if (req.method === 'POST' && req.url.startsWith('/webhook')) {
			let body = '';
			req.on('data', chunk => (body += chunk));
			req.on('end', () => {
				requests.push({
					headers: req.headers,
					body: body ? JSON.parse(body) : null,
					ts: Date.now()
				});

				switch (mode) {
					case MODES.SUCCESS:
						// Simulate Discord 204 No Content on success
						res.statusCode = 204;
						res.end();
						break;
					case MODES.RATE_LIMIT:
						// 429 Too Many Requests with user/shared scope
						res.statusCode = 429;
						res.setHeader('content-type', 'application/json');
						res.setHeader('retry-after', String(rateLimitConfig.retry_after));
						res.setHeader('x-ratelimit-limit', String(rateLimitConfig.limit));
						res.setHeader('x-ratelimit-remaining', String(rateLimitConfig.remaining));
						res.setHeader('x-ratelimit-reset', String(rateLimitConfig.reset));
						res.setHeader('x-ratelimit-reset-after', String(rateLimitConfig.reset_after));
						res.setHeader('x-ratelimit-bucket', rateLimitConfig.bucket);
						res.setHeader('x-ratelimit-scope', rateLimitConfig.scope);
						res.end(JSON.stringify({
							message: 'You are being rate limited.',
							retry_after: rateLimitConfig.retry_after,
							global: rateLimitConfig.scope === 'global'
						}));
						break;
					case MODES.GLOBAL_RATE_LIMIT:
						// 429 Too Many Requests with global scope
						res.statusCode = 429;
						res.setHeader('content-type', 'application/json');
						res.setHeader('retry-after', String(rateLimitConfig.retry_after));
						res.setHeader('x-ratelimit-global', 'true');
						res.setHeader('x-ratelimit-scope', 'global');
						res.end(JSON.stringify({
							message: 'You are being rate limited.',
							retry_after: rateLimitConfig.retry_after,
							global: true
						}));
						break;
					case MODES.NOT_FOUND:
						// 404 Not Found
						res.statusCode = 404;
						res.setHeader('content-type', 'application/json');
						res.end(JSON.stringify({ message: 'Webhook not found' }));
						break;
					default:
						res.statusCode = 500;
						res.end('Unknown mode');
				}
			});
			return;
		} else if (req.method === 'GET') {
			// just return text to confirm server is running
			res.statusCode = 200;
			res.end('Mock Discord Server');
			return;
		}

		// Default 404 for other routes
		res.statusCode = 404;
		res.end('Not Found');
	});

	return new Promise((resolve, reject) => {
		server.listen(port, '127.0.0.1', () => {
			const address = server.address();
			console.log('Mock Discord server listening on', address);
			resolve({
				server,
				port: typeof address === 'object' && address !== null ? address.port : port,
				getRequests: () => requests.slice(), // return a copy to capture state at call time
				clearRequests: () => { requests = []; },
				setMode: (newMode) => { mode = newMode; },
				setRateLimitConfig: (cfg) => { rateLimitConfig = { ...rateLimitConfig, ...cfg }; }
			});
		});
		server.on('close', () => {
			console.log('Mock Discord server closed at Timestamp', new Date().toISOString());
		});
		server.on('error', (err) => {
			console.error('Mock Discord Server failed to start:', err);
			reject(err);
		});
	});
}

module.exports = { startMockDiscordServer, MODES };

if (require.main === module) {
	// Run standalone for manual testing
	(async () => {
		const mock = await startMockDiscordServer(8000);
		console.log(`Mock Discord server running on http://127.0.0.1:${mock.port}`);
	})();
}