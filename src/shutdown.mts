import type { MessageQueue } from './message-queue.mjs';

// Shutdown timeout constants
const SHUTDOWN_TIMEOUT_MS = 5000; // Max 5 seconds to flush remaining messages
const MAX_SHUTDOWN_ATTEMPTS = 50; // Max iterations to drain queue
const SHUTDOWN_RETRY_DELAY_MS = 50; // Delay between queue processing attempts

export async function gracefulShutdown(messageQueue: MessageQueue) {
	// Flush queue before exit
	if (!messageQueue) {
		process.exit(0);
	}

	console.log('pm2-discord: Caught shutdown signal, flushing message queue before exit.', new Date().toISOString());

	const queue = messageQueue;
	queue.beginShutdown();
	queue.flushBuffer();

	// Process all messages in the queue with timeout protection
	const startTime = Date.now();
	let attempts = 0;
	while (queue.messageQueue.length > 0 && !queue.webhookInvalid && attempts < MAX_SHUTDOWN_ATTEMPTS) {
		if (Date.now() - startTime > SHUTDOWN_TIMEOUT_MS) {
			console.warn('pm2-discord: Shutdown timeout reached, exiting with remaining messages', new Date().toISOString());
			break;
		}
		await queue.processTick();
		attempts++;
		// Small delay to allow async operations to complete
		await new Promise(r => setTimeout(r, SHUTDOWN_RETRY_DELAY_MS));
	}

	console.log('pm2-discord: Message queue flushed, exiting.');
	process.exit(0);
}

