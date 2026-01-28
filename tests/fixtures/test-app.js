// Simple test app that logs messages at different intervals
// Controlled via environment variables:

const intervalMs = Number(process.env.INTERVAL_MS || 500);

let counter = 0;

function logOnce() {
	counter++;
	const now = new Date();
	const ts = now.toISOString();
	// Emit a line similar to PM2 logs (with timestamp)
	console.log(`${ts} - test-app log line ${counter} at interval ${intervalMs}ms`);
}

const intervalId = setInterval(logOnce, intervalMs);

/**
 * 
 * @param {'SIGINT' | 'SIGTERM'} signal 
 */
function handleShutdown(signal) {
	console.log(`test-app.js received ${signal}, stopping log interval...`);
	clearInterval(intervalId);
	process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
