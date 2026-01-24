import test from "tape";
import { isValidDiscordWebhookUrl } from "../../dist/message-handler.mjs";
import { convertConfigValue, loadConfig } from "../../dist/config.mjs";
import { getUserName } from "../../dist/send-to-discord.mjs";

// ===== isValidDiscordWebhookUrl TESTS =====
test('isValidDiscordWebhookUrl: accepts valid HTTPS Discord webhook', (t) => {
	const url = 'https://discordapp.com/api/webhooks/123456789/abcdefghijklmno';
	const result = isValidDiscordWebhookUrl(url);
	t.equal(result, true, 'should accept valid Discord webhook URL');
	t.end();
});

test('isValidDiscordWebhookUrl: accepts discord.com domain', (t) => {
	const url = 'https://discord.com/api/webhooks/123456789/abcdefghijklmno';
	const result = isValidDiscordWebhookUrl(url);
	t.equal(result, true, 'should accept discord.com domain');
	t.end();
});

test('isValidDiscordWebhookUrl: rejects HTTP (non-HTTPS)', (t) => {
	const url = 'http://discord.com/api/webhooks/123456789/abcdefghijklmno';
	const result = isValidDiscordWebhookUrl(url);
	t.equal(result, false, 'should reject HTTP URLs');
	t.end();
});

test('isValidDiscordWebhookUrl: rejects non-Discord domains', (t) => {
	const url = 'https://example.com/api/webhooks/123456789/abcdefghijklmno';
	const result = isValidDiscordWebhookUrl(url);
	t.equal(result, false, 'should reject non-Discord domains');
	t.end();
});

test('isValidDiscordWebhookUrl: rejects URL without path', (t) => {
	const url = 'https://discord.com/';
	const result = isValidDiscordWebhookUrl(url);
	t.equal(result, false, 'should reject URL without webhook endpoint');
	t.end();
});

test('isValidDiscordWebhookUrl: rejects URL with only domain', (t) => {
	const url = 'https://discord.com';
	const result = isValidDiscordWebhookUrl(url);
	t.equal(result, false, 'should reject URL with only domain');
	t.end();
});

test('isValidDiscordWebhookUrl: rejects non-string input', (t) => {
	const result = isValidDiscordWebhookUrl(null);
	t.equal(result, false, 'should reject null');
	t.end();
});

test('isValidDiscordWebhookUrl: rejects invalid URL format', (t) => {
	const result = isValidDiscordWebhookUrl('not a url');
	t.equal(result, false, 'should reject malformed URL');
	t.end();
});

test('isValidDiscordWebhookUrl: allows localhost in test environment', (t) => {
	const originalEnv = process.env['PM2_DISCORD_DEBUG'];
	process.env['PM2_DISCORD_DEBUG'] = '1';

	const result = isValidDiscordWebhookUrl('http://127.0.0.1:3000/webhook');
	t.equal(result, true, 'should allow localhost in test environment');

	process.env['PM2_DISCORD_DEBUG'] = originalEnv;
	t.end();
});

// ===== convertConfigValue TESTS =====
test('convertConfigValue: converts "true" string to boolean true', (t) => {
	const result = convertConfigValue('log', 'true');
	t.equal(result, true, 'should convert "true" string to boolean');
	t.end();
});

test('convertConfigValue: converts "false" string to boolean false', (t) => {
	const result = convertConfigValue('log', 'false');
	t.equal(result, false, 'should convert "false" string to boolean');
	t.end();
});

test('convertConfigValue: converts "1" to boolean true', (t) => {
	const result = convertConfigValue('log', '1');
	t.equal(result, true, 'should convert "1" to boolean true');
	t.end();
});

test('convertConfigValue: converts "0" to boolean false', (t) => {
	const result = convertConfigValue('log', '0');
	t.equal(result, false, 'should convert "0" to boolean false');
	t.end();
});

test('convertConfigValue: passes through boolean values unchanged', (t) => {
	const result = convertConfigValue('log', true);
	t.equal(result, true, 'should pass through boolean true');
	t.end();
});

test('convertConfigValue: converts numeric strings to numbers', (t) => {
	const result = convertConfigValue('buffer_seconds', '2');
	t.equal(result, 2, 'should convert numeric string to number');
	t.end();
});

test('convertConfigValue: returns undefined for invalid numbers', (t) => {
	const result = convertConfigValue('buffer_seconds', 'not-a-number');
	t.equal(result, undefined, 'should return undefined for invalid numbers');
	t.end();
});

