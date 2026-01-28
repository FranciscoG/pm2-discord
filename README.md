# pm2-discord

This is a PM2 Module for sending events & logs from your PM2 processes to Discord.

## Requirements

You should have [pm2](https://www.npmjs.com/package/pm2) installed globally or locally. This has only been tested with versions `>=5.x.x`

Node `>=16.0.0` to match [pm2's min version of node](https://github.com/Unitech/pm2/blob/v6.0.14/package.json) for v6

## Install

To install and setup pm2-discord, run the following commands:

```sh
pm2 install pm2-discord
# set required discord_url
pm2 set pm2-discord:discord_url https://your_discord_webhook_url
```

#### `discord_url`
To get the Discord URL, you need to setup a Webhook. More details on how to set this up can be found here: https://support.discordapp.com/hc/en-us/articles/228383668-Intro-to-Webhooks

## Config

The following events can be subscribed to:

| event | description | default |
| ----- | ----------- | ------- |
| log | All standard out logs from your processes | `true` |
| error | All error logs from your processes | `false` |
| kill | Event fired when PM2 is killed | `true` |
| exception | Any exceptions from your processes | `true` |
| restart | Event fired when a process is restarted | `false` |
| delete | Event fired when a process is removed from PM2 | `false` |
| stop | Event fired when a process is stopped | `true` |
| "restart overlimit" | Event fired when a process reaches the max amount of times it can restart | `true` |
| exit | Event fired when a process is exited | `false` |
| start | Event fired when a process is started | `false` |
| online | Event fired when a process is online | `false` |

You can simply turn these on and off by setting them to `true` or `false` using the PM2 set command.

```sh
pm2 set pm2-discord:log true
pm2 set pm2-discord:error false
pm2 set pm2-discord:"restart overlimit" false
# etc
```

## Options

The following options are available:

| option | type | description | default |
| ----- | ----- | ----------- | ------- |
| process_name | `string` | When this is set, it will only output the logs of a specific named process | `null` |
| buffer | `bool` | Enable/Disable buffering of messages. See [Buffering](#buffering) section below for more info | `true` |
| buffer_seconds | `int` | If buffer is true, how many seconds to wait between messages. Min: `1`, Max: `5` | `1` |
| queue_max | `int` | Max amount of messages allowed in the queue before flushing the queue.  Min: `10`, Max: `100`  | `100` |
| rate_limit_messages | `int` | Number of messages allowed within the rate limit window (defaults to Discord webhook limit) | `30` |
| rate_limit_window_seconds | `int` | Time window in seconds for rate limiting (defaults to Discord webhook limit) | `60` |
| format | `boolean` | If enabled, it wraps the message in triple backticks to format as a [multi-line code block](https://support.discord.com/hc/en-us/articles/210298617-Markdown-Text-101-Chat-Formatting-Bold-Italic-Underline#h_01GY0DAKGXDEHE263BCAYEGFJA) | `false` |

Set these options in the same way you subscribe to events.

Example: The following configuration options will enable message buffering, and set the buffer duration to 2 seconds.  All messages that occur within 2 seconds of each other (for the same event) will be concatenated into a single discord message.

```sh
pm2 set pm2-discord:process_name myprocess
pm2 set pm2-discord:buffer true
pm2 set pm2-discord:buffer_seconds 2
pm2 set pm2-discord:queue_max 50
```

## Rate Limiting

This module automatically handles Discord's rate limits to prevent your webhook from being blocked. By default, it uses Discord's webhook rate limit of 30 requests per 60 seconds (0.5 requests/second).

**Key Features:**
- Automatic throttling to stay within Discord's limits
- Respects `429 Too Many Requests` responses and backs off automatically
- Handles both route-specific and global rate limits
- Detects invalid webhooks (404) and stops sending to prevent bans
- Messages are queued and sent at a controlled rate

**How it works:**
1. Messages are added to a queue when they arrive
2. The queue is processed at a rate that stays within Discord's limits (default: 30 per 60 seconds)
3. If Discord returns a 429 rate limit response, the module backs off for the specified `retry_after` period
4. Rate limit information from Discord's response headers is tracked and respected
5. If a webhook returns 404 (deleted/invalid), the module stops attempting to send messages to prevent repeated errors

**Custom Rate Limits:**
You can adjust the rate limits if needed (though the defaults are recommended):

```bash
pm2 set pm2-discord:rate_limit_messages 20
pm2 set pm2-discord:rate_limit_window_seconds 60
```

**Important:** The rate will never exceed Discord's webhook limit of 30 requests per 60 seconds, even if you configure higher values. This prevents your webhook from being rate-limited or banned.

Read more about Discord's rate limiting here:
- <https://support-dev.discord.com/hc/en-us/articles/6223003921559-My-Bot-is-Being-Rate-Limited>
- <https://discord.com/developers/docs/topics/rate-limits>

## Buffering

Enabling buffering allows you to reduce the amount of messages sent to Discord by waiting and concatenating messages into one. 

It works like this, lets say we have an empty queue and our first message comes in:
- start a timer with `buffer_seconds` seconds
- if a new message comes in and the `buffer_seconds` timer has not expired, cancel it, add message to queue, start a new `buffer_seconds` timer. Repeat this until one of three things happen:
  - If no new messages come and `buffer_seconds` timeout expires, flush the queue
  - if the length of the queue array reaches `queue_max`, flush the queue and cancel all timers
  - The combined message character length would exceed the 2000 character limit for discord webhook payloads
- then we wait for new message to come in and start the process all over again

"flush the queue" means that we concatenate all messages in the queue and send it to Discord as 1 single message, and then start a new empty queue.

## Contributing

In lieu of a formal style guide, take care to maintain the existing coding style. Add unit tests for any new or changed functionality. Lint and test your code.

In development you need Node >= 20 because this project uses Node's built in Test Runner.

## Acknowledgements

Forked from [mattpker/pm2-slack](https://github.com/mattpker/pm2-slack) and converted to use with Discord.
