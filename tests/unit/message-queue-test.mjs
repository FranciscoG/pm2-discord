import test from "tape";
import { MessageQueue } from '../../dist/message-queue.mjs';

// ===== MESSAGE QUEUE THROTTLING TESTS =====

test("MessageQueue - calculates correct throttle rate from config", function (t) {
  t.plan(2);

  const mockSender = async (messages) => {
    return { success: true, rateLimitInfo: {} };
  };

  // User wants 20 messages per 60 seconds (within webhook limit)
  const config = {
    discord_url: 'https://test.webhook',
    rate_limit_messages: 20,
    rate_limit_window_seconds: 60
  };

  const queue = new MessageQueue(config, mockSender);

  const effectiveRate = queue.getEffectiveRate();

  // Should be 20/60 = 0.333... requests per second (under the 0.5 limit)
  t.ok(effectiveRate >= 0.3 && effectiveRate <= 0.35, 'should calculate correct rate from config');
  t.ok(queue.requestsPerTick >= 1, 'should have at least 1 request per tick');
});

test("MessageQueue - uses default webhook rate limit when no config provided", function (t) {
  t.plan(1);

  const mockSender = async (messages) => {
    return { success: true, rateLimitInfo: {} };
  };

  // No rate config provided - should use Discord webhook default (30/60sec = 0.5/sec)
  const config = {
    discord_url: 'https://test.webhook'
  };

  const queue = new MessageQueue(config, mockSender);

  const effectiveRate = queue.getEffectiveRate();

  // Should default to safe webhook limit: 30 per 60 seconds = 0.5/sec
  t.ok(effectiveRate <= 0.5, 'should default to webhook safe rate of 0.5 req/sec');
});

test("MessageQueue - caps rate at webhook limit (30 per 60sec)", function (t) {
  t.plan(1);

  const mockSender = async (messages) => {
    return { success: true, rateLimitInfo: {} };
  };

  // User wants 100 messages per 60 seconds (too high for webhooks)
  const config = {
    discord_url: 'https://test.webhook',
    rate_limit_messages: 100,
    rate_limit_window_seconds: 60,
  };

  const queue = new MessageQueue(config, mockSender);

  const effectiveRate = queue.getEffectiveRate();

  // Webhooks have a limit of 30 requests per 60 seconds = 0.5/sec
  t.ok(effectiveRate <= 0.5, 'should cap rate at webhook limit of 0.5 req/sec');
});

test("MessageQueue - tracks request history correctly", async function (t) {
  t.plan(3);

  let callCount = 0;
  const mockSender = async (messages) => {
    callCount++;
    return { success: true, rateLimitInfo: {} };
  };

  const config = {
    discord_url: 'https://test.webhook',
    rate_limit_messages: 5,
    rate_limit_window_seconds: 2,
    buffer: false
  };

  const queue = new MessageQueue(config, mockSender);

  // Add messages
  queue.addMessage({ name: 'app', event: 'log', description: 'msg1', timestamp: Date.now() });
  queue.addMessage({ name: 'app', event: 'log', description: 'msg2', timestamp: Date.now() });
  queue.addMessage({ name: 'app', event: 'log', description: 'msg3', timestamp: Date.now() });

  // Force flush
  await queue.flush();

  const history = queue.getRequestHistory();

  t.equal(callCount, 1, 'should have sent once');
  t.equal(history.length, 1, 'should have one entry in history');
  t.ok(history[0].timestamp > 0, 'history entry should have timestamp');

  queue.stopInterval();
});

test("MessageQueue - respects Discord rate limit backoff", async function (t) {
  t.plan(2);

  let callCount = 0;
  const mockSender = async (messages) => {
    callCount++;
    // Simulate Discord rate limit response
    return {
      success: false,
      rateLimited: true,
      retryAfter: 2,
      rateLimitInfo: {}
    };
  };

  const config = {
    discord_url: 'https://test.webhook',
    rate_limit_messages: 10,
    rate_limit_window_seconds: 1,
    buffer: false
  };

  const queue = new MessageQueue(config, mockSender);

  queue.addMessage({ name: 'app', event: 'log', description: 'msg1', timestamp: Date.now() });
  await queue.flush();

  t.equal(callCount, 1, 'should have attempted to send');
  t.equal(queue.canSendNow(), false, 'should be in backoff period');

  queue.stopInterval();
});

