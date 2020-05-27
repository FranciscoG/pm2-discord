import { MessageQueueConfig, DiscordMessage } from './types/index';
import Scheduler from './scheduler';
import sendToDiscord from './send-to-discord';

export default class MessageQueue {
  config: MessageQueueConfig
  messageQueue: DiscordMessage[] = []
  scheduler: Scheduler

  constructor(config: MessageQueueConfig) {
    this.config = config;
    this.messageQueue = [];
    this.scheduler = new Scheduler(config);
  }

  /**
   * Sends the message to Discord's Incoming Webhook.
   * If buffer is enabled, the message is added to queue and sending is postponed for couple of seconds.
   * 
   * @param {Message} message
   */
  addMessageToQueue(message: DiscordMessage) {
    const self = this;

    if (!this.config.buffer || !(this.config.buffer_seconds > 0)) {
      // No sending buffer defined. Send directly to Discord.
      sendToDiscord([message], self.config);
    } else {
      // Add message to buffer
      this.messageQueue.push(message);
      // Plan send the enqueued messages
      this.scheduler.schedule(function () {
        // Remove waiting messages from global queue
        const messagesToSend: DiscordMessage[] = self.messageQueue.splice(0, self.messageQueue.length);

        sendToDiscord(messagesToSend, self.config);
      });
    }

  }
}



