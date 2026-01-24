import test from "tape";
import { parseIncomingLog, parseProcessName, checkProcessName } from "../../dist/log-utils.mjs";

// ===== parseIncomingLog TESTS =====
test('parseIncomingLog: extracts timestamp from standard PM2 log format', async (t) => {
  const result = await parseIncomingLog('2026-01-23 10:30:45 +00:00: Server started');
  t.ok(result.timestamp > 0, 'timestamp should be extracted');
  t.equal(result.description, 'Server started', 'description should have date removed');
  t.end();
});

test('parseIncomingLog: handles log without timestamp', async (t) => {
  const result = await parseIncomingLog('Simple log message');
  t.ok(result.timestamp === null || result.timestamp === undefined, 'timestamp should be null');
  t.equal(result.description, 'Simple log message', 'description should be the whole message');
  t.end();
});

test('parseIncomingLog: should format as code block when requested', async (t) => {
  const result = await parseIncomingLog('Simple log message', true);
  t.ok(result.timestamp === null || result.timestamp === undefined, 'timestamp should be null');
  t.equal(result.description, '```Simple log message```', 'description should be formatted as code block');
  t.end();
});

test('parseIncomingLog: handles empty string', async (t) => {
  const result = await parseIncomingLog('');
  t.equal(result.description, '', 'should handle empty string');
  t.end();
});

test('parseIncomingLog: handles log with multiple colons in content', async (t) => {
  const result = await parseIncomingLog('2026-01-23 10:30:45 +00:00: Server error: Connection refused');
  t.ok(result.timestamp > 0, 'should still extract timestamp');
  t.equal(result.description, 'Server error: Connection refused', 'should preserve message content');
  t.end();
});

test('parseIncomingLog: handles non-string input', async (t) => {
  const result = await parseIncomingLog(null);
  t.equal(result.description, null, 'should return null for non-string input');
  t.end();
});

test('parseIncomingLog: handles timestamp with milliseconds', async (t) => {
  const result = await parseIncomingLog('2026-01-23 10:30:45.123 +00:00: Server started');
  t.ok(result.timestamp > 0, 'should extract timestamp with milliseconds');
  t.equal(result.description, 'Server started', 'should preserve message');
  t.end();
});

test('parseIncomingLog: handles negative timezone offset', async (t) => {
  const result = await parseIncomingLog('2026-01-23 10:30:45 -05:00: Server started');
  t.ok(result.timestamp > 0, 'should handle negative timezone offset');
  t.equal(result.description, 'Server started', 'should preserve message');
  t.end();
});

test('parseIncomingLog: strips ANSI color codes', async (t) => {
  const ansiRed = "\u001b[31m";
  const ansiReset = "\u001b[0m";
  const input = `2026-01-23 10:30:45 +00:00: ${ansiRed}Error occurred${ansiReset}`;
  const result = await parseIncomingLog(input);
  t.equal(result.description, 'Error occurred', 'should strip ANSI color codes from description');
  t.end();
});

// ===== parseProcessName TESTS =====
test('parseProcessName: returns simple name for fork mode', (t) => {
  const process = { name: 'api', exec_mode: 'fork_mode', instances: 1, pm_id: 0 };
  const result = parseProcessName(process);
  t.equal(result, 'api', 'should return name without suffix for fork mode');
  t.end();
});

test('parseProcessName: returns name with pm_id for cluster mode with multiple instances', (t) => {
  const process = { name: 'api', exec_mode: 'cluster_mode', instances: 4, pm_id: 2 };
  const result = parseProcessName(process);
  t.equal(result, 'api[2]', 'should append [pm_id] for cluster mode with multiple instances');
  t.end();
});

test('parseProcessName: returns simple name for cluster mode with single instance', (t) => {
  const process = { name: 'worker', exec_mode: 'cluster_mode', instances: 1, pm_id: 0 };
  const result = parseProcessName(process);
  t.equal(result, 'worker', 'should not append suffix when instances = 1');
  t.end();
});

test('parseProcessName: handles hyphenated process names', (t) => {
  const process = { name: 'my-api-service', exec_mode: 'fork_mode', instances: 1, pm_id: 0 };
  const result = parseProcessName(process);
  t.equal(result, 'my-api-service', 'should preserve hyphenated names');
  t.end();
});

test('parseProcessName: handles numeric process names', (t) => {
  const process = { name: '123', exec_mode: 'fork_mode', instances: 1, pm_id: 0 };
  const result = parseProcessName(process);
  t.equal(result, '123', 'should handle numeric names');
  t.end();
});

test('parseProcessName: cluster mode with pm_id 0', (t) => {
  const process = { name: 'app', exec_mode: 'cluster_mode', instances: 4, pm_id: 0 };
  const result = parseProcessName(process);
  t.equal(result, 'app[0]', 'should append [0] for first cluster instance');
  t.end();
});

// ===== checkProcessName TESTS =====
test('checkProcessName: filters out pm2-discord process', (t) => {
  const data = { process: { name: 'pm2-discord' } };
  const result = checkProcessName(data);
  t.equal(result, false, 'should filter out pm2-discord');
  t.end();
});

test('checkProcessName: returns true for other processes', (t) => {
  const data = { process: { name: 'api' } };
  const result = checkProcessName(data);
  t.equal(result, true, 'should return true for non-pm2-discord processes');
  t.end();
});

test('checkProcessName: null process name', (t) => {
  const data = { process: { name: null } };
  const result = checkProcessName(data);
  t.equal(result, true, 'should allow null process names');
  t.end();
});

test('checkProcessName: undefined process name', (t) => {
  const data = { process: { name: undefined } };
  const result = checkProcessName(data);
  t.equal(result, true, 'should allow undefined process names');
  t.end();
});

test('checkProcessName: empty string process name', (t) => {
  const data = { process: { name: '' } };
  const result = checkProcessName(data);
  t.equal(result, true, 'should allow empty string process names');
  t.end();
});
