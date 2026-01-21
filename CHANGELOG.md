# Changelog

## 1.0.0
### 2026-??-??

### Breaking Changes

- Set the minimum Node engine to `>=16.0.0` to match [pm2's v6](https://github.com/Unitech/pm2/blob/v6.0.14/package.json). In pm2 v5 is was Node 12.

### Features

- **Rate Limiting Compliance**: Fully implemented Discord's webhook rate limiting (30 requests per 60 seconds)
  - Automatic throttling to stay within Discord's limits
  - Respects `429 Too Many Requests` responses with automatic backoff
  - Handles both route-specific and global rate limits
  - Parses and uses all Discord rate limit headers (`X-RateLimit-*`)
  - Configurable rate limits via `rate_limit_messages` and `rate_limit_window_seconds`
  
- **Invalid Webhook Detection**: Prevents repeated 404 errors
  - Detects when webhooks are deleted or invalid (404 responses)
  - Automatically stops sending to invalid webhooks
  - Prevents Cloudflare bans from repeated invalid requests

- **Message Buffering** (preserved from original): Groups messages within time windows
  - Enabled by default: `buffer: true`, `buffer_seconds: 1`
  - Messages arriving within `buffer_seconds` are combined into single Discord messages
  - Reduces notification spam for busy logs
  - Works seamlessly with rate limiting: Buffer → Queue → Rate-limited Send

### Internal Changes

- Complete rewrite using TypeScript
- Added comprehensive test suite (58 tests covering rate limiting, buffering, and error handling)
- Modular architecture: MessageQueue handles buffering and rate limiting, sendToDiscord handles API communication
- Added comprehensive unit tests for all rate limiting scenarios
- Separated concerns: message queue management, Discord API interaction
- Added proper error handling for network failures and Discord API errors

## 0.1.2
### 2020-05-04

Update readme with more accurate instructions

## 0.1.1
### 2020-05-04

- Updated dependencies
- Added Changlelog.md

## 0.1.0
### 2017-02-01

Initial release after forking the code from `pm2-discord` and converting it to work with Discord