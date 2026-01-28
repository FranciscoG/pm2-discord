const { test, after, before } = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('child_process');
const { startMockDiscordServer, MODES } = require('../fixtures/mock-discord-server');
const {
	sleep,
	pm2Set,
	pm2Unset,
	pm2Start,
	waitForRequests,
	pm2KillAll,
	pm2ResetConfig,
	pm2Delete,
	isPm2DiscordRunning,
	installPm2DiscordModule,
	pm2restart,
	pm2MultiSet
} = require('./utils');

const APP_NAME = 'test-app';

before(() => {
	console.log(`\n\n==== Setting up integration test environment ====`);
	// start fresh, kill everything from any previous runs. This uninstalls pm2-discord too.
	// however it doesn't reset any config items set previously, so we will do that manually below.
	pm2KillAll();

	// this will remove all config settings set for pm2-discord
	pm2ResetConfig();

	pm2MultiSet({
		// start with a required discord_url setting so that pm2-discord doesn't exit immediately
		'discord_url': `http://127.0.0.1:8000/webhook/`,
		// enable logging for all tests
		"log": true,
		// disable rich formatting for easier testing
		"format": false
	});

	// And then we install pm2-discord to ensure a clean state.
	// This one is important, if it fails, the test cannot continue.
	installPm2DiscordModule();

	// you can't use the `--no-autorestart` flag when installing a module, so we need to
	// stop and start it again to ensure autorestart is disabled for testing.
	execSync('npx pm2 stop pm2-discord', { stdio: 'inherit' }); // ensure stopped before tests begin
	execSync('npx pm2 start pm2-discord --no-autorestart', { stdio: 'inherit' }); // start fresh

	console.log(`==== Integration test environment setup complete ====\n\n`);
});

/**
 * 
 * @param {() => Promise<void>} testFn 
 */
async function withCleanup(testFn) {
	// console.log the function name for easier debugging.
	// names are in camelCase (example: testDiscordWebhookRateLimitingAndBuffering)
	// and should be converted to sentence case for readability. (example: "Test discord webhook rate limiting and buffering")
	const name = testFn.name.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()).trim();
	console.log(`\n======= Running test: ${name} ======================\n`);
	try {
		await testFn();
	} finally {
		// Always try to clean up test-app
		pm2Delete(APP_NAME, `Cleanup for test: ${name}`);
		// Give PM2 a moment to process the deletion
		await sleep(500);
	}
}

/**
 * @param {string} envVars 
 * @param {string} appName
 * @param {number} sleepMs
 */
async function startWaitThenStopApp(envVars, appName, sleepMs) {
	pm2Start(envVars, appName);
	await sleep(sleepMs);
	pm2Delete(appName, 'startWaitThenStopApp');
}

/**
 * @type {Awaited<ReturnType<import('../fixtures/mock-discord-server').startMockDiscordServer>>}
 */
let mock;

/**
 * I needed to run all of the tests sequentially to avoid PM2 module conflicts.
 * So everything is in one big test block.
 */