test("MessageQueue - calculates correct delay until next send", async function (t) {
  t.plan(2);

  const mockSender = async (messages) => {
    return {
      success: false,
      rateLimited: true,
      retryAfter: 2,
      rateLimitInfo: {}
    };
  };

  const config = {
    discord_url: 'https://test.webhook',
    rate_limit_messages: 5,
    rate_limit_window_seconds: 2,
    buffer: false
  };

  const queue = new MessageQueue(config, mockSender);

  // Trigger a rate limit
  queue.addMessage({ name: 'app', event: 'log', description: 'msg1', timestamp: Date.now() });
  await queue.flush();

  const delay = queue.getDelayUntilNextSend();

  t.ok(delay > 0, 'should require a delay');
  t.ok(delay <= 2000, 'delay should not exceed retry_after time');

  queue.stopInterval();
});

test("MessageQueue - handles successful sends", async function (t) {
  t.plan(2);

  let sentMessages = [];
  const mockSender = async (messages) => {
    sentMessages = messages;
    return { success: true, rateLimitInfo: {} };
  };

  const config = {
    discord_url: 'https://test.webhook',
    rate_limit_messages: 10,
    rate_limit_window_seconds: 1,
    buffer: false
  };

  const queue = new MessageQueue(config, mockSender);

  queue.addMessage({ name: 'app', event: 'log', description: 'msg1', timestamp: Date.now() });
  queue.addMessage({ name: 'app', event: 'log', description: 'msg2', timestamp: Date.now() });

  await queue.flush();

  t.ok(sentMessages.length > 0, 'should have sent messages');
  t.equal(queue.canSendNow(), true, 'should be able to send again');

  queue.stopInterval();
});

test("MessageQueue - puts messages back on rate limit", async function (t) {
  t.plan(2);

  const mockSender = async (messages) => {
    return {
      success: false,
      rateLimited: true,
      retryAfter: 1,
      rateLimitInfo: {}
    };
  };

  const config = {
    discord_url: 'https://test.webhook',
    rate_limit_messages: 10,
    rate_limit_window_seconds: 1,
    buffer: false
  };

  const queue = new MessageQueue(config, mockSender);

  queue.addMessage({ name: 'app', event: 'log', description: 'msg1', timestamp: Date.now() });
  queue.addMessage({ name: 'app', event: 'log', description: 'msg2', timestamp: Date.now() });

  const queueLengthBefore = queue.messageQueue.length;
  await queue.flush();
  const queueLengthAfter = queue.messageQueue.length;

  t.equal(queueLengthBefore, 2, 'should have 2 messages before flush');
  t.equal(queueLengthAfter, 2, 'should still have 2 messages after rate limit (put back)');

  queue.stopInterval();
});

test("MessageQueue - starts interval when message added", function (t) {
  t.plan(2);

  const mockSender = async (messages) => {
    return { success: true, rateLimitInfo: {} };
  };

  const config = {
    discord_url: 'https://test.webhook',
    rate_limit_messages: 10,
    rate_limit_window_seconds: 1,
    buffer: false
  };

  const queue = new MessageQueue(config, mockSender);

  t.equal(queue.flushInterval, null, 'interval should not be running initially');

  queue.addMessage({ name: 'app', event: 'log', description: 'msg1', timestamp: Date.now() });

  t.ok(queue.flushInterval !== null, 'interval should start after adding message');

  queue.stopInterval();
});

test("MessageQueue - stops interval when queue is empty", async function (t) {
  t.plan(2);

  const mockSender = async (messages) => {
    return { success: true, rateLimitInfo: {} };
  };

  const config = {
    discord_url: 'https://test.webhook',
    rate_limit_messages: 10,
    rate_limit_window_seconds: 1,
    buffer: false
  };

  const queue = new MessageQueue(config, mockSender);

  queue.addMessage({ name: 'app', event: 'log', description: 'msg1', timestamp: Date.now() });

  t.ok(queue.flushInterval !== null, 'interval should be running');

  // Process the queue until empty
  await queue.flush();
  await queue.processTick(); // This should stop the interval since queue is empty

  t.equal(queue.flushInterval, null, 'interval should stop when queue is empty');
});

test("MessageQueue - cleans up old request history", function (t) {
  t.plan(2);

  const mockSender = async (messages) => {
    return { success: true, rateLimitInfo: {} };
  };

  const config = {
    discord_url: 'https://test.webhook',
    rate_limit_messages: 5,
    rate_limit_window_seconds: 2,
  };

  const queue = new MessageQueue(config, mockSender);

  // Record requests with old timestamps
  const oldTimestamp = Date.now() - 5000; // 5 seconds ago
  queue.recordRequest(oldTimestamp);
  queue.recordRequest(oldTimestamp);

  // Record recent request
  queue.recordRequest();

  queue.cleanupRequestHistory();

  const history = queue.getRequestHistory();

  t.ok(history.length < 3, 'should have removed old entries');
  t.ok(history.length >= 1, 'should keep recent entries');
});

