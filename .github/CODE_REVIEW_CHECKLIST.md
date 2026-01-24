ultrathink.

You're an expert node, typescript, and javascript developer whose main mission in life is to write the highest quality and cleanest code ever, following the best practices set by the industry. 

Review the code in this project and make sure it is written cleanly and legibly. I want a future developer to open this project and go "wow this is amazing code".

Make sure that there are no bugs or unforeseen edge cases I missed. Also review it for security.

You have already identified some issues and have addressed some of them already. Below is the checklist of issues you've already identified and their statuses. 

# Code Review Issues & Improvements

This document tracks all issues identified during the comprehensive code quality review conducted on January 22-23, 2026.

## 🎯 Critical Issues

### ✅ 1. Security: Missing Request Timeout in fetch()
**Status:** FIXED  
**File:** `src/send-to-discord.mts`

Added 5-second timeout using `AbortController` to prevent process hang if Discord is unresponsive.

### ✅ 2. Potential Message Loss During Shutdown
**Status:** FIXED  
**Files:** `src/message-handler.mts`, `src/message-queue.mts`

Added `isShuttingDown` flag and `beginShutdown()` method to prevent race conditions during graceful shutdown.

### ✅ 3. Bug: Character Count Not Accounting for Newlines Correctly
**Status:** FIXED  
**File:** `src/message-queue.mts`

Fixed character count calculation to properly account for all newlines when combining buffered messages.

### ✅ 4. Incomplete Type Safety in Config Parsing
**Status:** FIXED  
**File:** `src/config.mts`

Removed `as any` casts and implemented proper type conversion with `convertConfigValue()` helper function.

---

## ⚠️ Important Edge Cases

### ✅ 5. Race Condition: Shutdown Signal While Sending
**Status:** FIXED  
**File:** `src/message-queue.mts`

Added checks in `startInterval()` and `processTick()` to prevent new intervals during shutdown.

### ✅ 6. Message Duplication Risk with Rate Limit Backoff
**Status:** FIXED  
**Files:** `src/message-queue.mts`, `src/types/index.d.ts`

Added `_retryAttempts` tracking with `MAX_RETRY_ATTEMPTS = 5` to prevent infinite retry loops.

### ✅ 7. Potential Memory Leak: RequestHistory Never Capped
**Status:** FIXED  
**File:** `src/message-queue.mts`

Added call to `cleanupRequestHistory()` in `processTick()` to prevent unbounded array growth.

### ✅ 8. Missing Error Handling for Invalid Environment
**Status:** FIXED  
**File:** `src/index.mts`

Changed PM2 bus error handling to call `gracefulShutdown()` instead of `process.exit()`.

---

## 🛡️ Security Recommendations

### ✅ 9. Input Validation on Discord URL (SSRF Prevention)
**Status:** FIXED  
**File:** `src/message-handler.mts`

Added `isValidDiscordWebhookUrl()` function to validate URLs are HTTPS and from Discord domains.

### ✅ 10. User-Agent Header
**Status:** FIXED  
**File:** `src/send-to-discord.mts`

Added User-Agent header with dynamic version from package.json: `pm2-discord/X.Y.Z`

---

## ✨ Code Clarity & Style Issues

### ✅ 11. Missing JSDoc Comments
**Status:** FIXED  
**Files:** `src/index.mts`, `src/send-to-discord.mts`, `src/message-queue.mts`

Added comprehensive JSDoc comments to all major functions:
- `parseIncomingLog()` - Explains PM2 log parsing and timestamp extraction
- `parseProcessName()` - Documents cluster mode naming with examples
- `checkProcessName()` - Explains filtering logic with examples
- `getUserName()` - Documents batching and fallback behavior
- MessageQueue methods - Added detailed docs with examples for all public methods

All JSDoc comments include parameter descriptions, return values, and usage examples.

### ✅ 12. Inconsistent Error Messages
**Status:** FIXED  
**Files:** `src/send-to-discord.mts`, `src/message-queue.mts`

