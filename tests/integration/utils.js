const { execSync } = require('node:child_process');
const { join } = require('node:path');

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
 * @param {string} key 
 * @returns {void}
 */
function pm2Unset(key) {
	execSync(`npx pm2 unset pm2-discord:${key}`, { stdio: 'inherit' });
}

/**
 * 
 * @param {string} envVars 
 * @param {string} appName
 * @returns {void}
 */
function pm2Start(envVars, appName) {

	execSync(`${envVars} npx pm2 start ${join(__dirname, '..', 'fixtures', 'test-app.js')} --name ${appName}`, { stdio: 'inherit' });
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

/**
 * Resets all pm2-discord module configuration to defaults
 */
function pm2ResetConfig() {
	// get currently configured items
	const output = execSync('npx pm2 conf pm2-discord', { encoding: 'utf-8' });
	/* Example output:
Module: pm2-discord
$ pm2 set pm2-discord:log true
$ pm2 set pm2-discord:format false
$ pm2 set pm2-discord:discord_url http://127.0.0.1:8000/webhook/
	*/
	if (output.includes('pm2 set pm2-discord:')) {
		console.log('PM2 pm2-discord module configuration found, resetting to defaults...');
		output.split('\n').forEach(line => {
			const match = line.match(/^\$ pm2 set pm2-discord:(.+?) (.+)$/);
			if (match) {
				const [, key] = match;
				try {
					pm2Unset(key);
				} catch (e) {
					// ignore
					console.log(`PM2 unset pm2-discord:${key} failed, ignoring...`, e.message);
				}
			}
		})
	}
}

/**
 * stop [options] <id|name|all|json|stdin…>	stop a process 
 * (to start it again, do pm2 restart <app>)
 * @param {string} appName 
 */
function pm2Stop(appName) {
	try {
		execSync(`npx pm2 stop ${appName}`, { stdio: 'inherit' });
	} catch (e) {
		console.log(`PM2 stop ${appName} failed:`, e.message);
	}
}

/**
 * delete <name|id|script|all|json|stdin…> - stop and delete a process from pm2 process list
 * @param {string} appName 
 */
function pm2Delete(appName) {
	try {
		const output = execSync(`npx pm2 show ${appName}`, { stdio: 'inherit' });
	} catch (e) {
		console.log(`No process found for ${appName}`, e.message);
		return;
	}
	try {
		execSync(`npx pm2 delete ${appName}`, { stdio: 'inherit' });
	} catch (e) {
		console.log(`PM2 delete ${appName} failed:`, e.message);
		// Try force delete
		try {
			execSync(`npx pm2 delete ${appName} --force`, { stdio: 'inherit' });
		} catch (e2) {
			console.log(`PM2 force delete ${appName} also failed:`, e2.message);
		}
	}
}

/**
 * Kill any orphaned test-app.js processes running outside PM2 control
 */
function killOrphanedTestApps() {
	try {
		// Kill any node processes running test-app.js that aren't managed by PM2
		// The || true ensures the command doesn't fail if no processes are found
		execSync(`pkill -f "node.*test-app\\.js" || true`, { stdio: 'pipe' });
	} catch (e) {
		// ignore - no orphaned processes found
	}
}

module.exports = {
	sleep,
	pm2Set,
	pm2Unset,
	pm2Start,
	pm2Stop,
	waitForRequests,
	pm2KillAll,
	pm2ResetConfig,
	pm2Delete,
	killOrphanedTestApps
};