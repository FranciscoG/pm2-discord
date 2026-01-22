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

setInterval(logOnce, intervalMs);

// Keep process alive
process.stdin.resume();
