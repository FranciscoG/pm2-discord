# pm2-discord

This is a PM2 Module for sending events & logs from your PM2 processes to Discord.

## Install

To install and setup pm2-discord, run the following commands:

```
pm2 install pm2-discord
pm2 set pm2-discord:discord_url https://discord_url
```

#### `discord_url`
To get the Discord URL, you need to setup a Webhook. More details on how to set this up can be found here: https://support.discordapp.com/hc/en-us/articles/228383668-Intro-to-Webhooks

## Configure

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
| restart overlimit | Event fired when a process reaches the max amount of times it can restart | `true` |
| exit | Event fired when a process is exited | `false` |
| start | Event fired when a process is started | `false` |
| online | Event fired when a process is online | `false` |

You can simply turn these on and off by setting them to true or false using the PM2 set command.

```
pm2 set pm2-discord:log true
pm2 set pm2-discord:error false
...
```

## Options

The following options are available:

| option | type | description | default |
| ----- | ----- | ----------- | ------- |
| process_name | `string` | When this is set, it will only output the logs of a specific named process | `null` |
| buffer | `bool` | Enable/Disable buffering of messages. See [Buffering](#buffering) section below for more info | `true` |
| buffer_seconds | `int` | If buffer is true, how many seconds to wait between messages | `1` |
| buffer_max_seconds | `int` | If buffer is true, max amount of seconds to wait before flushing buffer | `20` |
| queue_max | `int` | Max amount of messages allowed in the queue before flushing the queue | `100` |

Set these options in the same way you subscribe to events.

Example: The following configuration options will enable message buffering, and set the buffer duration to 2 seconds.  All messages that occur within 2 seconds of each other (for the same event) will be concatenated into a single discord message.

```
pm2 set pm2-discord:process_name myprocess
pm2 set pm2-discord:buffer true
pm2 set pm2-discord:buffer_seconds 2
pm2 set pm2-discord:queue_max 50
```

## Buffering

Enabling buffering allows you to reduce the amount of messages sent to Discord by waiting and concatenating messages into one. 

It works like this, lets say we have an empty queue and our first message comes in:
- start a timer with `buffer_seconds` seconds
- start another timer wiith `buffer_max_seconds` seconds
- if a new message comes in and the `buffer_seconds` timer has not expired, cancel it, add message to queue, start a new `buffer_seconds` timer. Repeat this until one of three things happen:
  - If no new messages come and `buffer_seconds` timeout expires, flush the queue, cancel the `buffer_max_seconds` timer
  - if the `buffer_max_seconds` timeout expires, its callback will flush the queue and cancel the `buffer_seconds` timer
  - if the length of the queue array reaches `queue_max`, flush the queue and cancel all timers
- then we wait for new message to come in and start the process all over again

"flush the queue" means that we concatenate all messages in the queue and send it to Discord, and then start a new empty queue.

## Contributing

In lieu of a formal styleguide, take care to maintain the existing coding style. Add unit tests for any new or changed functionality. Lint and test your code.

## Acknowledgements

Forked from [mattpker/pm2-slack](https://github.com/mattpker/pm2-slack) and converted to use with Discord. Thanks for the doing all the heavy lifting Matt!
