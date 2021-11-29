import type { MessageQueueConfig, DiscordMessage, SendToDiscord } from './types/index';
import Scheduler from './scheduler' // just to import class type

class MessageQueue {
  config: MessageQueueConfig
  messageQueue: DiscordMessage[] = []
  scheduler: Scheduler
  sender: SendToDiscord

  constructor(config: MessageQueueConfig, scheduler: Scheduler, sender: SendToDiscord) {
    this.config = config;
    this.messageQueue = [];
    this.scheduler = scheduler;
    this.sender = sender
  }

  flushQueue() {
    // Remove waiting messages from global queue and send them to Discord
    const messagesToSend: DiscordMessage[] = this.messageQueue.splice(0, this.messageQueue.length);
    this.sender(messagesToSend, this.config);
  }

  /**
   * Sends the message to Discord's Webhook.
   * If buffer is enabled, the message is added to queue and sending is postponed
   * 
   * @param {Message} message
   */
  addMessageToQueue(message: DiscordMessage) {
    if (!this.config.buffer || this.config.buffer_seconds < 1) {
      // Buffering disabled, send directly to Discord.
      this.sender([message], this.config);
      return;
    }

    this.messageQueue.push(message);

    if (this.messageQueue.length >= this.config.queue_max) {
      this.scheduler.clear();
      this.flushQueue();
      return;
    }

    // Schedule queued messages to be sent
    this.scheduler.schedule(this.flushQueue.bind(this));
  }
}

export default MessageQueue;