Standardized all console output with consistent `pm2-discord:` prefix:
- Fixed 7 messages in `send-to-discord.mts` (version loading, URL validation, rate limits, errors)
- Fixed 3 messages in `message-queue.mts` (webhook invalid, rate limit, send errors)
- All console.log/warn/error statements now use the prefix for easy identification in logs

**Before:**
```typescript
console.error('There is no Discord URL set in the configuration.');
console.error('Error sending to Discord:', error);
```

**After:**
```typescript
console.error('pm2-discord: Discord URL is not configured.');
console.error('pm2-discord: Error sending to Discord:', error);
```

### ✅ 13. Magic Numbers
**Status:** FIXED  
**Files:** `src/message-queue.mts`, `src/message-handler.mts`, `src/config.mts`

Extracted hardcoded values into named constants for improved maintainability:

**In `src/message-queue.mts`:**
- `DISCORD_MESSAGE_CHAR_LIMIT = 2000` - Discord message character limit

**In `src/message-handler.mts`:**
- `SHUTDOWN_TIMEOUT_MS = 5000` - Max time to wait before force shutdown
- `MAX_SHUTDOWN_ATTEMPTS = 50` - Max iterations to drain message queue
- `SHUTDOWN_RETRY_DELAY_MS = 50` - Delay between queue processing attempts

**In `src/config.mts`:**
- `MIN_BUFFER_SECONDS = 1` - Minimum buffer time
- `MAX_BUFFER_SECONDS = 5` - Maximum buffer time
- `MIN_QUEUE_MAX = 10` - Minimum queue size
- `MAX_QUEUE_MAX = 100` - Maximum queue size

These constants are now defined at the top of each file with clear comments explaining their purpose and make future changes easier to manage globally.

### ✅ 14. Comment Accuracy
**Status:** FIXED  
**File:** `src/config.mts`

Fixed incomplete comment in config file. Need to review all comments for accuracy.

### ✅ 15. Rate Limiting Explanation
**Status:** FIXED  
**File:** `src/message-queue.mts`

Added detailed step-by-step comments explaining the rate limiting calculation in the constructor:
- **Step 1:** Extract user's rate limit configuration (or use Discord defaults)
- **Step 2:** Convert to requests per second for uniform calculation
- **Step 3:** Enforce Discord's hard limit (30 requests per 60 seconds = 0.5 req/sec)
- **Step 4:** Calculate optimal tick interval and requests per tick based on rate

The explanation includes concrete examples:
- Low rate scenario: 0.5 req/sec = 1 request every 2 seconds (2000ms interval)
- High rate scenario: 2 req/sec with 100ms tick = 0.2 requests per tick

This makes the math transparent and easier for future developers to understand and modify.

---

## 📋 Testing Gaps

### ✅ 16. Missing Unit Tests
**Status:** FIXED  

Added comprehensive unit tests for:
- `parseIncomingLog()` edge cases: empty string, multiple colons, milliseconds, negative timezone, non-string input, and ANSI color stripping; optional code-block formatting
- `parseProcessName()` cluster vs fork modes, hyphenated and numeric names, pm_id suffix behavior
- `checkProcessName()` filtering of `pm2-discord`, and null/undefined/empty names handling
- Config clamping via `loadConfig()`: clamps `buffer_seconds` (min 1, max 5) and `queue_max` (min 10, max 100)
- URL validation edge cases: HTTPS only, Discord domains only, path required, malformed and non-string inputs; test-mode localhost allowed
- `getUserName()` batching: joining names, duplicate removal, trimming, empty-name filtering, default fallback, order preservation

### ⏳ 17. No Error Simulation Tests
**Status:** PENDING  

Need tests for:
- Network timeouts
- Malformed JSON responses from Discord
- Partial message sends
- Race conditions during shutdown

---

## Summary

**Total Issues:** 17  
**Fixed:** 16 ✅  
**Pending:** 1 ⏳  

**Priority Next Steps:**
1. Add comprehensive unit tests for edge cases
2. Add integration tests for error scenarios
3. Final code review and validation

---

*Last Updated: January 23, 2026*
