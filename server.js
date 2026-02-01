require('dotenv').config();
const express = require('express');
const { App } = require('@slack/bolt');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Slack Bot Setup
const slackBot = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true, // Enable socket mode for easier development (no public URL needed)
  appToken: process.env.SLACK_APP_TOKEN,
});

// Store recent messages (in production, use Redis or MongoDB)
let conversationBuffer = [];
const MAX_BUFFER_SIZE = 20;
let messageCount = 0;
const MESSAGES_BEFORE_SUGGESTION = 15; // Generate suggestions every 15 messages

// Keywords that indicate post-worthy content
const TRIGGER_KEYWORDS = [
  'product', 'feature', 'user', 'customer', 'growth', 'revenue',
  'startup', 'building', 'learning', 'insight', 'problem', 'solution',
  'team', 'hire', 'scale', 'launch', 'ship', 'metric', 'data',
  'founder', 'business', 'strategy', 'idea', 'innovation'
];

// Usage statistics
let stats = {
  totalSuggestions: 0,
  totalMessages: 0,
  keywordMatches: 0,
  lastSuggestionTime: null
};

// Check if message contains important keywords
function containsRelevantKeywords(text) {
  if (!text) return false;
  const lowerText = text.toLowerCase();
  return TRIGGER_KEYWORDS.some(keyword => lowerText.includes(keyword));
}

// Listen to ALL messages (with detailed logging)
slackBot.event('message', async ({ event, say }) => {
  try {
    console.log('🔔 RAW MESSAGE EVENT RECEIVED!');
    console.log('Event type:', event.type);
    console.log('Event subtype:', event.subtype);
    console.log('Event channel:', event.channel);
    console.log('Event user:', event.user);
    console.log('Event text:', event.text);
    console.log('Full event:', JSON.stringify(event, null, 2));
    
    // Ignore bot messages and other subtypes
    if (event.subtype && event.subtype === 'bot_message') {
      console.log('🤖 Ignoring bot message');
      return;
    }
    
    if (event.subtype) {
      console.log(`⚠️ Ignoring message with subtype: ${event.subtype}`);
      return;
    }

    console.log(`📨 Message received: "${event.text?.substring(0, 50)}..."`);
    
    // Track stats
    stats.totalMessages++;
    
    // Check if message contains relevant keywords
    const hasKeywords = containsRelevantKeywords(event.text);
    if (hasKeywords) {
      console.log('🔑 Message contains relevant keywords!');
      stats.keywordMatches++;
    }
    
    // Store message in buffer
    conversationBuffer.push({
      text: event.text,
      user: event.user,
      timestamp: event.ts,
      hasKeywords: hasKeywords
    });

    // Keep buffer size manageable
    if (conversationBuffer.length > MAX_BUFFER_SIZE) {
      conversationBuffer.shift();
    }

    messageCount++;
    console.log(`📊 Message count: ${messageCount}/${MESSAGES_BEFORE_SUGGESTION} | Buffer size: ${conversationBuffer.length}`);

    // Generate suggestions every N messages
    if (messageCount >= MESSAGES_BEFORE_SUGGESTION) {
      console.log('🎯 Triggering post suggestions...');
      messageCount = 0;
      await generateAndPostSuggestions(say, event.channel);
    }

  } catch (error) {
    console.error('❌ Error handling message:', error);
  }
});

// Generate post suggestions using FREE Hugging Face API
async function generatePostSuggestions(conversationText) {
  try {
    // Using Hugging Face's FREE Inference API
    // Model: Meta-Llama-3-8B-Instruct (completely free, no rate limits for basic usage)
    const HF_API_URL = 'https://api-inference.huggingface.co/models/meta-llama/Meta-Llama-3-8B-Instruct';
    
    // Count messages with keywords
    const relevantMessages = conversationBuffer.filter(msg => msg.hasKeywords).length;
    const keywordContext = relevantMessages > 0 
      ? `\n(${relevantMessages} messages contain product/business keywords - focus on these!)`
      : '';
    
    const prompt = `You are a social media content strategist helping founders create authentic posts from their real conversations.

Context: This is a conversation between co-founders discussing their startup.${keywordContext}

Conversation:
${conversationText}

Create engaging social media posts based on the MOST INTERESTING insights from this conversation:

1. **LinkedIn Post 1** (150-250 words):
   - Professional tone, share a learning or insight
   - Start with a hook
   - Add personal experience
   - End with a question to engage readers

2. **LinkedIn Post 2** (150-250 words):
   - Different angle from Post 1
   - Could be more tactical/how-to focused
   - Include specific details or numbers if mentioned

3. **X Post 1** (under 250 characters):
   - Punchy, quotable insight
   - Can use emojis strategically
   - Should work standalone

4. **X Post 2** (under 250 characters):
   - Different topic from X Post 1
   - Could be contrarian or thought-provoking
   - Conversational tone

Format EXACTLY like this:
LINKEDIN POST 1:
[post content]

LINKEDIN POST 2:
[post content]

X POST 1:
[post content]

X POST 2:
[post content]`;

    const response = await axios.post(
      HF_API_URL,
      {
        inputs: prompt,
        parameters: {
          max_new_tokens: 1000,
          temperature: 0.8,
          top_p: 0.95,
          return_full_text: false
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data[0].generated_text;
  } catch (error) {
    console.error('Error generating suggestions:', error.response?.data || error.message);
    
    // Fallback: Generate basic suggestions without AI
    return `📝 **Post Suggestions Based on Recent Conversation**

**LINKEDIN POST 1:**
Just had an interesting discussion about ${conversationText.substring(0, 50)}... The key insight: [extract manually]. What's your experience with this?

**LINKEDIN POST 2:**
Reflecting on our product conversations today. One thing that stood out: [your insight here]. How do you approach similar challenges?

**X POST 1:**
Quick thought from today's discussion: ${conversationText.substring(0, 100)}... 🧵

**X POST 2:**
Building in public: ${conversationText.substring(0, 150)}...

_Note: AI service temporarily unavailable. These are template suggestions._`;
  }
}

// Post suggestions to Slack
async function generateAndPostSuggestions(say, channel) {
  try {
    console.log('🔄 Starting suggestion generation...');
    
    // Combine recent messages into conversation text
    const conversationText = conversationBuffer
      .map(msg => msg.text)
      .filter(text => text) // Remove undefined/null
      .join('\n');

    console.log(`📝 Conversation length: ${conversationText.length} characters`);
    console.log(`📝 Conversation preview: ${conversationText.substring(0, 200)}...`);

    // Lower threshold - just need ANY conversation
    if (conversationText.length < 10) {
      console.log('⚠️ Not enough conversation to generate suggestions (need at least 10 chars)');
      await say('⚠️ Not enough conversation history yet. Send a few more messages first!');
      return;
    }

    console.log('🤖 Calling Hugging Face API...');
    
    // Track suggestion generation
    stats.totalSuggestions++;
    stats.lastSuggestionTime = new Date().toISOString();
    
    // Generate suggestions
    const suggestions = await generatePostSuggestions(conversationText);

    console.log('✅ Suggestions generated, posting to Slack...');

    // Post to Slack
    await say({
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '💡 Post Suggestions Ready!',
            emoji: true
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `Based on your recent conversation, here are some post ideas:\n\n${suggestions}`
          }
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '_Review and edit before posting. These are just suggestions!_ 📝'
            }
          ]
        }
      ]
    });

    console.log('✅ Posted suggestions to Slack');
  } catch (error) {
    console.error('❌ Error posting suggestions:', error);
    console.error('❌ Error details:', error.response?.data || error.message);
  }
}

