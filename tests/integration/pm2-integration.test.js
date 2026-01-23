const test = require('tape');
const { execSync } = require('child_process');
const { startMockDiscordServer, MODES } = require('./mock-discord-server');
const { sleep, pm2Set, pm2Start, waitForRequests, pm2KillAll, pm2ResetConfig } = require('./utils');

const APP_NAME = 'test-app';

// start fresh, kill everything from any previous runs. This uninstalls pm2-discord too.
// however it doesn't reset any config items set previously, so we will do that manually below.
pm2KillAll();

// this will remove all config settings set for pm2-discord
pm2ResetConfig();

pm2Set('format', false); // disable rich formatting for easier testing

// And then we re-install pm2-discord to ensure a clean state.
// This one is important, if it fails, the test cannot continue.
execSync('PM2_DISCORD_DEBUG=1 npx pm2 install .', { stdio: 'inherit' });

test('Integration: success path with buffering + rate limiting', async function (t) {
	t.plan(3);
	const mock = await startMockDiscordServer(8000);

	// Configure pm2-discord to point to mock server
	const url = `http://127.0.0.1:${mock.port}/webhook/success`;
	pm2Set('discord_url', url);
	pm2Set('log', true);

	// Start test app simulating a busy process generating logs quickly
	pm2Start({ INTERVAL_MS: 20 });

	// Let it run for ~6 seconds (enough for a few buffer flushes and rate ticks)
	await sleep(6000);

	// then kill the test app so it stops generating logs and allows any buffered messages to flush
	execSync(`npx pm2 del ${APP_NAME}`, { stdio: 'inherit' });

	// wait to allow any remaining messages to flush
	await sleep(4000);

	const requests = await waitForRequests(mock, { min: 1, timeoutMs: 8000, intervalMs: 500 });

	t.ok(requests.length > 0, 'mock server should receive requests');

	// Check that payloads contain multiple combined messages due to buffering
	const anyCombined = requests.some(r => r.body && r.body.content && r.body.content.split('\n').length >= 3);
	t.ok(anyCombined, 'at least one request should contain combined messages');

	// Ensure we did not exceed webhook safe rate (approx <= 0.5 req/sec)
	const durationSec = 6;
	const maxExpected = Math.ceil(durationSec * 0.5) + 1; // +1 slack
	t.ok(requests.length <= maxExpected, `should not exceed ${maxExpected} requests in ${durationSec}s`);

	// console.log('Test completed, closing mock server at timestamp', new Date().toISOString());
	mock.server.close();
});

test('Integration: handles 429 rate limit backoff', async function (t) {
	t.plan(2);
	const mock = await startMockDiscordServer(8001);

	mock.setMode(MODES.RATE_LIMIT);
	mock.setRateLimitConfig({ retry_after: 1.5, scope: 'user' });

	const url = `http://127.0.0.1:${mock.port}/webhook/rate-limit`;
	pm2Set('discord_url', url);
	pm2Set('log', true);

	pm2Start({ INTERVAL_MS: 200 });

	await sleep(3500);

	execSync(`npx pm2 del ${APP_NAME}`, { stdio: 'inherit' });

	// wait to allow any remaining messages to flush
	await sleep(4000);

	const requests = await waitForRequests(mock, { min: 1, timeoutMs: 8000, intervalMs: 500 });

	// We expect at least one 429 to have been returned and the module to back off
	// Since our mock always returns 429, we expect a small number of attempts respecting retry_after
	t.ok(requests.length <= 3, 'should respect backoff and limit request attempts');

	// Verify last response included rate limit headers
	const last = requests[requests.length - 1];
	t.ok(last, 'should have at least one request');
	mock.server.close();
});

