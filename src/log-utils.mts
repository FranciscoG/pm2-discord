import stripAnsi from 'strip-ansi';
import { BusData, LogMessage, Process } from './types/index.js';

/**
 * PM2 stores log messages with date in format "YYYY-MM-DD hh:mm:ss +-zz:zz"
 * This function extracts the timestamp and removes it from the message text,
 * then strips ANSI color codes for clean Discord display.
 * 
 * @param logMessage - Raw log message from PM2, may include timestamp prefix
 * @param formatAsCodeBlock - Whether to format the description as a code block
 * @returns Parsed log with description (stripped of ANSI codes) and Unix timestamp
 * @example
 * // Input: "2026-01-23 10:30:45 +00:00: Server started"
 * // Output: { description: "Server started", timestamp: 1737627045 }
 */
export async function parseIncomingLog(logMessage: string, formatAsCodeBlock: boolean = false): Promise<LogMessage> {
	let description: string | null = null;
	let timestamp: number | null = null;

	if (typeof logMessage === "string") {
		// Parse date on begin (if exists)
		const dateRegex = /([0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{1,2}:[0-9]{2}:[0-9]{2}(\.[0-9]{3})? [+\-]?[0-9]{1,2}:[0-9]{2}(\.[0-9]{3})?)[:\-\s]+/;
		const parsedDescription = dateRegex.exec(logMessage);
		// Note: The `parsedDescription[0]` is datetime with separator(s) on the end.
		//       The `parsedDescription[1]` is datetime only (without separators).
		//       The `parsedDescription[2]` are ".microseconds"
		if (parsedDescription && parsedDescription.length >= 2) {
			// Use timestamp from message
			timestamp = Math.floor(Date.parse(parsedDescription[1]) / 1000);
			// Use message without date, strip ANSI codes
			description = stripAnsi(logMessage.replace(parsedDescription[0], ""));
		} else {
			// Use whole original message, strip ANSI codes
			description = stripAnsi(logMessage);
		}
	}

	if (formatAsCodeBlock && description) {
		description = format(description);
	}

	return {
		description,
		timestamp
	}
}

export function format(str: string): string {
	return "```" + str + "```"
}

/**
 * Generates display name for a PM2 process.
 * In cluster mode with multiple instances, appends [pm_id] to distinguish between workers.
 * This helps identify which specific instance generated a log message.
 * 
 * @param process - PM2 process metadata including exec_mode, instances, and pm_id
 * @returns Display name - either "process-name" or "process-name[pm_id]" for clusters
 * @example
 * // Single instance: { name: "api", exec_mode: "fork_mode" } => "api"
 * // Cluster mode: { name: "api", exec_mode: "cluster_mode", instances: 4, pm_id: 2 } => "api[2]"
 */
export function parseProcessName(process: Process): string {
	const suffix = process.exec_mode === 'cluster_mode' &&
		process.instances > 1 ? `[${process.pm_id}]` : ''
	return process.name + suffix;
}

/**
 * Checks if a PM2 process should have its messages forwarded to Discord.
 * Filters out messages from pm2-discord itself to prevent recursion,
 * and optionally filters by specific process name if configured.
 * 
 * @param data - PM2 bus data containing process information
 * @returns true if messages from this process should be forwarded, false otherwise
 * @example
 * // Always filters out self:
 * checkProcessName({ process: { name: 'pm2-discord' } }) // => false
 * 
 * // Filters by process_name if configured:
 * config.process_name = 'api';
 * checkProcessName({ process: { name: 'api' } })    // => true
 * checkProcessName({ process: { name: 'worker' } }) // => false
 */
export function checkProcessName(data: BusData, configProcessName: string | string[] | null = null): boolean {
	if (data.process.name === 'pm2-discord') { return false; }

	if (typeof configProcessName === 'string' &&
		data.process.name !== configProcessName) {
		return false;
	}

	if (Array.isArray(configProcessName) &&
		!configProcessName.includes(data.process.name)) {
		return false;
	}

	return true;
}