import { DiscordMessage } from './types/index';
import { RequestResponse } from 'request';
const request = require('request');

// Function to send event to Discord's Incoming Webhook
export default function sendToDiscord(discord_url: string, message?: DiscordMessage) : void {
  if (!message) return;

  var description = message.description;

  // If a Discord URL is not set, we do not want to continue and nofify the user that it needs to be set
  if (!discord_url) {
    return console.error("There is no Discord URL set, please set the Discord URL: 'pm2 set pm2-discord:discord_url https://[discord_url]'");
  }

  // The JSON payload to send to the Webhook
  var payload = {
    "content" : description
  };

  // Options for the post request
  var options = {
    method: 'post',
    body: payload,
    json: true,
    url: discord_url
  };

  // Finally, make the post request to the Discord Incoming Webhook
  request(options, function(err: Error, res: RequestResponse) {
    if (err) {
      return console.error(err);
    }
    /* A successful POST to Discord's webhook responds with a 204 NO CONTENT */
    if (res.statusCode !== 204) {
      console.error("Error occured during the request to the Discord webhook");
    }
  });
}