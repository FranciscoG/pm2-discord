import assert from "node:assert/strict";
import { test } from "node:test";
import { convertConfigValue, loadConfig } from "../../dist/config.mjs";
import { getUserName } from "../../dist/send-to-discord.mjs";
import { isValidDiscordWebhookUrl } from "../../dist/webhook-utils.mjs";

// ===== isValidDiscordWebhookUrl TESTS =====
test('isValidDiscordWebhookUrl: accepts valid HTTPS Discord webhook', () => {
	const url = 'https://discordapp.com/api/webhooks/123456789/abcdefghijklmno';
	const result = isValidDiscordWebhookUrl(url);
	assert.strictEqual(result, true, 'should accept valid Discord webhook URL');
});

test('isValidDiscordWebhookUrl: accepts discord.com domain', () => {
	const url = 'https://discord.com/api/webhooks/123456789/abcdefghijklmno';
	const result = isValidDiscordWebhookUrl(url);
	assert.strictEqual(result, true, 'should accept discord.com domain');
});

test('isValidDiscordWebhookUrl: rejects HTTP (non-HTTPS)', () => {
	const url = 'http://discord.com/api/webhooks/123456789/abcdefghijklmno';
	const result = isValidDiscordWebhookUrl(url);
	assert.strictEqual(result, false, 'should reject HTTP URLs');
});

test('isValidDiscordWebhookUrl: rejects non-Discord domains', () => {
	const url = 'https://example.com/api/webhooks/123456789/abcdefghijklmno';
	const result = isValidDiscordWebhookUrl(url);
	assert.strictEqual(result, false, 'should reject non-Discord domains');
});

test('isValidDiscordWebhookUrl: rejects URL without path', () => {
	const url = 'https://discord.com/';
	const result = isValidDiscordWebhookUrl(url);
	assert.strictEqual(result, false, 'should reject URL without webhook endpoint');
});

test('isValidDiscordWebhookUrl: rejects URL with only domain', () => {
	const url = 'https://discord.com';
	const result = isValidDiscordWebhookUrl(url);
	assert.strictEqual(result, false, 'should reject URL with only domain');
});

test('isValidDiscordWebhookUrl: rejects non-string input', () => {
	const result = isValidDiscordWebhookUrl(null);
	assert.strictEqual(result, false, 'should reject null');
});

test('isValidDiscordWebhookUrl: rejects invalid URL format', () => {
	const result = isValidDiscordWebhookUrl('not a url');
	assert.strictEqual(result, false, 'should reject malformed URL');
});

test('isValidDiscordWebhookUrl: allows localhost in test environment', () => {
	const originalEnv = process.env['PM2_DISCORD_DEBUG'];
	process.env['PM2_DISCORD_DEBUG'] = '1';

	const result = isValidDiscordWebhookUrl('http://127.0.0.1:3000/webhook');
	assert.strictEqual(result, true, 'should allow localhost in test environment');

	process.env['PM2_DISCORD_DEBUG'] = originalEnv;
});

// ===== convertConfigValue TESTS =====
test('convertConfigValue: converts "true" string to boolean true', () => {
	const result = convertConfigValue('log', 'true');
	assert.strictEqual(result, true, 'should convert "true" string to boolean');
});

test('convertConfigValue: converts "false" string to boolean false', () => {
	const result = convertConfigValue('log', 'false');
	assert.strictEqual(result, false, 'should convert "false" string to boolean');
});

test('convertConfigValue: converts "1" to boolean true', () => {
	const result = convertConfigValue('log', '1');
	assert.strictEqual(result, true, 'should convert "1" to boolean true');
});

test('convertConfigValue: converts "0" to boolean false', () => {
	const result = convertConfigValue('log', '0');
	assert.strictEqual(result, false, 'should convert "0" to boolean false');
});

test('convertConfigValue: passes through boolean values unchanged', () => {
	const result = convertConfigValue('log', true);
	assert.strictEqual(result, true, 'should pass through boolean true');
});

test('convertConfigValue: converts numeric strings to numbers', () => {
	const result = convertConfigValue('buffer_seconds', '2');
	assert.strictEqual(result, 2, 'should convert numeric string to number');
});

test('convertConfigValue: returns undefined for invalid numbers', () => {
	const result = convertConfigValue('buffer_seconds', 'not-a-number');
	assert.strictEqual(result, undefined, 'should return undefined for invalid numbers');
});