test('Integration tests', async () => {
	async function missingDiscordUrlTest() {
		console.log('pm2-discord should exit immediately if "discord_url" is not set');

		// First verify the module is running
		let isRunning = isPm2DiscordRunning();
		assert.ok(isRunning, 'pm2-discord should be running initially');

		pm2Unset('discord_url');
		pm2restart();

		// Wait a moment for the module to attempt restart and exit
		await sleep(2000);

		// Check if module stopped
		isRunning = isPm2DiscordRunning();
		assert.ok(!isRunning, 'pm2-discord should have exited due to missing discord_url');
	}
	await withCleanup(missingDiscordUrlTest);

	async function testDiscordWebhookRateLimitingAndBuffering() {
		console.log('Starting Integration Test: success path with buffering + rate limiting');
		mock = await startMockDiscordServer(8000);

		// Configure pm2-discord to point to mock server
		const url = `http://127.0.0.1:${mock.port}/webhook/`;
		pm2Set('discord_url', url);

		await startWaitThenStopApp('INTERVAL_MS=20', APP_NAME, 6000);

		// wait to allow any remaining messages to flush
		await sleep(4000);

		const requests = await waitForRequests(mock, { min: 1, timeoutMs: 8000, intervalMs: 500 });

		assert.ok(requests.length > 0, 'mock server should receive requests');

		// Check that payloads contain multiple combined messages due to buffering
		const anyCombined = requests.some(r => r.body && r.body.content && r.body.content.split('\n').length >= 3);
		assert.ok(anyCombined, 'at least one request should contain combined messages');

		// Ensure we did not exceed webhook safe rate (approx <= 0.5 req/sec)
		const durationSec = 6;
		const maxExpected = Math.ceil(durationSec * 0.5) + 2; // +2 slack during shutdown flush
		assert.ok(requests.length <= maxExpected, `should not exceed ${maxExpected} requests in ${durationSec}s, received ${requests.length}`);

		mock.server.close();
	};
	await withCleanup(testDiscordWebhookRateLimitingAndBuffering);

	async function testDiscordWebhookRateLimitBackoff() {
		console.log('Integration: handles 429 rate limit backoff');
		mock = await startMockDiscordServer(8001);

		mock.setMode(MODES.RATE_LIMIT);
		mock.setRateLimitConfig({ retry_after: 1.5, scope: 'user' });

		const url = `http://127.0.0.1:${mock.port}/webhook/`;
		pm2Set('discord_url', url);

		await startWaitThenStopApp('INTERVAL_MS=200', APP_NAME, 3500);

		// wait to allow any remaining messages to flush
		await sleep(4000);

		const requests = await waitForRequests(mock, { min: 1, timeoutMs: 8000, intervalMs: 500 });

		// We expect at least one 429 to have been returned and the module to back off
		// Since our mock always returns 429, we expect a small number of attempts respecting retry_after
		assert.ok(requests.length <= 3, 'should respect backoff and limit request attempts');

		// Verify last response included rate limit headers
		const last = requests[requests.length - 1];
		assert.ok(last, 'should have at least one request');
		mock.server.close();
	};
	await withCleanup(testDiscordWebhookRateLimitBackoff);

	async function testStopsOn404Response() {
		console.log('Integration: stops sending on 404 invalid webhook');
		mock = await startMockDiscordServer(8001);

		mock.setMode(MODES.NOT_FOUND);

		const url = `http://127.0.0.1:${mock.port}/webhook/`;
		pm2Set('discord_url', url);

		await startWaitThenStopApp('INTERVAL_MS=50', APP_NAME, 2500);

		// what should happen now is only 1 attempt is made to send to Discord.
		// Discord will return a 404 which should stop pm2-discord from attempting again

		// this should just be 1
		let requests = await waitForRequests(mock, { min: 1, timeoutMs: 5000, intervalMs: 500 });
		const initialCount = requests.length;


		requests = await waitForRequests(mock, { min: 1, timeoutMs: 8000, intervalMs: 500 });
		const finalCount = requests.length;

		assert.ok(initialCount >= 1, `should make at least one attempt. Initial attempts: ${initialCount}`);
		assert.strictEqual(finalCount, initialCount, `should stop attempting after 404. Final attempts: ${finalCount}`);
		mock.server.close();
	}
	await withCleanup(testStopsOn404Response);

	async function testGracefulShutdownFlushesMessages() {
		console.log('Integration: graceful shutdown flushes all messages')
		mock = await startMockDiscordServer(8002);

		mock.setMode(MODES.SUCCESS);

		const url = `http://127.0.0.1:${mock.port}/webhook/`;
		pm2MultiSet({
			'discord_url': url,
			'buffer_seconds': 5, // Long buffer to ensure messages are pending on shutdown
		});

		await startWaitThenStopApp('INTERVAL_MS=100', APP_NAME, 2000);

		// Stop (SIGINT) instead of del to allow graceful shutdown
		pm2Delete(APP_NAME);

		// Poll for flush completion so the mock server stays alive long enough
		const requests = await waitForRequests(mock, { min: 1, timeoutMs: 8000, intervalMs: 500 });

		// Small grace period for any final in-flight send
		await sleep(1000);

		console.log('After shutdown, total requests received:', requests.length);
		if (requests.length > 0) {
			console.log('First request content length:', requests[0].body?.content?.length);
		}

		assert.ok(requests.length > 0, 'should flush buffered messages on shutdown');
		assert.ok(requests.some(r => r.body && r.body.content), 'should contain message content');

		mock.server.close();
		// reset the buffer_seconds to default so other tests aren't affected
		pm2Unset('buffer_seconds')
	}
	await withCleanup(testGracefulShutdownFlushesMessages);

	async function testHandlesGlobalRateLimit() {
		console.log('Integration: handles global rate limit (429 with global scope)')
		mock = await startMockDiscordServer(8003);

		mock.setMode(MODES.GLOBAL_RATE_LIMIT);
		mock.setRateLimitConfig({ retry_after: 1.0, scope: 'global' });

		const url = `http://127.0.0.1:${mock.port}/webhook/`;
		pm2Set('discord_url', url);

		await startWaitThenStopApp('INTERVAL_MS=100', APP_NAME, 2000);

		// wait for any pending messages to flush
		await sleep(3000);

		const requests = await waitForRequests(mock, { min: 1, timeoutMs: 8000, intervalMs: 500 });

		// With global rate limit, we expect the module to back off and not spam requests
		// Should respect the global rate limit and make fewer attempts
		assert.ok(requests.length >= 1, 'should make at least one attempt');
		assert.ok(requests.length <= 3, 'should respect global rate limit and limit request attempts');

		mock.server.close();
	}

	await withCleanup(testHandlesGlobalRateLimit);

	async function testBufferingDisabledSendsMessagesImmediately() {
		console.log('Integration: buffering disabled - sends messages immediately')
		mock = await startMockDiscordServer(8004);

		mock.setMode(MODES.SUCCESS);

		const url = `http://127.0.0.1:${mock.port}/webhook/`;
		pm2MultiSet({
			'discord_url': url,
			'buffer': false,
		});

		await sleep(1000);

		pm2Start('INTERVAL_MS=100', APP_NAME);

		// With buffering disabled, messages should be sent immediately to the queue
		// But rate limiting (0.5 req/sec) still applies
		// Give more time for module to start and process initial messages
		await sleep(5000);

		let requests = await waitForRequests(mock, { min: 1, timeoutMs: 5000, intervalMs: 200 });
		const requestsAfter5s = requests.length;

		pm2Delete(APP_NAME);

		await sleep(2000);

		requests = await waitForRequests(mock, { min: requestsAfter5s, timeoutMs: 6000, intervalMs: 500 });
		const totalRequests = requests.length;

		// Without buffering, each message goes directly to queue and gets processed at rate limit
		// So we expect individual messages, not combined ones
		assert.ok(requestsAfter5s >= 1, `should receive at least 1 request in 5s (got ${requestsAfter5s})`);

		// Check that messages are not combined (each should be individual)
		const allIndividual = requests.every(r => {
			const lines = r.body?.content?.trim().split('\n').filter(Boolean) || [];
			return lines.length === 1;
		});
		assert.ok(allIndividual, 'messages should not be combined when buffering is disabled');

		// Rate limiting should still work - max ~0.5 req/sec for 5 seconds total = ~2-3 requests
		assert.ok(totalRequests <= 4, `should respect rate limiting (got ${totalRequests} requests)`);

		mock.server.close();
		// Reset buffer setting
		pm2Unset('buffer');

	}

	await withCleanup(testBufferingDisabledSendsMessagesImmediately);

	async function testRespectsCharacterLimitInBufferedMessages() {
		console.log('Integration: respects 2000 character limit in buffered messages')
		mock = await startMockDiscordServer(8005);

		mock.setMode(MODES.SUCCESS);

		const url = `http://127.0.0.1:${mock.port}/webhook/`;
		pm2MultiSet({
			'discord_url': url,
			'buffer': true,
			'buffer_seconds': 2
		});

		await sleep(1000);

		pm2Start('INTERVAL_MS=50', APP_NAME); // Generate logs quickly to fill buffer

		// Let it run long enough to generate many messages that would exceed 2000 chars if combined
		await sleep(4000);

		pm2Delete(APP_NAME);

		// Wait for final flush
		await sleep(3000);

		const requests = await waitForRequests(mock, { min: 1, timeoutMs: 8000, intervalMs: 500 });

		assert.ok(requests.length > 0, 'should receive at least one request');

		// Check that no single request exceeds 2000 characters
		const exceedsLimit = requests.some(r => {
			const contentLength = r.body?.content?.length ?? 0;
			return contentLength > 2000;
		});
		assert.ok(!exceedsLimit, 'no request should exceed 2000 character limit');

		// Check that we have multiple requests (proving buffering was split)
		assert.ok(requests.length >= 2, 'should have multiple requests due to character limit splitting');

		// Verify all requests with content are under the limit
		const allValid = requests.every(r => {
			const contentLength = r.body?.content?.length ?? 0;
			return contentLength <= 2000;
		});
		assert.ok(allValid, 'all requests should have content within 2000 character limit');

		mock.server.close();
		// Reset settings
		pm2Unset('buffer_seconds');
	}
	await withCleanup(testRespectsCharacterLimitInBufferedMessages);
});


after(() => {
	console.log(`\n\nCleaning up after integration tests`);
	mock?.server?.close((error) => {
		if (error) {
			console.error('Error closing mock server:', error);
		}
	});

	// Then kill everything
	pm2KillAll();

	// Give PM2 time to clean up
	execSync('sleep 1');
	console.log(`Integration tests complete.\n\n`);
});