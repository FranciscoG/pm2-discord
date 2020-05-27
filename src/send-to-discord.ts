import { DiscordMessage, MessageQueueConfig } from './types/index';
const fetch = require('node-fetch');

// Function to send event to Discord's Incoming Webhook
export default function sendToDiscord(messages: DiscordMessage[], config: MessageQueueConfig): void {
  if (!messages) return;

  const { discord_url, queue_max } = config;

  // If a Discord URL is not set, we do not want to continue and nofify the user that it needs to be set
  if (!discord_url) {
    return console.error("There is no Discord URL set, please set the Discord URL: 'pm2 set pm2-discord:discord_url https://[discord_url]'");
  }

  let limitedCountOfMessages;
  if (queue_max > 0) {
    // Limit count of messages for sending
    limitedCountOfMessages = messages.splice(0, Math.min(queue_max, messages.length));
  } else {
    // Select all messages for sending
    limitedCountOfMessages = messages;
  }

  // The JSON payload to send to the Webhook
  var payload = {
    "content": limitedCountOfMessages.reduce((acc, msg) => acc += msg.description , '')
  };

  // Options for the post request
  var options = {
    method: 'post',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' }
  };

  // Finally, make the post request to the Discord Incoming Webhook
  fetch(discord_url, options)
    .then((res: Response) => {
      /* A successful POST to Discord's webhook responds with a 204 NO CONTENT */
      if (res.status !== 204) {
        throw new Error("Error occured during the request to the Discord webhook");
      }
    })
    .catch(console.error)
}