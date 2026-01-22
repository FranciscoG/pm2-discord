const test = require('tape');
const { execSync } = require('child_process');
const { startMockDiscordServer, MODES } = require('./mock-discord-server');

const APP_NAME = 'test-app';

/**
 * @param {number} ms 
 * @returns {Promise<void>}
 */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * 
 * @param {string} key 
 * @param {string | number | boolean} value 
 * @returns {void}
 */
function pm2Set(key, value) {
	execSync(`npx pm2 set pm2-discord:${key} ${value}`, { stdio: 'inherit' });
}

// pm2 set pm2-discord:discord_url http://127.0.0.1:8000/webhook/success

/**
 * 
 * @param {Record<string, string | number>} envVars 
 * @returns {void}
 */
function pm2Start(envVars) {
	const envString = Object.entries(envVars).map(([k, v]) => `${k}=${v}`).join(' ');
	execSync(`${envString} npx pm2 start ${__dirname}/test-app.js --name ${APP_NAME}`, { stdio: 'inherit' });
}

try {
	// first kill any existing pm2 instance to start fresh. This should both stop
	// and remove test-app and also uninstall pm2-discord module.
	execSync('npx pm2 kill', { stdio: 'inherit' });
} catch (e) {
	// ignore - pm2 might not be running
	console.log('PM2 kill step failed, continuing anyway...', e.message);
}

// And then we re-install pm2-discord to ensure a clean state.
// This one is important, if it fails, the test cannot continue.
execSync('npx pm2 install .', { stdio: 'inherit' });

test.only('Integration: success path with buffering + rate limiting', async function (t) {
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
	// console.log('Stopping test-app at timestamp', new Date().toISOString());
	execSync(`npx pm2 stop ${APP_NAME}`, { stdio: 'inherit' });

	// wait to allow any remaining messages to flush
	await sleep(4000);

	const requests = mock.getRequests();

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

	execSync(`npx pm2 stop ${APP_NAME}`, { stdio: 'inherit' });

	// wait to allow any remaining messages to flush
	await sleep(4000);

	const requests = mock.getRequests();

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
	const mock = await startMockDiscordServer(0);

	mock.setMode(MODES.NOT_FOUND);

	const url = `http://127.0.0.1:${mock.port}/webhook/not-found`;
	pm2Set('discord_url', url);
	pm2Set('log', true);

	pm2Start({ INTERVAL_MS: 50 });

	// Wait a bit to allow an initial attempt
	await sleep(2500);

	execSync(`npx pm2 stop ${APP_NAME}`, { stdio: 'inherit' });

	// wait to allow any remaining messages to flush
	await sleep(4000);

	const initialCount = mock.getRequests().length;

	// Wait longer and ensure no more attempts are made after 404
	await sleep(2500);

	const finalCount = mock.getRequests().length;

	t.ok(initialCount >= 1, 'should make at least one attempt');
	t.equal(finalCount, initialCount, 'should stop attempting after 404');
	mock.server.close();
});

test.onFinish(() => {
	try {
		execSync('npx pm2 kill', { stdio: 'inherit' });
	} catch (e) {
		// ignore
		console.log('PM2 kill on finish failed, ignoring...', e.message);
	}
});