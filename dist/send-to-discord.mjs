import fetch from 'node-fetch';
/**
 * Parse rate limit headers from Discord API response
 */
function parseRateLimitHeaders(headers) {
    const limit = headers.get('x-ratelimit-limit');
    const remaining = headers.get('x-ratelimit-remaining');
    const reset = headers.get('x-ratelimit-reset');
    const resetAfter = headers.get('x-ratelimit-reset-after');
    return {
        limit: limit ? parseInt(limit, 10) : undefined,
        remaining: remaining ? parseInt(remaining, 10) : undefined,
        reset: reset ? parseInt(reset, 10) : undefined,
        resetAfter: resetAfter ? parseFloat(resetAfter) : undefined,
        bucket: headers.get('x-ratelimit-bucket') || undefined
    };
}
/**
 * Send messages to Discord's Incoming Webhook with rate limit handling
 */
export async function sendToDiscord(messages, config) {
    if (!messages || messages.length === 0) {
        return {
            success: true,
            rateLimitInfo: {}
        };
    }
    const { discord_url } = config;
    // If a Discord URL is not set, we do not want to continue and notify the user that it needs to be set
    if (!discord_url) {
        console.error("There is no Discord URL set, please set the Discord URL: 'pm2 set pm2-discord:discord_url https://[discord_url]'");
        return {
            success: false,
            error: "Discord URL not configured",
            rateLimitInfo: {}
        };
    }
    // The JSON payload to send to the Webhook
    const payload = {
        content: messages.reduce((acc, msg) => acc += msg.description + '\n', '')
    };
    // Options for the post request
    const options = {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' }
    };
    try {
        console.log('Sending to Discord at timestamp', new Date().toISOString());
        const res = await fetch(discord_url, options);
        console.log(`Discord webhook responded with status ${res.status}`);
        // Parse rate limit headers from response
        const rateLimitInfo = parseRateLimitHeaders(res.headers);
        // Handle 429 Too Many Requests
        if (res.status === 429) {
            let retryAfter;
            let isGlobal = false;
            // Try to get retry_after from response body
            try {
                const body = await res.json();
                retryAfter = body.retry_after || 0;
                isGlobal = body.global || false;
            }
            catch (e) {
                // If JSON parsing fails, use header
                retryAfter = res.headers.get('retry-after') ? parseFloat(res.headers.get('retry-after')) : 0;
            }
            // Check if it's a global rate limit from headers
            if (res.headers.get('x-ratelimit-global')) {
                isGlobal = true;
            }
            console.error(`Discord rate limit hit. ${isGlobal ? 'Global' : 'Route'} limit. Retry after ${retryAfter}s`);
            return {
                success: false,
                rateLimited: true,
                retryAfter,
                isGlobal,
                rateLimitInfo
            };
        }
        // A successful POST to Discord's webhook responds with a 204 NO CONTENT
        if (res.status === 204) {
            return {
                success: true,
                rateLimitInfo
            };
        }
        // Handle 404 - webhook no longer exists, stop trying to use it
        if (res.status === 404) {
            console.error(`Discord webhook returned 404 Not Found. Webhook is invalid and will not be retried.`);
            return {
                success: false,
                webhookInvalid: true,
                error: `HTTP ${res.status}: ${res.statusText}`,
                rateLimitInfo
            };
        }
        // Handle other error statuses
        console.error(`Discord webhook returned status ${res.status}: ${res.statusText}`);
        return {
            success: false,
            error: `HTTP ${res.status}: ${res.statusText}`,
            rateLimitInfo
        };
    }
    catch (error) {
        console.error('Error sending to Discord:', error.message);
        return {
            success: false,
            error: error.message,
            rateLimited: false,
            rateLimitInfo: {}
        };
    }
}
