require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { WebClient } = require('@slack/web-api');
const { createEventAdapter } = require('@slack/events-api');
const cron = require('node-cron');
const { generatePostSuggestions } = require('./services/claudeService');
const { conversationBuffer } = require('./utils/messageBuffer');

const app = express();
const slackEvents = createEventAdapter(process.env.SLACK_SIGNING_SECRET);
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

const PORT = process.env.PORT || 3000;
const CHANNEL_ID = process.env.SLACK_CHANNEL_ID;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Mount Slack events at /slack/events
app.use('/slack/events', slackEvents.expressMiddleware());

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'running',
    bufferSize: conversationBuffer.getMessages().length,
    lastCheck: conversationBuffer.getLastCheckTime()
  });
});

// Manual trigger endpoint for testing
app.post('/trigger-suggestions', async (req, res) => {
  try {
    const messages = conversationBuffer.getMessages();
    
    if (messages.length === 0) {
      return res.json({ message: 'No messages in buffer yet' });
    }

    const suggestions = await generatePostSuggestions(messages);
    
    await slackClient.chat.postMessage({
      channel: CHANNEL_ID,
      text: '📝 *Content Suggestions*',
      blocks: formatSuggestionsMessage(suggestions)
    });

    conversationBuffer.clear();
    
    res.json({ 
      success: true, 
      messagesProcessed: messages.length,
      suggestions 
    });
  } catch (error) {
    console.error('Error triggering suggestions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Listen to messages in your channel
slackEvents.on('message', async (event) => {
  try {
    // Only process messages from your specific channel
    if (event.channel !== CHANNEL_ID) return;
    
    // Ignore bot messages and message edits
    if (event.subtype || event.bot_id) return;
    
    // Add message to buffer
    conversationBuffer.addMessage({
      text: event.text,
      user: event.user,
      timestamp: event.ts
    });

    console.log(`Message buffered. Total: ${conversationBuffer.getMessages().length}`);
    
    // Check if we should generate suggestions
    const shouldGenerate = conversationBuffer.shouldGenerateSuggestions();
    
    if (shouldGenerate) {
      await processSuggestions();
    }
    
  } catch (error) {
    console.error('Error handling message:', error);
  }
});

// Handle Slack API errors
slackEvents.on('error', (error) => {
  console.error('Slack events error:', error);
});

// Process and send suggestions
async function processSuggestions() {
  try {
    const messages = conversationBuffer.getMessages();
    
    if (messages.length === 0) {
      console.log('No messages to process');
      return;
    }

    console.log(`Generating suggestions from ${messages.length} messages...`);
    
    const suggestions = await generatePostSuggestions(messages);
    
    // Post suggestions to Slack
    await slackClient.chat.postMessage({
      channel: CHANNEL_ID,
      text: '📝 *Content Suggestions*',
      blocks: formatSuggestionsMessage(suggestions)
    });

    // Clear the buffer after processing
    conversationBuffer.clear();
    
    console.log('Suggestions posted successfully');
    
  } catch (error) {
    console.error('Error processing suggestions:', error);
  }
}

// Format suggestions into Slack blocks
function formatSuggestionsMessage(suggestions) {
  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '📝 Content Suggestions from Your Conversation',
        emoji: true
      }
    },
    {
      type: 'divider'
    }
  ];

  // Add LinkedIn suggestions
  if (suggestions.linkedin && suggestions.linkedin.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*LinkedIn Posts:*'
      }
    });

    suggestions.linkedin.forEach((post, index) => {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${index + 1}.* ${post}`
        }
      });
      blocks.push({ type: 'divider' });
    });
  }

  // Add X (Twitter) suggestions
  if (suggestions.twitter && suggestions.twitter.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*X (Twitter) Posts:*'
      }
    });

    suggestions.twitter.forEach((post, index) => {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${index + 1}.* ${post}`
        }
      });
      blocks.push({ type: 'divider' });
    });
  }

  blocks.push({
    type: 'context',
    elements: [{
      type: 'mrkdwn',
      text: '_Review and edit before posting. These are just suggestions based on your conversation._'
    }]
  });

  return blocks;
}

// Scheduled check every few hours (configurable)
const checkIntervalHours = process.env.CHECK_INTERVAL_HOURS || 4;
const cronSchedule = `0 */${checkIntervalHours} * * *`; // Every X hours

cron.schedule(cronSchedule, async () => {
  console.log('Running scheduled suggestion check...');
  
  const messages = conversationBuffer.getMessages();
  const minMessages = parseInt(process.env.MIN_MESSAGES_FOR_SUGGESTION || '15');
  
  if (messages.length >= minMessages) {
    await processSuggestions();
  } else {
    console.log(`Not enough messages yet (${messages.length}/${minMessages})`);
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Slack Content Suggester running on port ${PORT}`);
  console.log(`📊 Monitoring channel: ${CHANNEL_ID}`);
  console.log(`⏰ Scheduled checks: Every ${checkIntervalHours} hours`);
  console.log(`📝 Minimum messages for suggestion: ${process.env.MIN_MESSAGES_FOR_SUGGESTION || 15}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});