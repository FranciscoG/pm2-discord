"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const scheduler_1 = __importDefault(require("./scheduler"));
const send_to_discord_1 = __importDefault(require("./send-to-discord"));
class MessageQueue {
    constructor(config) {
        this.messageQueue = [];
        this.config = config;
        this.messageQueue = [];
        this.scheduler = new scheduler_1.default(config);
    }
    /**
     * Sends the message to Discord's Incoming Webhook.
     * If buffer is enabled, the message is added to queue and sending is postponed for couple of seconds.
     *
     * @param {Message} message
     */
    addMessageToQueue(message) {
        const self = this;
        if (!this.config.buffer || !(this.config.buffer_seconds > 0)) {
            // No sending buffer defined. Send directly to Discord.
            send_to_discord_1.default([message], self.config);
        }
        else {
            // Add message to buffer
            this.messageQueue.push(message);
            // Plan send the enqueued messages
            this.scheduler.schedule(function () {
                // Remove waiting messages from global queue
                const messagesToSend = self.messageQueue.splice(0, self.messageQueue.length);
                send_to_discord_1.default(messagesToSend, self.config);
            });
        }
    }
}
exports.default = MessageQueue;
