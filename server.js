require('dotenv').config();
const express = require('express');
const { App } = require('@slack/bolt');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// LinkedIn API configuration
const LINKEDIN_API_BASE = 'https://api.linkedin.com/v2';

// X (Twitter) API configuration  
const X_API_BASE = 'https://api.twitter.com/2';

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
  lastSuggestionTime: null,
  postsUsed: 0  // Track how many suggestions got thumbs up
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

// Function to post to LinkedIn and return the post URL
async function postToLinkedIn(content) {
  try {
    if (!process.env.LINKEDIN_ACCESS_TOKEN || !process.env.LINKEDIN_PERSON_URN) {
      console.log('⚠️ LinkedIn credentials not configured, skipping auto-post');
      return null;
    }

    const response = await axios.post(
      `${LINKEDIN_API_BASE}/ugcPosts`,
      {
        author: process.env.LINKEDIN_PERSON_URN,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: {
              text: content
            },
            shareMediaCategory: 'NONE'
          }
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0'
        }
      }
    );

    // Extract post ID from response
    const postId = response.data.id;
    
    // Convert URN to actual LinkedIn URL
    // Format: https://www.linkedin.com/feed/update/urn:li:share:POST_ID/
    const postUrl = `https://www.linkedin.com/feed/update/${postId}/`;
    
    console.log(`✅ Posted to LinkedIn: ${postUrl}`);
    return postUrl;
  } catch (error) {
    console.error('❌ Error posting to LinkedIn:', error.response?.data || error.message);
    return null;
  }
}

// Function to post to X (Twitter) and return the tweet URL
async function postToX(content) {
  try {
    if (!process.env.X_ACCESS_TOKEN || !process.env.X_USERNAME) {
      console.log('⚠️ X (Twitter) credentials not configured, skipping auto-post');
      return null;
    }

    const response = await axios.post(
      `${X_API_BASE}/tweets`,
      {
        text: content
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.X_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const tweetId = response.data.data.id;
    const tweetUrl = `https://twitter.com/${process.env.X_USERNAME}/status/${tweetId}`;
    
    console.log(`✅ Posted to X: ${tweetUrl}`);
    return tweetUrl;
  } catch (error) {
    console.error('❌ Error posting to X:', error.response?.data || error.message);
    return null;
  }
}

// Parse AI suggestions and auto-post them
async function parseAndPostSuggestions(aiResponse) {
  const posts = {
    linkedin: [],
    x: []
  };

  // Extract LinkedIn posts
  const linkedinMatch1 = aiResponse.match(/LINKEDIN POST 1:\s*([\s\S]*?)(?=LINKEDIN POST 2:|X POST|$)/i);
  const linkedinMatch2 = aiResponse.match(/LINKEDIN POST 2:\s*([\s\S]*?)(?=X POST|$)/i);
  
  // Extract X posts
  const xMatch1 = aiResponse.match(/X POST 1:\s*([\s\S]*?)(?=X POST 2:|$)/i);
  const xMatch2 = aiResponse.match(/X POST 2:\s*([\s\S]*?)$/i);

  // Post to LinkedIn if auto-posting is enabled
  const autoPost = process.env.AUTO_POST_ENABLED === 'true';
  
  if (linkedinMatch1) {
    const content = linkedinMatch1[1].trim();
    const url = autoPost ? await postToLinkedIn(content) : null;
    posts.linkedin.push({ content, url });
  }

  if (linkedinMatch2) {
    const content = linkedinMatch2[1].trim();
    const url = autoPost ? await postToLinkedIn(content) : null;
    posts.linkedin.push({ content, url });
  }

  if (xMatch1) {
    const content = xMatch1[1].trim();
    const url = autoPost ? await postToX(content) : null;
    posts.x.push({ content, url });
  }

  if (xMatch2) {
    const content = xMatch2[1].trim();
    const url = autoPost ? await postToX(content) : null;
    posts.x.push({ content, url });
  }

  return posts;
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
    const aiResponse = await generatePostSuggestions(conversationText);
    
    console.log('✅ Suggestions generated!');
    console.log('📤 Parsing and posting to social media...');
    
    // Parse and auto-post suggestions
    const posts = await parseAndPostSuggestions(aiResponse);

    console.log('✅ Posts processed, sending to Slack...');

    // Build formatted message with posts and links
    let formattedMessage = '*Based on your recent conversation:*\n\n';
    
    // LinkedIn Posts
    formattedMessage += '*📘 LINKEDIN POSTS*\n\n';
    posts.linkedin.forEach((post, index) => {
      formattedMessage += `*Post ${index + 1}:*\n${post.content}\n`;
      if (post.url) {
        formattedMessage += `🔗 <${post.url}|View on LinkedIn>\n\n`;
      } else {
        formattedMessage += `_Not posted (auto-posting disabled or failed)_\n\n`;
      }
    });

    // X Posts
    formattedMessage += '*🐦 X (TWITTER) POSTS*\n\n';
    posts.x.forEach((post, index) => {
      formattedMessage += `*Post ${index + 1}:*\n${post.content}\n`;
      if (post.url) {
        formattedMessage += `🔗 <${post.url}|View on X>\n\n`;
      } else {
        formattedMessage += `_Not posted (auto-posting disabled or failed)_\n\n`;
      }
    });

    // Post to Slack with formatted message
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
            text: formattedMessage
          }
        },
        {
          type: 'divider'
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: process.env.AUTO_POST_ENABLED === 'true' 
                ? '_✅ Posts automatically published! Click links to view._'
                : '_💡 Tip: Enable AUTO_POST_ENABLED in .env to auto-publish posts. For now, copy and paste manually._'
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
          type: 'divider'
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*📝 Quick Actions:*'
          }
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: '🔗 Post on LinkedIn',
                emoji: true
              },
              url: 'https://www.linkedin.com/feed/',
              style: 'primary'
            },
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: '🐦 Post on X',
                emoji: true
              },
              url: 'https://twitter.com/compose/tweet'
            },
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: '📊 View Stats',
                emoji: true
              },
              action_id: 'view_stats'
            }
          ]
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '_💡 Tip: Copy the post you like, click the button, and paste! React with 👍 if you used one._'
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
  await sendStatsMessage(say);
});