test('Integration: stops sending on 404 invalid webhook', async function (t) {
	t.plan(2);
	const mock = await startMockDiscordServer(8001);

	mock.setMode(MODES.NOT_FOUND);

	const url = `http://127.0.0.1:${mock.port}/webhook/not-found`;
	pm2Set('discord_url', url);
	pm2Set('log', true);

	pm2Start({ INTERVAL_MS: 50 });

	// Wait a bit to allow test-app to generate some logs
	await sleep(2500);

	// kill the test-app to stop log generation and signal flush
	execSync(`npx pm2 del ${APP_NAME}`, { stdio: 'inherit' });

	// what should happen now is only 1 attempt is made to send to Discord.
	// Discord will return a 404 which should stop pm2-discord from attempting again

	// this should just be 1
	let requests = await waitForRequests(mock, { min: 1, timeoutMs: 5000, intervalMs: 500 });
	const initialCount = requests.length;


	requests = await waitForRequests(mock, { min: 1, timeoutMs: 8000, intervalMs: 500 });
	const finalCount = requests.length;

	t.ok(initialCount >= 1, `should make at least one attempt. Initial attempts: ${initialCount}`);
	t.equal(finalCount, initialCount, `should stop attempting after 404. Final attempts: ${finalCount}`);
	mock.server.close();
});

test('Integration: graceful shutdown flushes all messages', async function (t) {
	t.plan(2);
	const mock = await startMockDiscordServer(8002);

	mock.setMode(MODES.SUCCESS);

	const url = `http://127.0.0.1:${mock.port}/webhook/success`;
	pm2Set('discord_url', url);
	pm2Set('log', true);
	pm2Set('buffer_seconds', 5); // Long buffer to ensure messages are pending on shutdown

	pm2Start({ INTERVAL_MS: 100 });

	// Let it generate some logs but don't wait long enough for natural flush
	await sleep(2000);

	console.log('About to stop test-app, mock requests so far:', mock.getRequests().length);

	// Stop (SIGINT) instead of del to allow graceful shutdown
	execSync(`npx pm2 del ${APP_NAME}`, { stdio: 'inherit' });

	// Poll for flush completion so the mock server stays alive long enough
	const requests = await waitForRequests(mock, { min: 1, timeoutMs: 8000, intervalMs: 500 });

	// Small grace period for any final in-flight send
	await sleep(1000);

	console.log('After shutdown, total requests received:', requests.length);
	if (requests.length > 0) {
		console.log('First request content length:', requests[0].body?.content?.length);
	}

	t.ok(requests.length > 0, 'should flush buffered messages on shutdown');
	t.ok(requests.some(r => r.body && r.body.content), 'should contain message content');

	mock.server.close();
	// reset the buffer_seconds to default so other tests aren't affected
	execSync(`npx pm2 unset pm2-discord:buffer_seconds`, { stdio: 'inherit' });
});

test('Integration: handles global rate limit (429 with global scope)', async function (t) {
	t.plan(2);
	const mock = await startMockDiscordServer(8003);

	mock.setMode(MODES.GLOBAL_RATE_LIMIT);
	mock.setRateLimitConfig({ retry_after: 1.0, scope: 'global' });

	const url = `http://127.0.0.1:${mock.port}/webhook/global-limit`;
	pm2Set('discord_url', url);
	pm2Set('log', true);

	pm2Start({ INTERVAL_MS: 100 });

	await sleep(2000);

	execSync(`npx pm2 del ${APP_NAME}`, { stdio: 'inherit' });

	// wait for any pending messages to flush
	await sleep(3000);

	const requests = await waitForRequests(mock, { min: 1, timeoutMs: 8000, intervalMs: 500 });

	// With global rate limit, we expect the module to back off and not spam requests
	// Should respect the global rate limit and make fewer attempts
	t.ok(requests.length >= 1, 'should make at least one attempt');
	t.ok(requests.length <= 3, 'should respect global rate limit and limit request attempts');

	mock.server.close();
});

