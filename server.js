require('dotenv').config();
const express = require('express');
const { App } = require('@slack/bolt');
const { handleMessage, getStats, clearCache } = require('./src/handlers/messageHandler');
const { findSimilarPosts } = require('./src/services/postFinder');
const { generatePostSuggestions } = require('./src/services/postGenerator');

const app = express();
const PORT = process.env.PORT || 3000;

// Slack Bot Setup
const slackBot = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

// ============================================
// MESSAGE EVENTS
// ============================================

slackBot.event('message', async ({ event, say }) => {
  await handleMessage(event, say, slackBot);
});

// ============================================
// COMMANDS - FIND SIMILAR POSTS
// ============================================

slackBot.command('/find-posts', async ({ command, ack, say }) => {
  await ack();
  await say('🔍 Searching for similar posts...');
  await findSimilarPosts(say, command.channel_id);
});

slackBot.message(/^(find posts|similar posts|show similar)/i, async ({ message, say }) => {
  await findSimilarPosts(say, message.channel);
});

// ============================================
// COMMANDS - GENERATE POST SUGGESTIONS
// ============================================

slackBot.command('/suggest-posts', async ({ command, ack, say }) => {
  await ack();
  await say('✨ Generating post suggestions...');
  await generatePostSuggestions(say, command.channel_id);
});

slackBot.message(/^(suggest posts|generate posts|create posts)/i, async ({ message, say }) => {
  await generatePostSuggestions(say, message.channel);
});

// ============================================
// COMMANDS - GET POSTS (SHOWS BOTH OPTIONS)
// ============================================

slackBot.command('/getposts', async ({ command, ack, say }) => {
  await ack();
  await say({
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🤖 What would you like?',
          emoji: true
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Choose what you want me to do with your conversation:'
        }
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '🔍 Find Similar Posts', emoji: true },
            action_id: 'find_similar',
            style: 'primary'
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '✨ Generate Post Ideas', emoji: true },
            action_id: 'generate_suggestions',
            style: 'primary'
          }
        ]
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '💡 *Find Similar* searches existing posts | *Generate* creates new post drafts'
          }
        ]
      }
    ]
  });
});

slackBot.message('getposts', async ({ message, say }) => {
  await say({
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🤖 What would you like?',
          emoji: true
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Choose what you want me to do:'
        }
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '🔍 Find Similar Posts', emoji: true },
            action_id: 'find_similar',
            style: 'primary'
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '✨ Generate Post Ideas', emoji: true },
            action_id: 'generate_suggestions',
            style: 'primary'
          }
        ]
      }
    ]
  });
});

// ============================================
// INTERACTIVE ACTIONS
// ============================================

slackBot.action('find_similar', async ({ ack, body, say }) => {
  await ack();
  await findSimilarPosts(say, body.channel.id);
});

slackBot.action('generate_suggestions', async ({ ack, body, say }) => {
  await ack();
  await generatePostSuggestions(say, body.channel.id);
});

slackBot.action('view_stats', async ({ ack, say }) => {
  await ack();
  const stats = getStats();
  await say({
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '📊 Bot Statistics', emoji: true }
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Messages:* ${stats.totalMessages}` },
          { type: 'mrkdwn', text: `*Similar Posts:* ${stats.similarPostSearches}` },
          { type: 'mrkdwn', text: `*Suggestions:* ${stats.postSuggestionsGenerated}` },
          { type: 'mrkdwn', text: `*Cache Hits:* ${stats.cacheHits}` }
        ]
      }
    ]
  });
});

// ============================================
// UTILITY COMMANDS
// ============================================

slackBot.message('bot stats', async ({ say }) => {
  const stats = getStats();
  await say({
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '📊 Bot Statistics', emoji: true }
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Messages:* ${stats.totalMessages}` },
          { type: 'mrkdwn', text: `*Similar Posts:* ${stats.similarPostSearches}` },
          { type: 'mrkdwn', text: `*Suggestions:* ${stats.postSuggestionsGenerated}` },
          { type: 'mrkdwn', text: `*Cache Hits:* ${stats.cacheHits}` }
        ]
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '🔍 Find Similar', emoji: true },
            action_id: 'find_similar',
            style: 'primary'
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '✨ Generate Posts', emoji: true },
            action_id: 'generate_suggestions'
          }
        ]
      }
    ]
  });
});

slackBot.message('bot help', async ({ say }) => {
  await say({
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '🤖 Bot Help', emoji: true }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*🔍 Find Similar Posts*\nSearches existing posts\n• `/find-posts` or `find posts`'
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*✨ Generate Posts*\nCreates new suggestions\n• `/suggest-posts` or `suggest posts`'
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Other:* `bot stats` • `bot help` • `clear cache`'
        }
      }
    ]
  });
});

slackBot.message('clear cache', async ({ say }) => {
  clearCache();
  await say('✅ Cache cleared!');
});

slackBot.event('reaction_added', async ({ event }) => {
  if (event.reaction === '+1' || event.reaction === 'thumbsup') {
    const stats = getStats();
    stats.postsUsed++;
  }
});

 
app.get('/', (req, res) => {
  res.json({ 
    status: 'running',
    version: '3.0',
    features: ['Find Similar Posts', 'Generate Suggestions'],
    stats: getStats()
  });
});

// ============================================
// START
// ============================================

(async () => {
  await slackBot.start();
  console.log('⚡️ Slack bot running!');
  console.log('🔍 Find Similar Posts: /find-posts');
  console.log('✨ Generate Posts: /suggest-posts');
})();

app.listen(PORT, () => {
  console.log(`🚀 Server on port ${PORT}`);
});