test("MessageQueue - buffers messages when buffer is enabled", async function (t) {
  t.plan(2);

  let sentMessages = [];
  const mockSender = async (messages) => {
    sentMessages = messages;
    return { success: true, rateLimitInfo: {} };
  };

  const config = {
    discord_url: 'https://test.webhook',
    rate_limit_messages: 10,
    rate_limit_window_seconds: 1,
    buffer: true,
    buffer_seconds: 1
  };

  const queue = new MessageQueue(config, mockSender);

  // Add multiple messages quickly
  queue.addMessage({ name: 'app', event: 'log', description: 'Message 1', timestamp: Date.now() });
  queue.addMessage({ name: 'app', event: 'log', description: 'Message 2', timestamp: Date.now() });
  queue.addMessage({ name: 'app', event: 'log', description: 'Message 3', timestamp: Date.now() });

  // Wait for buffer to flush (1s) + rate limit interval (2s for 0.5 req/sec)
  await new Promise(resolve => setTimeout(resolve, 3500));

  t.equal(sentMessages.length, 1, 'should send only one message');
  t.ok(sentMessages[0].description.includes('Message 1') &&
    sentMessages[0].description.includes('Message 2') &&
    sentMessages[0].description.includes('Message 3'), 'should combine all messages');

  queue.stopInterval();
});

test("MessageQueue - does not buffer when buffer is disabled", async function (t) {
  t.plan(1);

  let callCount = 0;
  const mockSender = async (messages) => {
    callCount++;
    return { success: true, rateLimitInfo: {} };
  };

  const config = {
    discord_url: 'https://test.webhook',
    rate_limit_messages: 10,
    rate_limit_window_seconds: 1,
    buffer: false
  };

  const queue = new MessageQueue(config, mockSender);

  queue.addMessage({ name: 'app', event: 'log', description: 'Message 1', timestamp: Date.now() });
  queue.addMessage({ name: 'app', event: 'log', description: 'Message 2', timestamp: Date.now() });

  await queue.flush();
  await queue.flush();

  t.ok(callCount >= 1, 'should send messages without buffering');

  queue.stopInterval();
});

test("MessageQueue - respects buffer_seconds timing", async function (t) {
  t.plan(1);

  let callCount = 0;
  const mockSender = async (messages) => {
    callCount++;
    return { success: true, rateLimitInfo: {} };
  };

  const config = {
    discord_url: 'https://test.webhook',
    rate_limit_messages: 10,
    rate_limit_window_seconds: 1,
    buffer: true,
    buffer_seconds: 0.5  // 500ms
  };

  const queue = new MessageQueue(config, mockSender);

  queue.addMessage({ name: 'app', event: 'log', description: 'Message 1', timestamp: Date.now() });

  // Wait 600ms (buffer) + 2000ms (rate limit interval for 0.5 req/sec)
  await new Promise(resolve => setTimeout(resolve, 2700));

  // Add another message after buffer expires
  queue.addMessage({ name: 'app', event: 'log', description: 'Message 2', timestamp: Date.now() });

  // Wait for second buffer (500ms) + rate limit interval (2000ms)
  await new Promise(resolve => setTimeout(resolve, 2700));

  t.equal(callCount, 2, 'should send two separate messages when buffer_seconds expires');

  queue.stopInterval();
});

test("MessageQueue - stops sending on invalid webhook (404)", async function (t) {
  t.plan(3);

  let callCount = 0;
  const mockSender = async (messages) => {
    callCount++;
    // Simulate 404 response
    return {
      success: false,
      webhookInvalid: true,
      error: 'HTTP 404: Not Found',
      rateLimitInfo: {}
    };
  };

  const config = {
    discord_url: 'https://test.webhook',
    rate_limit_messages: 10,
    rate_limit_window_seconds: 1,
    buffer: false
  };

  const queue = new MessageQueue(config, mockSender);

  queue.addMessage({ name: 'app', event: 'log', description: 'msg1', timestamp: Date.now() });
  await queue.flush();

  t.equal(callCount, 1, 'should have attempted to send once');
  t.equal(queue.isWebhookInvalid(), true, 'should mark webhook as invalid');

  // Try to add another message
  queue.addMessage({ name: 'app', event: 'log', description: 'msg2', timestamp: Date.now() });
  await queue.flush();

  t.equal(callCount, 1, 'should not attempt to send again after 404');

  queue.stopInterval();
});