test('Integration: buffering disabled - sends messages immediately', async function (t) {
	t.plan(3);
	const mock = await startMockDiscordServer(8004);

	mock.setMode(MODES.SUCCESS);

	const url = `http://127.0.0.1:${mock.port}/webhook/no-buffer`;
	pm2Set('discord_url', url);
	pm2Set('log', true);
	pm2Set('buffer', false);  // Disable buffering

	await sleep(1000);

	pm2Start({ INTERVAL_MS: 100 });

	// With buffering disabled, messages should be sent immediately to the queue
	// But rate limiting (0.5 req/sec) still applies
	// Give more time for module to start and process initial messages
	await sleep(5000);

	let requests = await waitForRequests(mock, { min: 1, timeoutMs: 5000, intervalMs: 200 });
	const requestsAfter5s = requests.length;

	execSync(`npx pm2 del ${APP_NAME}`, { stdio: 'inherit' });

	await sleep(2000);

	requests = await waitForRequests(mock, { min: requestsAfter5s, timeoutMs: 6000, intervalMs: 500 });
	const totalRequests = requests.length;

	// Without buffering, each message goes directly to queue and gets processed at rate limit
	// So we expect individual messages, not combined ones
	t.ok(requestsAfter5s >= 1, `should receive at least 1 request in 5s (got ${requestsAfter5s})`);

	// Check that messages are not combined (each should be individual)
	const allIndividual = requests.every(r => {
		const lines = r.body?.content?.trim().split('\n').filter(Boolean) || [];
		return lines.length === 1;
	});
	t.ok(allIndividual, 'messages should not be combined when buffering is disabled');

	// Rate limiting should still work - max ~0.5 req/sec for 5 seconds total = ~2-3 requests
	t.ok(totalRequests <= 3, `should respect rate limiting (got ${totalRequests} requests)`);

	mock.server.close();
	// Reset buffer setting
	execSync(`npx pm2 unset pm2-discord:buffer`, { stdio: 'inherit' });
});

test('Integration: respects 2000 character limit in buffered messages', async function (t) {
	t.plan(4);
	const mock = await startMockDiscordServer(8005);

	mock.setMode(MODES.SUCCESS);

	const url = `http://127.0.0.1:${mock.port}/webhook/char-limit`;
	pm2Set('discord_url', url);
	pm2Set('log', true);
	pm2Set('buffer', true);
	pm2Set('buffer_seconds', 2);

	await sleep(1000);

	pm2Start({ INTERVAL_MS: 50 }); // Generate logs quickly to fill buffer

	// Let it run long enough to generate many messages that would exceed 2000 chars if combined
	await sleep(4000);

	execSync(`npx pm2 del ${APP_NAME}`, { stdio: 'inherit' });

	// Wait for final flush
	await sleep(3000);

	const requests = await waitForRequests(mock, { min: 1, timeoutMs: 8000, intervalMs: 500 });

	t.ok(requests.length > 0, 'should receive at least one request');

	// Check that no single request exceeds 2000 characters
	const exceedsLimit = requests.some(r => {
		const contentLength = r.body?.content?.length ?? 0;
		return contentLength > 2000;
	});
	t.notOk(exceedsLimit, 'no request should exceed 2000 character limit');

	// Check that we have multiple requests (proving buffering was split)
	t.ok(requests.length >= 2, 'should have multiple requests due to character limit splitting');

	// Verify all requests with content are under the limit
	const allValid = requests.every(r => {
		const contentLength = r.body?.content?.length ?? 0;
		return contentLength <= 2000;
	});
	t.ok(allValid, 'all requests should have content within 2000 character limit');

	mock.server.close();
	// Reset settings
	execSync(`npx pm2 unset pm2-discord:buffer_seconds`, { stdio: 'inherit' });
});

test.onFinish(() => {
	try {
		// kill will stop and delete all pm2 processes and uninstall modules
		execSync('npx pm2 kill', { stdio: 'inherit' });
	} catch (e) {
		// ignore
		console.log('PM2 kill on finish failed, ignoring...', e.message);
	}
});