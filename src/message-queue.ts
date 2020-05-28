import { MessageQueueConfig, DiscordMessage, SendToDiscord } from './types/index';
import Scheduler from './scheduler' // just to import class type

export default class MessageQueue {
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

  /**
   * Sends the message to Discord's Webhook.
   * If buffer is enabled, the message is added to queue and sending is postponed for couple of seconds.
   * 
   * @param {Message} message
   */
  addMessageToQueue(message: DiscordMessage) {
    if (!this.config.buffer || !(this.config.buffer_seconds > 0)) {
      // No sending buffer defined. Send directly to Discord.
      this.sender([message], this.config);
    } else {
      // Add message to buffer
      this.messageQueue.push(message);
      // Plan send the enqueued messages
      this.scheduler.schedule( () => {
        // Remove waiting messages from global queue
        const messagesToSend: DiscordMessage[] = this.messageQueue.splice(0, this.messageQueue.length);

        this.sender(messagesToSend, this.config);
      });
    }

  }
}