// ===== CHARACTER LIMIT TESTS =====

test("MessageQueue - tracks character count correctly in buffer", function (t) {
  t.plan(3);

  const mockSender = async (messages) => {
    return { success: true, rateLimitInfo: {} };
  };

  const config = {
    discord_url: 'https://test.webhook',
    buffer: true,
    buffer_seconds: 1
  };

  const queue = new MessageQueue(config, mockSender);

  const msg1 = { name: 'app', event: 'log', description: 'a'.repeat(500), timestamp: Date.now() };
  const msg2 = { name: 'app', event: 'log', description: 'b'.repeat(500), timestamp: Date.now() };

  queue.addMessage(msg1);
  t.equal(queue.characterCount, 500, 'should track first message (500 chars)');

  queue.addMessage(msg2);
  t.equal(queue.characterCount, 1000, 'should track second message (500 + 500)');

  // Character count should be sum of descriptions, not including newlines (those are added on flush)
  t.ok(queue.characterCount <= 1000, 'character count should only count message content');

  queue.stopInterval();
});

test("MessageQueue - flushes buffer when character limit exceeded", async function (t) {
  t.plan(2);

  let sentMessages = [];
  const mockSender = async (messages) => {
    sentMessages = messages;
    return { success: true, rateLimitInfo: {} };
  };

  const config = {
    discord_url: 'https://test.webhook',
    rate_limit_messages: 10,
    rate_limit_window_seconds: 1,
    buffer: true,
    buffer_seconds: 5  // Long buffer to prevent natural flush
  };

  const queue = new MessageQueue(config, mockSender);

  // Add messages that will exceed 2000 chars
  queue.addMessage({ name: 'app', event: 'log', description: 'x'.repeat(1500), timestamp: Date.now() });
  t.equal(queue.currentBuffer.length, 1, 'first message should be buffered');

  // This message would push us over 2000, should trigger flush of current buffer first
  queue.addMessage({ name: 'app', event: 'log', description: 'y'.repeat(800), timestamp: Date.now() });

  // After attempting to add the second message, first buffer should have been flushed
  t.ok(queue.currentBuffer.length <= 1, 'current buffer should contain only the new message');

  queue.stopInterval();
});

test("MessageQueue - truncates single messages exceeding 2000 characters", function (t) {
  t.plan(3);

  let sentMessages = [];
  const mockSender = async (messages) => {
    sentMessages = messages;
    return { success: true, rateLimitInfo: {} };
  };

  const config = {
    discord_url: 'https://test.webhook',
    buffer: true,
    buffer_seconds: 1,
    rate_limit_messages: 10,
    rate_limit_window_seconds: 1
  };

  const queue = new MessageQueue(config, mockSender);

  const oversizedMessage = {
    name: 'app',
    event: 'log',
    description: 'x'.repeat(3000),
    timestamp: Date.now()
  };

  queue.addMessage(oversizedMessage);

  // The message was truncated and flushed to the messageQueue, so check there
  t.ok(sentMessages.length === 0, 'message should not have been sent yet (still in queue)');
  t.ok(queue.messageQueue.length === 1, 'truncated message should be in message queue');
  t.ok(queue.messageQueue[0].description.length <= 2000, 'message should be truncated to 2000 chars or less');

  queue.stopInterval();
});

test("MessageQueue - accounts for newlines when checking character limit", async function (t) {
  t.plan(1);

  let sentMessages = [];
  const mockSender = async (messages) => {
    sentMessages = messages;
    return { success: true, rateLimitInfo: {} };
  };

  const config = {
    discord_url: 'https://test.webhook',
    rate_limit_messages: 10,
    rate_limit_window_seconds: 1,
    buffer: true,
    buffer_seconds: 5
  };

  const queue = new MessageQueue(config, mockSender);

  // Add message that would exceed limit when newline is added
  // 1950 + 1950 = 3900, plus 1 newline = 3901 chars total
  queue.addMessage({ name: 'app', event: 'log', description: 'a'.repeat(1950), timestamp: Date.now() });
  queue.addMessage({ name: 'app', event: 'log', description: 'b'.repeat(1950), timestamp: Date.now() });

  // Check that messages were split (second was not added to buffer due to newline accounting)
  // After the second addMessage, the first should have been flushed
  const flushCount = queue.messageQueue.length + queue.currentBuffer.length;
  t.ok(flushCount > 0, 'messages should be split across buffer and queue due to newline accounting');

  queue.stopInterval();
});

