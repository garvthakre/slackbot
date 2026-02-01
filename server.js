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
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

// Store recent messages
let conversationBuffer = [];
const MAX_BUFFER_SIZE = 20;
let messageCount = 0;
const MESSAGES_BEFORE_SUGGESTION = 15;

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
  postsUsed: 0
};

// Check if message contains important keywords
function containsRelevantKeywords(text) {
  if (!text) return false;
  const lowerText = text.toLowerCase();
  return TRIGGER_KEYWORDS.some(keyword => lowerText.includes(keyword));
}

// Listen to ALL messages
slackBot.event('message', async ({ event, say }) => {
  try {
    // Ignore bot messages and other subtypes
    if (event.subtype && event.subtype === 'bot_message') {
      return;
    }
    
    if (event.subtype) {
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
    console.log(`📊 Message count: ${messageCount}/${MESSAGES_BEFORE_SUGGESTION}`);

    // Generate suggestions every N messages
    if (messageCount >= MESSAGES_BEFORE_SUGGESTION) {
      console.log('🎯 Triggering post suggestions...');
      messageCount = 0;
      await findSimilarPosts(say, event.channel);
    }

  } catch (error) {
    console.error('❌ Error handling message:', error);
  }
});

// Extract topics from conversation using AI
async function extractTopics(conversationText) {
  try {
    const HF_API_URL = 'https://api-inference.huggingface.co/models/meta-llama/Meta-Llama-3-8B-Instruct';
    
    const prompt = `Analyze this conversation between co-founders and extract 3-5 key topics or themes they're discussing.

Conversation:
${conversationText}

Return ONLY a JSON array of topics (no other text):
["topic 1", "topic 2", "topic 3"]

Topics should be specific search queries that would find relevant LinkedIn or X posts.`;

    const response = await axios.post(
      HF_API_URL,
      {
        inputs: prompt,
        parameters: {
          max_new_tokens: 200,
          temperature: 0.3,
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

    const responseText = response.data[0].generated_text.trim();
    
    // Try to extract JSON array from response
    const jsonMatch = responseText.match(/\[.*\]/s);
    if (jsonMatch) {
      const topics = JSON.parse(jsonMatch[0]);
      return topics.slice(0, 5); // Max 5 topics
    }
    
    // Fallback: extract keywords from conversation
    return extractKeywordsFromText(conversationText);
    
  } catch (error) {
    console.error('Error extracting topics:', error);
    return extractKeywordsFromText(conversationText);
  }
}

// Fallback method to extract keywords
function extractKeywordsFromText(text) {
  const words = text.toLowerCase().split(/\s+/);
  const keywords = words.filter(word => 
    TRIGGER_KEYWORDS.includes(word) && word.length > 4
  );
  
  // Get unique keywords and take top 3
  const uniqueKeywords = [...new Set(keywords)];
  return uniqueKeywords.slice(0, 3).map(k => `${k} startup`);
}

// Search for posts on multiple platforms
async function searchPosts(topic) {
  const results = {
    linkedin: [],
    x: []
  };

  try {
    // Search LinkedIn using Google (since LinkedIn API is restricted)
    const linkedinQuery = encodeURIComponent(`site:linkedin.com/posts ${topic}`);
    const linkedinResults = await searchGoogle(linkedinQuery, 'LinkedIn');
    results.linkedin = linkedinResults;

    // Search X/Twitter
    const xQuery = encodeURIComponent(`site:twitter.com OR site:x.com ${topic}`);
    const xResults = await searchGoogle(xQuery, 'X/Twitter');
    results.x = xResults;

  } catch (error) {
    console.error('Error searching posts:', error);
  }

  return results;
}

// Use Google Custom Search API or SerpAPI to find posts
async function searchGoogle(query, platform) {
  try {
    // Option 1: Using SerpAPI (free tier available)
    if (process.env.SERPAPI_KEY) {
      const response = await axios.get('https://serpapi.com/search', {
        params: {
          q: query,
          api_key: process.env.SERPAPI_KEY,
          num: 3 // Get top 3 results
        }
      });

      return response.data.organic_results?.slice(0, 3).map(result => ({
        title: result.title,
        snippet: result.snippet,
        url: result.link,
        platform: platform
      })) || [];
    }

    // Option 2: Using Google Custom Search API
    if (process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_ENGINE_ID) {
      const response = await axios.get('https://www.googleapis.com/customsearch/v1', {
        params: {
          key: process.env.GOOGLE_SEARCH_API_KEY,
          cx: process.env.GOOGLE_SEARCH_ENGINE_ID,
          q: query,
          num: 3
        }
      });

      return response.data.items?.slice(0, 3).map(item => ({
        title: item.title,
        snippet: item.snippet,
        url: item.link,
        platform: platform
      })) || [];
    }

    // Fallback: Return generic search links
    return [{
      title: `Search ${platform} for: ${decodeURIComponent(query)}`,
      snippet: 'Click to search for similar posts',
      url: platform === 'LinkedIn' 
        ? `https://www.linkedin.com/search/results/content/?keywords=${query}`
        : `https://twitter.com/search?q=${query}`,
      platform: platform
    }];

  } catch (error) {
    console.error(`Error searching ${platform}:`, error.message);
    return [];
  }
}

// Find and suggest similar posts
async function findSimilarPosts(say, channel) {
  try {
    console.log('🔄 Finding similar posts...');
    
    // Combine recent messages into conversation text
    const conversationText = conversationBuffer
      .map(msg => msg.text)
      .filter(text => text)
      .join('\n');

    if (conversationText.length < 10) {
      await say('⚠️ Not enough conversation history yet. Send a few more messages first!');
      return;
    }

    await say('🔍 Analyzing your conversation and finding similar posts...');

    // Extract topics from conversation
    console.log('📊 Extracting topics...');
    const topics = await extractTopics(conversationText);
    console.log('Topics extracted:', topics);

    // Track suggestion generation
    stats.totalSuggestions++;
    stats.lastSuggestionTime = new Date().toISOString();

    // Search for posts on each topic
    const allResults = {
      linkedin: [],
      x: []
    };

    for (const topic of topics) {
      console.log(`🔍 Searching for: ${topic}`);
      const results = await searchPosts(topic);
      allResults.linkedin.push(...results.linkedin);
      allResults.x.push(...results.x);
    }

    // Remove duplicates
    allResults.linkedin = removeDuplicates(allResults.linkedin);
    allResults.x = removeDuplicates(allResults.x);

    console.log(`Found ${allResults.linkedin.length} LinkedIn posts, ${allResults.x.length} X posts`);

    // Build formatted message
    let formattedMessage = `*Based on your discussion about:* ${topics.join(', ')}\n\n`;
    
    if (allResults.linkedin.length > 0) {
      formattedMessage += '*📘 SIMILAR LINKEDIN POSTS*\n\n';
      allResults.linkedin.slice(0, 5).forEach((post, index) => {
        formattedMessage += `${index + 1}. *${post.title}*\n`;
        formattedMessage += `   ${post.snippet}\n`;
        formattedMessage += `   🔗 <${post.url}|View Post>\n\n`;
      });
    }

    if (allResults.x.length > 0) {
      formattedMessage += '*🐦 SIMILAR X/TWITTER POSTS*\n\n';
      allResults.x.slice(0, 5).forEach((post, index) => {
        formattedMessage += `${index + 1}. *${post.title}*\n`;
        formattedMessage += `   ${post.snippet}\n`;
        formattedMessage += `   🔗 <${post.url}|View Post>\n\n`;
      });
    }

    if (allResults.linkedin.length === 0 && allResults.x.length === 0) {
      formattedMessage += '_No similar posts found. Try discussing more specific topics!_';
    }

    // Post to Slack
    await say({
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '🔍 Similar Posts Found!',
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
              text: '_💡 These posts discuss similar topics to your conversation. Click to read and get inspired!_'
            }
          ]
        }
      ]
    });

    console.log('✅ Posted suggestions to Slack');
  } catch (error) {
    console.error('❌ Error finding posts:', error);
    await say(`❌ Error finding similar posts: ${error.message}`);
  }
}

