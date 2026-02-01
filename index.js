require('dotenv').config();
const express = require('express');
const { App, ExpressReceiver } = require('@slack/bolt');
const Anthropic = require('@anthropic-ai/sdk');

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Create Express receiver for Slack
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

// Create Slack app
const slackApp = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

// In-memory storage for conversation buffer
// In production, use Redis or a database
const conversationBuffer = [];
const MAX_BUFFER_SIZE = 30;
const SUGGESTION_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours in milliseconds
let lastSuggestionTime = Date.now();

// Listen to messages in channels where the bot is added
slackApp.message(async ({ message, client }) => {
  try {
    // Only process regular messages (not bot messages or system messages)
    if (message.subtype || message.bot_id) {
      return;
    }

    // Add message to buffer
    conversationBuffer.push({
      text: message.text,
      user: message.user,
      timestamp: message.ts,
      channel: message.channel,
    });

    // Keep buffer size manageable
    if (conversationBuffer.length > MAX_BUFFER_SIZE) {
      conversationBuffer.shift();
    }

    console.log(`📝 Message added to buffer. Total messages: ${conversationBuffer.length}`);

    // Check if we should generate suggestions
    const timeSinceLastSuggestion = Date.now() - lastSuggestionTime;
    const hasEnoughMessages = conversationBuffer.length >= 15;
    const enoughTimePassed = timeSinceLastSuggestion >= SUGGESTION_INTERVAL;

    if (hasEnoughMessages && enoughTimePassed) {
      await generateAndSendSuggestions(message.channel, client);
      lastSuggestionTime = Date.now();
    }
  } catch (error) {
    console.error('Error processing message:', error);
  }
});

// Manual trigger command: /suggest-posts
slackApp.command('/suggest-posts', async ({ command, ack, client }) => {
  await ack();

  if (conversationBuffer.length < 5) {
    await client.chat.postMessage({
      channel: command.channel_id,
      text: '⚠️ Not enough conversation data yet. Keep chatting and I\'ll suggest posts soon!',
    });
    return;
  }

  await generateAndSendSuggestions(command.channel_id, client);
});

// Function to generate post suggestions using Claude
async function generateAndSendSuggestions(channel, client) {
  try {
    await client.chat.postMessage({
      channel: channel,
      text: '🤖 Analyzing recent conversations for post ideas...',
    });

    // Prepare conversation context for Claude
    const conversationText = conversationBuffer
      .map((msg, idx) => `[${idx + 1}] ${msg.text}`)
      .join('\n');

    const prompt = `You are a social media content strategist. Analyze the following conversation between co-founders and suggest authentic social media posts.

Conversation snippets:
${conversationText}

Based on these conversations, suggest:
1. Two LinkedIn posts (professional, insightful, thought leadership)
2. Two X/Twitter posts (concise, engaging, conversational)

Guidelines:
- Make posts feel authentic and conversational
- Extract actual insights or interesting moments from the conversation
- For LinkedIn: 150-250 words, professional but personal
- For X: Under 280 characters, punchy and engaging
- Include relevant hashtags where appropriate
- Don't fabricate information - only use what's in the conversation

Format your response as:

**LinkedIn Post 1:**
[post content]

**LinkedIn Post 2:**
[post content]

**X Post 1:**
[post content]

**X Post 2:**
[post content]

For each post, add a brief note about which part of the conversation inspired it.`;

    // Call Claude API
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const suggestions = message.content[0].text;

    // Send suggestions to Slack
    await client.chat.postMessage({
      channel: channel,
      text: `📝 *Post Suggestions Based on Your Recent Conversations*\n\n${suggestions}\n\n_Review these and post manually if you like them!_`,
    });

    console.log('✅ Suggestions sent successfully');
  } catch (error) {
    console.error('Error generating suggestions:', error);
    await client.chat.postMessage({
      channel: channel,
      text: '❌ Sorry, I encountered an error generating suggestions. Please try again later.',
    });
  }
}

// Health check endpoint
receiver.router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    bufferSize: conversationBuffer.length,
    lastSuggestion: new Date(lastSuggestionTime).toISOString(),
  });
});

// Clear buffer endpoint (for testing)
receiver.router.post('/clear-buffer', (req, res) => {
  const previousSize = conversationBuffer.length;
  conversationBuffer.length = 0;
  lastSuggestionTime = Date.now();
  res.json({
    message: 'Buffer cleared',
    previousSize,
    currentSize: conversationBuffer.length,
  });
});

// Start the server
const PORT = process.env.PORT || 3000;

(async () => {
  await slackApp.start(PORT);
  console.log(`⚡️ Slack Post Suggestion Bot is running on port ${PORT}`);
  console.log(`📊 Health check available at http://localhost:${PORT}/health`);
})();