test('convertConfigValue: preserves numeric values unchanged', (t) => {
	const result = convertConfigValue('buffer_seconds', 3);
	t.equal(result, 3, 'should preserve numeric values');
	t.end();
});

test('convertConfigValue: preserves string values for string keys', (t) => {
	const result = convertConfigValue('discord_url', 'https://discord.com/webhook');
	t.equal(result, 'https://discord.com/webhook', 'should preserve string values');
	t.end();
});

test('convertConfigValue: handles whitespace in numeric strings', (t) => {
	const result = convertConfigValue('queue_max', '  50  ');
	t.equal(result, 50, 'should handle whitespace in numeric strings');
	t.end();
});

test('convertConfigValue: handles case-insensitive "TRUE"', (t) => {
	const result = convertConfigValue('buffer', 'TRUE');
	t.equal(result, true, 'should handle uppercase TRUE');
	t.end();
});

// ===== loadConfig CLAMPING TESTS =====
test('loadConfig: clamps buffer_seconds and queue_max (below min)', (t) => {
	const originalEnv = process.env['pm2-discord'];
	process.env['pm2-discord'] = JSON.stringify({
		buffer_seconds: 0,   // below MIN_BUFFER_SECONDS (1)
		queue_max: 0         // below MIN_QUEUE_MAX (10)
	});

	const cfg = loadConfig();
	t.equal(cfg.buffer_seconds, 1, 'buffer_seconds should clamp to minimum 1');
	t.equal(cfg.queue_max, 10, 'queue_max should clamp to minimum 10');

	process.env['pm2-discord'] = originalEnv;
	t.end();
});

test('loadConfig: clamps buffer_seconds and queue_max (above max)', (t) => {
	const originalEnv = process.env['pm2-discord'];
	process.env['pm2-discord'] = JSON.stringify({
		buffer_seconds: 999, // above MAX_BUFFER_SECONDS (5)
		queue_max: 9999      // above MAX_QUEUE_MAX (100)
	});

	const cfg = loadConfig();
	t.equal(cfg.buffer_seconds, 5, 'buffer_seconds should clamp to maximum 5');
	t.equal(cfg.queue_max, 100, 'queue_max should clamp to maximum 100');

	process.env['pm2-discord'] = originalEnv;
	t.end();
});

// ===== getUserName TESTS =====
test('getUserName: returns single process name', (t) => {
	const messages = [{ name: 'api', description: 'log' }];
	const result = getUserName(messages);
	t.equal(result, 'api', 'should return single process name');
	t.end();
});

test('getUserName: joins multiple process names with comma', (t) => {
	const messages = [
		{ name: 'api', description: 'log' },
		{ name: 'worker', description: 'log' }
	];
	const result = getUserName(messages);
	t.equal(result, 'api, worker', 'should join multiple names with comma');
	t.end();
});

test('getUserName: removes duplicates', (t) => {
	const messages = [
		{ name: 'api', description: 'log' },
		{ name: 'api', description: 'log' }
	];
	const result = getUserName(messages);
	t.equal(result, 'api', 'should remove duplicate names');
	t.end();
});

test('getUserName: trims whitespace from names', (t) => {
	const messages = [{ name: '  api  ', description: 'log' }];
	const result = getUserName(messages);
	t.equal(result, 'api', 'should trim whitespace from names');
	t.end();
});

test('getUserName: filters out empty names', (t) => {
	const messages = [
		{ name: 'api', description: 'log' },
		{ name: '', description: 'log' }
	];
	const result = getUserName(messages);
	t.equal(result, 'api', 'should filter out empty names');
	t.end();
});

test('getUserName: returns default name when all names are empty', (t) => {
	const messages = [
		{ name: '', description: 'log' },
		{ name: '   ', description: 'log' }
	];
	const result = getUserName(messages);
	t.equal(result, 'PM2 Discord Bot', 'should return default name when all are empty');
	t.end();
});

test('getUserName: returns default name for empty array', (t) => {
	const messages = [];
	const result = getUserName(messages);
	t.equal(result, 'PM2 Discord Bot', 'should return default name for empty array');
	t.end();
});

test('getUserName: preserves order of unique names', (t) => {
	const messages = [
		{ name: 'worker', description: 'log' },
		{ name: 'api', description: 'log' },
		{ name: 'cache', description: 'log' }
	];
	const result = getUserName(messages);
	t.equal(result, 'worker, api, cache', 'should preserve order of first appearance');
	t.end();
});