// Remove duplicate URLs
function removeDuplicates(posts) {
  const seen = new Set();
  return posts.filter(post => {
    if (seen.has(post.url)) {
      return false;
    }
    seen.add(post.url);
    return true;
  });
}

// Manual trigger command
slackBot.command('/suggest-posts', async ({ command, ack, respond }) => {
  try {
    await ack();
    console.log('🎯 Manual trigger: /suggest-posts command received');
    
    const conversationText = conversationBuffer
      .map(msg => msg.text)
      .filter(text => text)
      .join('\n');
    
    if (conversationText.length < 10) {
      await respond({
        response_type: 'in_channel',
        text: '⚠️ Not enough conversation history yet. Send a few more messages first!'
      });
      return;
    }

    await respond({
      response_type: 'in_channel',
      text: '🔍 Searching for similar posts...'
    });

    // Trigger the search (this will post results separately)
    await findSimilarPosts(respond, command.channel_id);
    
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
  await findSimilarPosts(say, message.channel);
});

slackBot.message('find similar posts', async ({ message, say }) => {
  console.log('🎯 Manual trigger: "find similar posts" message received');
  await findSimilarPosts(say, message.channel);
});

// Stats command
slackBot.message('bot stats', async ({ say }) => {
  await sendStatsMessage(say);
});

// Track reactions
slackBot.event('reaction_added', async ({ event }) => {
  try {
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
            text: `*Searches Performed:*\n${stats.totalSuggestions}`
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
            text: `*Next Search in:*\n${MESSAGES_BEFORE_SUGGESTION - messageCount} messages`
          }
        ]
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `_Last search: ${stats.lastSuggestionTime ? new Date(stats.lastSuggestionTime).toLocaleString() : 'Never'}_`
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
    message: 'Slack Similar Post Finder Bot is active!',
    stats: {
      totalMessages: stats.totalMessages,
      totalSearches: stats.totalSuggestions,
      postsUsed: stats.postsUsed,
      keywordMatches: stats.keywordMatches,
      bufferSize: conversationBuffer.length,
      messagesUntilNext: MESSAGES_BEFORE_SUGGESTION - messageCount,
      lastSearch: stats.lastSuggestionTime
    }
  });
});

// Start the Slack bot
(async () => {
  await slackBot.start();
  console.log('⚡️ Slack bot is running!');
  console.log('🔍 Will search for similar posts based on your conversations');
})();

// Start Express server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});