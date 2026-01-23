const { execSync } = require('child_process');

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

/**
 * 
 * @param {Record<string, string | number>} envVars 
 * @param {string} [appName='test-app']
 * @returns {void}
 */
function pm2Start(envVars, appName = 'test-app') {
	const envString = Object.entries(envVars).map(([k, v]) => `${k}=${v}`).join(' ');
	execSync(`${envString} npx pm2 start ${__dirname}/test-app.js --name ${appName}`, { stdio: 'inherit' });
}

/**
 * Poll mock server for requests until a minimum count is reached or timeout elapses
 * @param {{ getRequests: () => any[] }} mock
 * @param {{ min?: number, timeoutMs?: number, intervalMs?: number }} opts
 * @returns {Promise<any[]>}
 */
async function waitForRequests(mock, opts = {}) {
	const { min = 1, timeoutMs = 8000, intervalMs = 500 } = opts;
	const start = Date.now();
	let requests = mock.getRequests();
	while (requests.length < min && (Date.now() - start) < timeoutMs) {
		await sleep(intervalMs);
		requests = mock.getRequests();
	}
	return requests;
}

/**
 * This terminates all pm2 processes and uninstalls pm2-discord module
 */
function pm2KillAll() {
	try {
		// first kill any existing pm2 instance to start fresh. This should both stop
		// and remove test-app and also uninstall pm2-discord module.
		execSync('npx pm2 kill', { stdio: 'inherit' });
	} catch (e) {
		// ignore - pm2 might not be running
		console.log('PM2 kill step failed, continuing anyway...', e.message);
	}
}

function pm2ResetConfig() {
	const configKeys = [
		'discord_url',
		'log',
		'buffer_seconds',
		'buffer',
		'queue_max',
	];
	for (const key of configKeys) {
		try {
			execSync(`npx pm2 unset pm2-discord:${key}`, { stdio: 'inherit' });
		} catch (e) {
			// ignore
			console.log(`PM2 unset pm2-discord:${key} failed, ignoring...`, e.message);
		}
	}
}

module.exports = {
	sleep,
	pm2Set,
	pm2Start,
	waitForRequests,
	pm2KillAll,
	pm2ResetConfig
};