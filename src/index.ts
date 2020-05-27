const pm2 = require('pm2');
const pmx = require('pmx');
// import sendToDiscord from './send-to-discord';
import MessageQueue from './message-queue';
import { LogMessage, Process, DiscordMessage, MessageQueueConfig } from './types/index';
import { SubEmitterSocket } from 'axon';

// Get the configuration from PM2
const moduleConfig = pmx.initModule();

function getConfig(processName: string, item: string) {
  return  moduleConfig[`${item}-${processName}`] || moduleConfig[item];
}

const msgRouter = {
  /**
   * Keys are Discord Urls, values are instances of MessageQueue
   *
   * @typedef {Object.<string, MessageQueue>}
   */
  messageQueues: {},


  /**
   * Add the message to appropriate message queue (each Discord URL has own independent message enqueing).
   *
   * @param {Message} message
   */
  addMessage: function (message: DiscordMessage): void {
    const processName = message.name;
    const discordUrl = getConfig(processName, 'discord_url')

    if (!discordUrl) {
      return;
      // No discord URL defined for this process and no global discord URL exists.
    }

    if (!this.messageQueues[discordUrl]) {
      // Init new messageQueue to different discord URL.
      const config: MessageQueueConfig = {
        buffer: getConfig(processName, 'buffer'),
        discord_url: discordUrl,
        buffer_seconds: getConfig(processName, 'buffer_seconds'),
        buffer_max_seconds: getConfig(processName, 'buffer_max_seconds'),
        queue_max: getConfig(processName, 'queue_max')
      }

      this.messageQueues[discordUrl] = new MessageQueue(config);
    }

    this.messageQueues[discordUrl].addMessageToQueue(message);

  }
};

/**
 * New PM2 is storing log messages with date in format "YYYY-MM-DD hh:mm:ss +-zz:zz"
 * Parses this date from begin of message
 */
function parseIncommingLog(logMessage: string): LogMessage {
  let description = null;
  let timestamp = null;

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
      // Use message without date
      description = logMessage.replace(parsedDescription[0], "");
    } else {
      // Use whole original message
      description = logMessage;
    }
  }

  return {
    description: description,
    timestamp: timestamp
  }
}

/**
 * Get pm2 app display name.
 * If the app is running in cluster mode, id will append [pm_id] as the suffix.
 */
function parseProcessName(process: Process) {
  return process.name + (
    process.exec_mode === 'cluster_mode' &&
      process.instances > 1 ? `[${process.pm_id}]` : ''
  );
}


// Start listening on the PM2 BUS
pm2.launchBus(function (err: Error, bus: SubEmitterSocket) {

  // Listen for process logs
  if (moduleConfig.log) {
    bus.on('log:out', function (data) {
      if (data.process.name === 'pm2-discord') { return; } // Ignore messages of own module.

      const parsedLog = parseIncommingLog(data.data);
      msgRouter.addMessage({
        name: parseProcessName(data.process),
        event: 'log',
        description: parsedLog.description,
        timestamp: parsedLog.timestamp,
      });
    });
  }

  // Listen for process errors
  if (moduleConfig.error) {
    bus.on('log:err', function (data) {
      if (data.process.name === 'pm2-discord') { return; } // Ignore messages of own module.

      const parsedLog = parseIncommingLog(data.data);
      msgRouter.addMessage({
        name: parseProcessName(data.process),
        event: 'error',
        description: parsedLog.description,
        timestamp: parsedLog.timestamp,
      });
    });
  }

  // Listen for PM2 kill
  if (moduleConfig.kill) {
    bus.on('pm2:kill', function (data) {
      msgRouter.addMessage({
        name: 'PM2',
        event: 'kill',
        description: data.msg,
        timestamp: Math.floor(Date.now() / 1000),
      });
    });
  }

  // Listen for process exceptions
  if (moduleConfig.exception) {
    bus.on('process:exception', function (data) {
      if (data.process.name === 'pm2-discord') { return; } // Ignore messages of own module.

      // If it is instance of Error, use it. If type is unknown, stringify it.
      const description = (data.data && data.data.message) ? (data.data.code || '') + data.data.message : JSON.stringify(data.data);
      msgRouter.addMessage({
        name: parseProcessName(data.process),
        event: 'exception',
        description: description,
        timestamp: Math.floor(Date.now() / 1000),
      });
    });
  }

  // Listen for PM2 events
  bus.on('process:event', function (data) {
    if (!moduleConfig[data.event]) { return; } // This event type is disabled by configuration.
    if (data.process.name === 'pm2-discord') { return; } // Ignore messages of own module.

    let description = null;
    switch (data.event) {
      case 'start':
      case 'stop':
      case 'restart':
        description = null;
        break;

      case 'restart overlimit':
        description = 'Process has been stopped. Check and fix the issue.';
        break;

    }
    msgRouter.addMessage({
      name: parseProcessName(data.process),
      event: data.event,
      description: description,
      timestamp: Math.floor(Date.now() / 1000),
    });
  });
});
