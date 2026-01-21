const test = require("tape");

// Mock fetch for testing
let mockFetch;
let fetchCallCount = 0;
let fetchCalls = [];

// Mock node-fetch module before requiring send-to-discord
require.cache[require.resolve('node-fetch')] = {
	id: require.resolve('node-fetch'),
	filename: require.resolve('node-fetch'),
	loaded: true,
	exports: (...args) => {
		fetchCallCount++;
		fetchCalls.push(args);
		return mockFetch(...args);
	}
};

function resetMocks() {
	fetchCallCount = 0;
	fetchCalls = [];
	mockFetch = null;
}

test("sendToDiscord - successful request returns rate limit info", async function (t) {
	t.plan(5);
	resetMocks();

	mockFetch = async (url, options) => {
		return {
			ok: true,
			status: 204,
			headers: {
				get: (header) => {
					const headers = {
						'x-ratelimit-limit': '5',
						'x-ratelimit-remaining': '3',
						'x-ratelimit-reset': '1234567890',
						'x-ratelimit-reset-after': '1.5',
						'x-ratelimit-bucket': 'abc123'
					};
					return headers[header.toLowerCase()] || null;
				}
			}
		};
	};

	// Dynamic import since we need mocks in place first
	const { sendToDiscord } = require('../../dist/send-to-discord.js');

	const messages = [
		{ name: 'test-app', event: 'log', description: 'Test message', timestamp: Date.now() }
	];
	const config = { discord_url: 'https://discord.com/api/webhooks/test' };

	const result = await sendToDiscord(messages, config);

	t.equal(result.success, true, 'request should succeed');
	t.equal(result.rateLimitInfo.limit, 5, 'should parse rate limit');
	t.equal(result.rateLimitInfo.remaining, 3, 'should parse remaining requests');
	t.equal(result.rateLimitInfo.resetAfter, 1.5, 'should parse reset after');
	t.equal(fetchCallCount, 1, 'should make one fetch call');
});

test("sendToDiscord - handles 429 rate limit error with Retry-After header", async function (t) {
	t.plan(4);
	resetMocks();

	mockFetch = async (url, options) => {
		return {
			ok: false,
			status: 429,
			headers: {
				get: (header) => {
					const headers = {
						'retry-after': '3',
						'x-ratelimit-limit': '5',
						'x-ratelimit-remaining': '0',
						'x-ratelimit-reset': '1234567893',
						'x-ratelimit-reset-after': '3',
						'x-ratelimit-scope': 'user'
					};
					return headers[header.toLowerCase()] || null;
				}
			},
			json: async () => ({
				message: 'You are being rate limited.',
				retry_after: 3,
				global: false
			})
		};
	};

	const { sendToDiscord } = require('../../dist/send-to-discord.js');

	const messages = [
		{ name: 'test-app', event: 'log', description: 'Test message', timestamp: Date.now() }
	];
	const config = { discord_url: 'https://discord.com/api/webhooks/test' };

	const result = await sendToDiscord(messages, config);

	t.equal(result.success, false, 'request should fail');
	t.equal(result.rateLimited, true, 'should indicate rate limited');
	t.equal(result.retryAfter, 3, 'should parse retry after from header');
	t.equal(result.rateLimitInfo.remaining, 0, 'should show zero remaining');
});

test("sendToDiscord - handles 429 with retry_after in JSON body", async function (t) {
	t.plan(2);
	resetMocks();

	mockFetch = async (url, options) => {
		return {
			ok: false,
			status: 429,
			headers: {
				get: (header) => {
					// No Retry-After header, should use JSON body
					const headers = {
						'x-ratelimit-limit': '5',
						'x-ratelimit-remaining': '0'
					};
					return headers[header.toLowerCase()] || null;
				}
			},
			json: async () => ({
				message: 'You are being rate limited.',
				retry_after: 5.25,
				global: false
			})
		};
	};

	const { sendToDiscord } = require('../../dist/send-to-discord.js');

	const messages = [
		{ name: 'test-app', event: 'log', description: 'Test message', timestamp: Date.now() }
	];
	const config = { discord_url: 'https://discord.com/api/webhooks/test' };

	const result = await sendToDiscord(messages, config);

	t.equal(result.rateLimited, true, 'should indicate rate limited');
	t.equal(result.retryAfter, 5.25, 'should parse retry after from JSON body');
});

test("sendToDiscord - handles global rate limit (429)", async function (t) {
	t.plan(3);
	resetMocks();

	mockFetch = async (url, options) => {
		return {
			ok: false,
			status: 429,
			headers: {
				get: (header) => {
					const headers = {
						'retry-after': '10',
						'x-ratelimit-global': 'true',
						'x-ratelimit-scope': 'global'
					};
					return headers[header.toLowerCase()] || null;
				}
			},
			json: async () => ({
				message: 'You are being rate limited.',
				retry_after: 10,
				global: true
			})
		};
	};

	const { sendToDiscord } = require('../../dist/send-to-discord.js');

	const messages = [
		{ name: 'test-app', event: 'log', description: 'Test message', timestamp: Date.now() }
	];
	const config = { discord_url: 'https://discord.com/api/webhooks/test' };

	const result = await sendToDiscord(messages, config);

	t.equal(result.rateLimited, true, 'should indicate rate limited');
	t.equal(result.isGlobal, true, 'should indicate global rate limit');
	t.equal(result.retryAfter, 10, 'should parse retry after');
});

