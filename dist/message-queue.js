"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class MessageQueue {
    constructor(config, scheduler, sender) {
        this.messageQueue = [];
        this.config = config;
        this.messageQueue = [];
        this.scheduler = scheduler;
        this.sender = sender;
    }
    flushQueue() {
        // Remove waiting messages from global queue and send them to Discord
        const messagesToSend = this.messageQueue.splice(0, this.messageQueue.length);
        this.sender(messagesToSend, this.config);
    }
    /**
     * Sends the message to Discord's Webhook.
     * If buffer is enabled, the message is added to queue and sending is postponed
     *
     * @param {Message} message
     */
    addMessageToQueue(message) {
        if (!this.config.buffer || this.config.buffer_seconds < 1) {
            // No sending buffer defined. Send directly to Discord.
            this.sender([message], this.config);
            return;
        }
        this.messageQueue.push(message);
        if (this.messageQueue.length >= this.config.queue_max) {
            this.scheduler.clear();
            this.flushQueue();
            return;
        }
        // Plan send the enqueued messages
        this.scheduler.schedule(this.flushQueue.bind(this));
    }
}
exports.default = MessageQueue;
