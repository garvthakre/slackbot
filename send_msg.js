const { WebClient } = require('@slack/web-api');
require('dotenv').config();

const token = process.env.SLACK_BOT_TOKEN;
const channel = process.env.SLACK_CHANNEL_ID;

const client = new WebClient(token);

async function sendDummyMessages(count = 15) {
  for (let i = 1; i <= count; i++) {
    await client.chat.postMessage({
      channel,
      text: `Dummy message ${i} 🚀`
    });
    console.log(`Sent message ${i}`);
  }
  console.log(`✅ Sent ${count} dummy messages`);
}

sendDummyMessages().catch(console.error);