// Handle button clicks
slackBot.action('view_stats', async ({ ack, say }) => {
  await ack();
  await sendStatsMessage(say);
});

// Track reactions on suggestion messages
slackBot.event('reaction_added', async ({ event }) => {
  try {
    // If someone reacts with thumbs up to a bot message, count it as "used"
    if (event.reaction === '+1' || event.reaction === 'thumbsup') {
      stats.postsUsed++;
      console.log(`👍 Post marked as used! Total used: ${stats.postsUsed}`);
    }
  } catch (error) {
    console.error('Error tracking reaction:', error);
  }
});

// Helper function to send stats
async function sendStatsMessage(say) {
  const keywordPercent = stats.totalMessages > 0 
    ? ((stats.keywordMatches / stats.totalMessages) * 100).toFixed(1)
    : 0;
  
  const usageRate = stats.totalSuggestions > 0
    ? ((stats.postsUsed / stats.totalSuggestions) * 100).toFixed(1)
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
            text: `*Posts Used:* 👍\n${stats.postsUsed} (${usageRate}% usage)`
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
            text: `*Next in:*\n${MESSAGES_BEFORE_SUGGESTION - messageCount} messages`
          }
        ]
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `_Last suggestion: ${stats.lastSuggestionTime ? new Date(stats.lastSuggestionTime).toLocaleString() : 'Never'}_`
          }
        ]
      }
    ]
  });
}

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'running',
    message: 'Slack Post Suggester Bot is active!',
    stats: {
      totalMessages: stats.totalMessages,
      totalSuggestions: stats.totalSuggestions,
      postsUsed: stats.postsUsed,
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