// Manual trigger command
slackBot.command('/suggest-posts', async ({ command, ack, respond }) => {
  try {
    await ack();
    console.log('🎯 Manual trigger: /suggest-posts command received');
    
    // Use respond instead of say for slash commands
    await respond({
      response_type: 'in_channel',
      text: '🔄 Generating post suggestions...'
    });
    
    // Generate suggestions
    const conversationText = conversationBuffer
      .map(msg => msg.text)
      .filter(text => text) // Remove undefined/null
      .join('\n');
    
    console.log(`📝 Buffer size: ${conversationBuffer.length} messages`);
    console.log(`📝 Total text: ${conversationText.length} characters`);
    
    if (conversationText.length < 10) {
      await respond({
        response_type: 'in_channel',
        text: `⚠️ Not enough conversation history yet. Buffer has ${conversationBuffer.length} messages with ${conversationText.length} characters. Send a few more messages first!`
      });
      return;
    }
    
    const suggestions = await generatePostSuggestions(conversationText);
    
    await respond({
      response_type: 'in_channel',
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '💡 Post Suggestions Ready!',
            emoji: true
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `Based on your recent conversation, here are some post ideas:\n\n${suggestions}`
          }
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '_Review and edit before posting. These are just suggestions!_ 📝'
            }
          ]
        }
      ]
    });
    
    console.log('✅ Slash command completed successfully');
  } catch (error) {
    console.error('❌ Error handling slash command:', error);
    await respond({
      response_type: 'ephemeral',
      text: `❌ Error: ${error.message}`
    });
  }
});

// Also allow triggering with a simple message
slackBot.message('suggest posts', async ({ message, say }) => {
  console.log('🎯 Manual trigger: "suggest posts" message received');
  await generateAndPostSuggestions(say, message.channel);
});

// Stats command
slackBot.message('bot stats', async ({ say }) => {
  const keywordPercent = stats.totalMessages > 0 
    ? ((stats.keywordMatches / stats.totalMessages) * 100).toFixed(1)
    : 0;
  
  await say({
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '📊 Bot Statistics',
          emoji: true
        }
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Total Messages:*\n${stats.totalMessages}`
          },
          {
            type: 'mrkdwn',
            text: `*Suggestions Generated:*\n${stats.totalSuggestions}`
          },
          {
            type: 'mrkdwn',
            text: `*Keyword Matches:*\n${stats.keywordMatches} (${keywordPercent}%)`
          },
          {
            type: 'mrkdwn',
            text: `*Buffer Size:*\n${conversationBuffer.length}/${MAX_BUFFER_SIZE}`
          },
          {
            type: 'mrkdwn',
            text: `*Last Suggestion:*\n${stats.lastSuggestionTime || 'Never'}`
          },
          {
            type: 'mrkdwn',
            text: `*Next in:*\n${MESSAGES_BEFORE_SUGGESTION - messageCount} messages`
          }
        ]
      }
    ]
  });
});

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'running',
    message: 'Slack Post Suggester Bot is active!',
    stats: {
      totalMessages: stats.totalMessages,
      totalSuggestions: stats.totalSuggestions,
      keywordMatches: stats.keywordMatches,
      bufferSize: conversationBuffer.length,
      messagesUntilNext: MESSAGES_BEFORE_SUGGESTION - messageCount,
      lastSuggestion: stats.lastSuggestionTime
    }
  });
});

// Start the Slack bot
(async () => {
  await slackBot.start();
  console.log('⚡️ Slack bot is running!');
})();

// Start Express server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});