test('convertConfigValue: preserves numeric values unchanged', () => {
	const result = convertConfigValue('buffer_seconds', 3);
	assert.strictEqual(result, 3, 'should preserve numeric values');
});

test('convertConfigValue: preserves string values for string keys', () => {
	const result = convertConfigValue('discord_url', 'https://discord.com/webhook');
	assert.strictEqual(result, 'https://discord.com/webhook', 'should preserve string values');
});

test('convertConfigValue: handles whitespace in numeric strings', () => {
	const result = convertConfigValue('queue_max', '  50  ');
	assert.strictEqual(result, 50, 'should handle whitespace in numeric strings');
});

test('convertConfigValue: handles case-insensitive "TRUE"', () => {
	const result = convertConfigValue('buffer', 'TRUE');
	assert.strictEqual(result, true, 'should handle uppercase TRUE');
});

// ===== loadConfig CLAMPING TESTS =====
test('loadConfig: clamps buffer_seconds and queue_max (below min)', () => {
	const originalEnv = process.env['pm2-discord'];
	process.env['pm2-discord'] = JSON.stringify({
		buffer_seconds: 0,   // below MIN_BUFFER_SECONDS (1)
		queue_max: 0         // below MIN_QUEUE_MAX (10)
	});

	const cfg = loadConfig(true);
	assert.strictEqual(cfg.buffer_seconds, 1, 'buffer_seconds should clamp to minimum 1');
	assert.strictEqual(cfg.queue_max, 10, 'queue_max should clamp to minimum 10');

	process.env['pm2-discord'] = originalEnv;
});

test('loadConfig: clamps buffer_seconds and queue_max (above max)', () => {
	const originalEnv = process.env['pm2-discord'];
	process.env['pm2-discord'] = JSON.stringify({
		buffer_seconds: 999, // above MAX_BUFFER_SECONDS (5)
		queue_max: 9999      // above MAX_QUEUE_MAX (100)
	});

	const cfg = loadConfig(true);
	assert.strictEqual(cfg.buffer_seconds, 5, 'buffer_seconds should clamp to maximum 5');
	assert.strictEqual(cfg.queue_max, 100, 'queue_max should clamp to maximum 100');

	process.env['pm2-discord'] = originalEnv;
});

// ===== getUserName TESTS =====
test('getUserName: returns single process name', () => {
	const messages = [{ name: 'api', description: 'log' }];
	const result = getUserName(messages);
	assert.strictEqual(result, 'api', 'should return single process name');
});

test('getUserName: joins multiple process names with comma', () => {
	const messages = [
		{ name: 'api', description: 'log' },
		{ name: 'worker', description: 'log' }
	];
	const result = getUserName(messages);
	assert.strictEqual(result, 'api, worker', 'should join multiple names with comma');
});

test('getUserName: removes duplicates', () => {
	const messages = [
		{ name: 'api', description: 'log' },
		{ name: 'api', description: 'log' }
	];
	const result = getUserName(messages);
	assert.strictEqual(result, 'api', 'should remove duplicate names');
});

test('getUserName: trims whitespace from names', () => {
	const messages = [{ name: '  api  ', description: 'log' }];
	const result = getUserName(messages);
	assert.strictEqual(result, 'api', 'should trim whitespace from names');
});

test('getUserName: filters out empty names', () => {
	const messages = [
		{ name: 'api', description: 'log' },
		{ name: '', description: 'log' }
	];
	const result = getUserName(messages);
	assert.strictEqual(result, 'api', 'should filter out empty names');
});

test('getUserName: returns default name when all names are empty', () => {
	const messages = [
		{ name: '', description: 'log' },
		{ name: '   ', description: 'log' }
	];
	const result = getUserName(messages);
	assert.strictEqual(result, 'PM2 Discord Bot', 'should return default name when all are empty');
});

test('getUserName: returns default name for empty array', () => {
	const messages = [];
	const result = getUserName(messages);
	assert.strictEqual(result, 'PM2 Discord Bot', 'should return default name for empty array');
});

test('getUserName: preserves order of unique names', () => {
	const messages = [
		{ name: 'worker', description: 'log' },
		{ name: 'api', description: 'log' },
		{ name: 'cache', description: 'log' }
	];
	const result = getUserName(messages);
	assert.strictEqual(result, 'worker, api, cache', 'should preserve order of first appearance');
});