test("sendToDiscord - handles network errors gracefully", async function (t) {
	t.plan(3);
	resetMocks();

	mockFetch = async (url, options) => {
		throw new Error('Network error');
	};

	const { sendToDiscord } = require('../../dist/send-to-discord.js');

	const messages = [
		{ name: 'test-app', event: 'log', description: 'Test message', timestamp: Date.now() }
	];
	const config = { discord_url: 'https://discord.com/api/webhooks/test' };

	const result = await sendToDiscord(messages, config);

	t.equal(result.success, false, 'request should fail');
	t.equal(result.error, 'Network error', 'should include error message');
	t.equal(result.rateLimited, false, 'should not be marked as rate limited');
});

test("sendToDiscord - handles non-204 success status", async function (t) {
	t.plan(2);
	resetMocks();

	mockFetch = async (url, options) => {
		return {
			ok: false,
			status: 404,
			statusText: 'Not Found',
			headers: {
				get: () => null
			}
		};
	};

	const { sendToDiscord } = require('../../dist/send-to-discord.js');

	const messages = [
		{ name: 'test-app', event: 'log', description: 'Test message', timestamp: Date.now() }
	];
	const config = { discord_url: 'https://discord.com/api/webhooks/test' };

	const result = await sendToDiscord(messages, config);

	t.equal(result.success, false, 'request should fail');
	t.ok(result.error.includes('404'), 'error should include status code');
});

test("sendToDiscord - marks webhook as invalid on 404", async function (t) {
	t.plan(2);
	resetMocks();

	mockFetch = async (url, options) => {
		return {
			ok: false,
			status: 404,
			statusText: 'Not Found',
			headers: {
				get: () => null
			}
		};
	};

	const { sendToDiscord } = require('../../dist/send-to-discord.js');

	const messages = [
		{ name: 'test-app', event: 'log', description: 'Test message', timestamp: Date.now() }
	];
	const config = { discord_url: 'https://discord.com/api/webhooks/test' };

	const result = await sendToDiscord(messages, config);

	t.equal(result.webhookInvalid, true, 'should mark webhook as invalid');
	t.ok(result.error.includes('404'), 'error should include status');
});

test("sendToDiscord - sends correct payload format", async function (t) {
	t.plan(4);
	resetMocks();

	let capturedPayload = null;

	mockFetch = async (url, options) => {
		capturedPayload = JSON.parse(options.body);
		return {
			ok: true,
			status: 204,
			headers: {
				get: () => null
			}
		};
	};

	const { sendToDiscord } = require('../../dist/send-to-discord.js');

	const messages = [
		{ name: 'app1', event: 'log', description: 'Message 1', timestamp: Date.now() },
		{ name: 'app2', event: 'error', description: 'Message 2', timestamp: Date.now() }
	];
	const config = { discord_url: 'https://discord.com/api/webhooks/test' };

	await sendToDiscord(messages, config);

	t.ok(capturedPayload, 'should capture payload');
	t.ok(capturedPayload.content, 'payload should have content field');
	t.ok(capturedPayload.content.includes('Message 1'), 'should include first message');
	t.ok(capturedPayload.content.includes('Message 2'), 'should include second message');
});

test("sendToDiscord - parses all rate limit headers correctly", async function (t) {
	t.plan(5);
	resetMocks();

	mockFetch = async (url, options) => {
		return {
			ok: true,
			status: 204,
			headers: {
				get: (header) => {
					const headers = {
						'x-ratelimit-limit': '30',
						'x-ratelimit-remaining': '25',
						'x-ratelimit-reset': '1470173023',
						'x-ratelimit-reset-after': '10.5',
						'x-ratelimit-bucket': 'webhook_abc123'
					};
					return headers[header.toLowerCase()] || null;
				}
			}
		};
	};

	const { sendToDiscord } = require('../../dist/send-to-discord.js');

	const messages = [
		{ name: 'test-app', event: 'log', description: 'Test', timestamp: Date.now() }
	];
	const config = { discord_url: 'https://discord.com/api/webhooks/test' };

	const result = await sendToDiscord(messages, config);

	t.equal(result.rateLimitInfo.limit, 30, 'should parse limit');
	t.equal(result.rateLimitInfo.remaining, 25, 'should parse remaining');
	t.equal(result.rateLimitInfo.reset, 1470173023, 'should parse reset timestamp');
	t.equal(result.rateLimitInfo.resetAfter, 10.5, 'should parse reset after');
	t.equal(result.rateLimitInfo.bucket, 'webhook_abc123', 'should parse bucket');
});