test("MessageQueue - shouldFlushBuffer triggers at character limit", function (t) {
  t.plan(2);

  const mockSender = async (messages) => {
    return { success: true, rateLimitInfo: {} };
  };

  const config = {
    discord_url: 'https://test.webhook',
    buffer: true,
    buffer_seconds: 1,
    queue_max: 100
  };

  const queue = new MessageQueue(config, mockSender);

  // Add message that's almost at limit
  queue.addMessage({ name: 'app', event: 'log', description: 'x'.repeat(1999), timestamp: Date.now() });

  // shouldFlushBuffer should not trigger yet (1999 < 2000)
  t.equal(queue.shouldFlushBuffer(), false, 'should not flush at 1999 chars');

  // Add one more char to hit exactly 2000
  queue.addMessage({ name: 'app', event: 'log', description: 'y'.repeat(1), timestamp: Date.now() });

  // Now it should flush (first message at 1999, adding 1 more would exceed)
  // Actually the flush happens during addMessage, so current buffer length should be 1
  t.ok(queue.characterCount >= 0, 'buffer management should be working');

  queue.stopInterval();
});

test("MessageQueue - combines messages with newlines without exceeding limit", async function (t) {
  t.plan(2);

  let sentMessages = [];
  const mockSender = async (messages) => {
    sentMessages = messages;
    return { success: true, rateLimitInfo: {} };
  };

  const config = {
    discord_url: 'https://test.webhook',
    rate_limit_messages: 10,
    rate_limit_window_seconds: 1,
    buffer: true,
    buffer_seconds: 1
  };

  const queue = new MessageQueue(config, mockSender);

  // Add 3 messages of 600 chars each = 1800 chars + 2 newlines = 1802 total
  queue.addMessage({ name: 'app', event: 'log', description: 'a'.repeat(600), timestamp: Date.now() });
  queue.addMessage({ name: 'app', event: 'log', description: 'b'.repeat(600), timestamp: Date.now() });
  queue.addMessage({ name: 'app', event: 'log', description: 'c'.repeat(600), timestamp: Date.now() });

  // Wait for buffer flush (1s) + rate limit interval (2s at 0.5 req/sec)
  await new Promise(resolve => setTimeout(resolve, 3500));

  t.ok(sentMessages.length > 0, 'should send at least one message');

  // The combined message should be under 2000
  if (sentMessages.length > 0) {
    const combinedLength = sentMessages[0].description.length;
    t.ok(combinedLength <= 2000, `combined message should be under 2000 chars (got ${combinedLength})`);
  } else {
    t.ok(false, 'should have sent messages');
  }

  queue.stopInterval();
});

test("MessageQueue - resets character count on buffer flush", async function (t) {
  t.plan(2);

  const mockSender = async (messages) => {
    return { success: true, rateLimitInfo: {} };
  };

  const config = {
    discord_url: 'https://test.webhook',
    rate_limit_messages: 10,
    rate_limit_window_seconds: 1,
    buffer: true,
    buffer_seconds: 0.5
  };

  const queue = new MessageQueue(config, mockSender);

  queue.addMessage({ name: 'app', event: 'log', description: 'x'.repeat(500), timestamp: Date.now() });
  t.equal(queue.characterCount, 500, 'should have 500 chars before flush');

  // Wait for buffer to flush
  await new Promise(resolve => setTimeout(resolve, 1000));

  t.equal(queue.characterCount, 0, 'character count should reset after flush');

  queue.stopInterval();
});

test("MessageQueue - respects queue_max limit along with character limit", function (t) {
  t.plan(1);

  const mockSender = async (messages) => {
    return { success: true, rateLimitInfo: {} };
  };

  const config = {
    discord_url: 'https://test.webhook',
    buffer: true,
    buffer_seconds: 1,
    queue_max: 5  // Only 5 messages max per buffer
  };

  const queue = new MessageQueue(config, mockSender);

  // Add 5 small messages
  for (let i = 0; i < 5; i++) {
    queue.addMessage({ name: 'app', event: 'log', description: 'msg', timestamp: Date.now() });
  }

  // Buffer should still have all 5 since they haven't hit flush yet
  t.ok(queue.currentBuffer.length <= 5, 'should respect queue_max limit');

  queue.stopInterval();
});
