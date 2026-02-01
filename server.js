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

// Advanced conversation buffer with metadata
let conversationBuffer = [];
const MAX_BUFFER_SIZE = 30;
let messageCount = 0;
const MESSAGES_BEFORE_SUGGESTION = 12;

// Cache for search results
const searchCache = new Map();
const CACHE_TTL = 3600000; // 1 hour

// Enhanced keywords with categories
const TOPIC_CATEGORIES = {
  product: ['product', 'feature', 'mvp', 'launch', 'ship', 'build', 'design', 'ux', 'ui'],
  growth: ['growth', 'user', 'customer', 'acquisition', 'retention', 'churn', 'conversion'],
  metrics: ['revenue', 'arr', 'mrr', 'metric', 'kpi', 'data', 'analytics', 'dashboard'],
  team: ['team', 'hire', 'hiring', 'culture', 'remote', 'management', 'leadership'],
  startup: ['startup', 'founder', 'fundraising', 'pitch', 'investor', 'vc', 'seed'],
  technical: ['api', 'code', 'deploy', 'infrastructure', 'scale', 'performance', 'bug'],
  strategy: ['strategy', 'roadmap', 'vision', 'goal', 'okr', 'planning', 'execution'],
  marketing: ['marketing', 'content', 'seo', 'brand', 'community', 'viral', 'organic']
};

// Usage statistics
let stats = {
  totalSuggestions: 0,
  totalMessages: 0,
  categoryMatches: {},
  lastSuggestionTime: null,
  postsUsed: 0,
  cacheHits: 0,
  avgRelevanceScore: 0,
  topTopics: {}
};

Object.keys(TOPIC_CATEGORIES).forEach(cat => {
  stats.categoryMatches[cat] = 0;
});

// Advanced keyword detection
function analyzeMessage(text) {
  if (!text) return { hasKeywords: false, categories: [], score: 0 };
  
  const lowerText = text.toLowerCase();
  const matchedCategories = [];
  let score = 0;
  
  Object.entries(TOPIC_CATEGORIES).forEach(([category, keywords]) => {
    const matches = keywords.filter(kw => lowerText.includes(kw));
    if (matches.length > 0) {
      matchedCategories.push(category);
      score += matches.length;
      stats.categoryMatches[category]++;
    }
  });
  
  return {
    hasKeywords: matchedCategories.length > 0,
    categories: matchedCategories,
    score: score
  };
}

// Listen to messages
slackBot.event('message', async ({ event, say }) => {
  try {
    if (event.subtype || event.bot_id) return;

    console.log(`📨 Message received: "${event.text?.substring(0, 50)}..."`);
    
    stats.totalMessages++;
    const analysis = analyzeMessage(event.text);
    
    conversationBuffer.push({
      text: event.text,
      user: event.user,
      timestamp: event.ts,
      analysis: analysis,
      addedAt: Date.now()
    });

    if (conversationBuffer.length > MAX_BUFFER_SIZE) {
      conversationBuffer.sort((a, b) => {
        const scoreA = a.analysis.score || 0;
        const scoreB = b.analysis.score || 0;
        const ageA = Date.now() - a.addedAt;
        const ageB = Date.now() - b.addedAt;
        return (scoreB / ageB) - (scoreA / ageA);
      });
      conversationBuffer.shift();
    }

    messageCount++;
    const totalScore = conversationBuffer.reduce((sum, msg) => sum + (msg.analysis.score || 0), 0);
    
    console.log(`📊 Messages: ${messageCount}/${MESSAGES_BEFORE_SUGGESTION} | Relevance: ${totalScore}`);

    const shouldTrigger = messageCount >= MESSAGES_BEFORE_SUGGESTION || totalScore >= 20;

    if (shouldTrigger) {
      console.log('🎯 Triggering smart post suggestions...');
      messageCount = 0;
      await findSimilarPostsAdvanced(say, event.channel);
    }

  } catch (error) {
    console.error('❌ Error handling message:', error);
  }
});

// FIXED: Better topic extraction with fallback
async function extractTopicsAdvanced(conversationText, categories) {
  try {
    // Use a different, more reliable Hugging Face model
    const HF_API_URL = 'https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2';
    
    const categoryContext = categories.length > 0 
      ? `Main categories: ${categories.join(', ')}`
      : '';
    
    const prompt = `Extract 3-4 specific searchable topics from this startup conversation.

${categoryContext}

Conversation:
${conversationText.substring(0, 800)}

Return ONLY a JSON array of topics:
["topic 1", "topic 2", "topic 3"]

Examples:
["B2B SaaS pricing optimization", "user onboarding metrics", "product-led growth strategies"]`;

    const response = await axios.post(
      HF_API_URL,
      {
        inputs: prompt,
        parameters: {
          max_new_tokens: 150,
          temperature: 0.3,
          return_full_text: false
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    const responseText = response.data[0]?.generated_text?.trim() || '';
    const jsonMatch = responseText.match(/\[[\s\S]*?\]/);
    
    if (jsonMatch) {
      const topics = JSON.parse(jsonMatch[0]);
      return topics.slice(0, 4);
    }
    
    throw new Error('No JSON found in response');
    
  } catch (error) {
    console.error('Error extracting topics:', error.message);
    return createFallbackTopics(conversationText, categories);
  }
}

// Fallback topic generation
function createFallbackTopics(text, categories) {
  const topics = [];
  
  // Use categories with common startup terms
  if (categories.length > 0) {
    topics.push(...categories.map(cat => `${cat} for startups`));
  }
  
  // Extract meaningful phrases
  const words = text.toLowerCase().split(/\s+/);
  const commonWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by']);
  
  for (let i = 0; i < words.length - 2; i++) {
    const phrase = [words[i], words[i+1], words[i+2]]
      .filter(w => !commonWords.has(w) && w.length > 3)
      .join(' ');
    
    if (phrase.length > 10 && phrase.length < 50) {
      topics.push(phrase);
    }
  }
  
  return [...new Set(topics)].slice(0, 4);
}

// Search with caching
async function searchPostsWithCache(topic) {
  const cacheKey = topic.toLowerCase();
  const cached = searchCache.get(cacheKey);
  
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    console.log(`💾 Cache hit for: ${topic}`);
    stats.cacheHits++;
    return cached.results;
  }

  console.log(`🔍 Searching (cache miss): ${topic}`);
  
  const results = { linkedin: [], x: [] };

  try {
    const [linkedinResults, xResults] = await Promise.all([
      searchPlatform(topic, 'LinkedIn'),
      searchPlatform(topic, 'X')
    ]);

    results.linkedin = linkedinResults;
    results.x = xResults;

    searchCache.set(cacheKey, {
      results: results,
      timestamp: Date.now()
    });

  } catch (error) {
    console.error('Error searching posts:', error.message);
  }

  return results;
}

// Platform search
async function searchPlatform(topic, platform) {
  try {
    let query, siteFilter;
    
    if (platform === 'LinkedIn') {
      siteFilter = 'site:linkedin.com/posts';
      query = `${siteFilter} ${topic} startup`;
    } else {
      siteFilter = 'site:x.com OR site:twitter.com';
      query = `${siteFilter} ${topic}`;
    }

    if (process.env.SERPAPI_KEY) {
      const response = await axios.get('https://serpapi.com/search', {
        params: {
          q: query,
          api_key: process.env.SERPAPI_KEY,
          num: 5,
          engine: 'google'
        },
        timeout: 10000
      });

      return (response.data.organic_results || []).slice(0, 5).map(result => ({
        title: result.title.substring(0, 100),
        snippet: (result.snippet || '').substring(0, 150),
        url: result.link,
        platform: platform,
        relevance: calculateRelevanceScore(result.title, result.snippet, topic)
      }));
    }

    if (process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_ENGINE_ID) {
      const response = await axios.get('https://www.googleapis.com/customsearch/v1', {
        params: {
          key: process.env.GOOGLE_SEARCH_API_KEY,
          cx: process.env.GOOGLE_SEARCH_ENGINE_ID,
          q: query,
          num: 5
        },
        timeout: 10000
      });

      return (response.data.items || []).slice(0, 5).map(item => ({
        title: item.title.substring(0, 100),
        snippet: (item.snippet || '').substring(0, 150),
        url: item.link,
        platform: platform,
        relevance: calculateRelevanceScore(item.title, item.snippet, topic)
      }));
    }

    const encodedQuery = encodeURIComponent(query);
    return [{
      title: `Search ${platform} for: ${topic.substring(0, 50)}`,
      snippet: 'Click to find posts about this topic',
      url: `https://www.google.com/search?q=${encodedQuery}`,
      platform: platform,
      relevance: 0
    }];

  } catch (error) {
    console.error(`Error searching ${platform}:`, error.message);
    return [];
  }
}

// Calculate relevance
function calculateRelevanceScore(title, snippet, topic) {
  const text = `${title} ${snippet}`.toLowerCase();
  const topicWords = topic.toLowerCase().split(/\s+/);
  
  let score = 0;
  
  if (text.includes(topic.toLowerCase())) score += 10;
  
  topicWords.forEach(word => {
    if (word.length > 3 && text.includes(word)) score += 2;
  });
  
  const boostWords = ['founder', 'startup', 'built', 'learned', 'growth', 'metric'];
  boostWords.forEach(word => {
    if (text.includes(word)) score += 1;
  });
  
  return score;
}

// Main search function
async function findSimilarPostsAdvanced(say, channel) {
  try {
    console.log('🔄 Starting advanced post search...');
    
    await say('🤖 Analyzing your conversation...');
    
    const relevantMessages = conversationBuffer
      .filter(msg => msg.analysis.score > 0)
      .sort((a, b) => b.analysis.score - a.analysis.score)
      .slice(0, 15);
    
    if (relevantMessages.length === 0) {
      await say('⚠️ Not enough relevant content. Discuss product, growth, or startup topics!');
      return;
    }

    const conversationText = relevantMessages.map(msg => msg.text).join('\n');
    const allCategories = [...new Set(relevantMessages.flatMap(msg => msg.analysis.categories))];

    console.log(`📊 Detected categories: ${allCategories.join(', ')}`);

    const topics = await extractTopicsAdvanced(conversationText, allCategories);
    console.log(`🎯 Topics extracted: ${topics.join(', ')}`);
    
    topics.forEach(topic => {
      stats.topTopics[topic] = (stats.topTopics[topic] || 0) + 1;
    });

    stats.totalSuggestions++;
    stats.lastSuggestionTime = new Date().toISOString();

    await say('🔍 Searching for relevant posts...');

    const allSearches = await Promise.all(
      topics.map(topic => searchPostsWithCache(topic))
    );

    const allPosts = { linkedin: [], x: [] };

    allSearches.forEach(results => {
      allPosts.linkedin.push(...results.linkedin);
      allPosts.x.push(...results.x);
    });

    allPosts.linkedin = removeDuplicatesAndRank(allPosts.linkedin);
    allPosts.x = removeDuplicatesAndRank(allPosts.x);

    const allRelevance = [...allPosts.linkedin, ...allPosts.x].map(p => p.relevance || 0);
    stats.avgRelevanceScore = allRelevance.length > 0 
      ? (allRelevance.reduce((a, b) => a + b, 0) / allRelevance.length).toFixed(2)
      : 0;

    console.log(`✅ Found ${allPosts.linkedin.length} LinkedIn, ${allPosts.x.length} X posts`);

    await sendAdvancedResults(say, topics, allCategories, allPosts);

  } catch (error) {
    console.error('❌ Error finding posts:', error);
    await say(`❌ Error: ${error.message}`);
  }
}

// Remove duplicates and rank
function removeDuplicatesAndRank(posts) {
  const seen = new Set();
  const unique = posts.filter(post => {
    if (seen.has(post.url)) return false;
    seen.add(post.url);
    return true;
  });
  
  return unique.sort((a, b) => (b.relevance || 0) - (a.relevance || 0));
}

// FIXED: Better Slack formatting to avoid 500 error
async function sendAdvancedResults(say, topics, categories, posts) {
  const topicsList = topics.slice(0, 3).join(', ');
  const categoriesList = categories.slice(0, 3).join(', ');
  
  // FIXED: Split into smaller messages to avoid Slack payload limits
  
  // Header message
  await say({
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🎯 Smart Post Recommendations',
          emoji: true
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Your conversation covered:* ${categoriesList}\n*Key topics:* ${topicsList}`
        }
      },
      {
        type: 'divider'
      }
    ]
  });

  // LinkedIn posts (max 3 at a time to avoid payload issues)
  if (posts.linkedin.length > 0) {
    const linkedinPosts = posts.linkedin.slice(0, 3);
    const blocks = [{
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*📘 TOP LINKEDIN POSTS*'
      }
    }];

    linkedinPosts.forEach((post, idx) => {
      const stars = getRelevanceStars(post.relevance);
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${idx + 1}. ${stars} *${post.title}*\n${post.snippet}\n<${post.url}|Read Post>`
        }
      });
    });

    await say({ blocks });
  }

  // X posts (max 3 at a time)
  if (posts.x.length > 0) {
    const xPosts = posts.x.slice(0, 3);
    const blocks = [{
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*🐦 TOP X/TWITTER POSTS*'
      }
    }];

    xPosts.forEach((post, idx) => {
      const stars = getRelevanceStars(post.relevance);
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${idx + 1}. ${stars} *${post.title}*\n${post.snippet}\n<${post.url}|Read Post>`
        }
      });
    });

    await say({ blocks });
  }

  // Summary
  await say({
    blocks: [
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `💡 *${posts.linkedin.length + posts.x.length} posts found* | Ranked by relevance | React 👍 if useful`
        }]
      }
    ]
  });
}

function getRelevanceStars(score) {
  if (score >= 15) return '⭐⭐⭐';
  if (score >= 8) return '⭐⭐';
  if (score >= 4) return '⭐';
  return '';
}

// Manual triggers
slackBot.command('/suggest-posts', async ({ command, ack, say }) => {
  await ack();
  await findSimilarPostsAdvanced(say, command.channel_id);
});

slackBot.message(/^(suggest posts|find posts|show posts)/i, async ({ message, say }) => {
  await findSimilarPostsAdvanced(say, message.channel);
});

// Stats
slackBot.message('bot stats', async ({ say }) => {
  const topCategories = Object.entries(stats.categoryMatches)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cat, count]) => `${cat}: ${count}`)
    .join(', ');

  const topTopicsList = Object.entries(stats.topTopics)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([topic, count]) => `"${topic.substring(0, 40)}..." (${count}x)`)
    .join('\n');

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
          { type: 'mrkdwn', text: `*Searches:* ${stats.totalSuggestions}` },
          { type: 'mrkdwn', text: `*Cache Hits:* ${stats.cacheHits}` },
          { type: 'mrkdwn', text: `*Avg Relevance:* ${stats.avgRelevanceScore}` },
          { type: 'mrkdwn', text: `*Top Categories:*\n${topCategories}` },
          { type: 'mrkdwn', text: `*Buffer:* ${conversationBuffer.length}/${MAX_BUFFER_SIZE}` }
        ]
      }
    ]
  });
});

// Track reactions
slackBot.event('reaction_added', async ({ event }) => {
  if (event.reaction === '+1' || event.reaction === 'thumbsup') {
    stats.postsUsed++;
  }
});

// Clear cache
slackBot.message('clear cache', async ({ say }) => {
  searchCache.clear();
  await say('✅ Cache cleared!');
});

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'running',
    version: '2.0 - Fixed',
    stats: {
      ...stats,
      cacheSize: searchCache.size,
      bufferSize: conversationBuffer.length
    }
  });
});

// Start
(async () => {
  await slackBot.start();
  console.log('⚡️ Advanced Slack bot is running!');
  console.log('🧠 Features: AI topic extraction, relevance ranking, smart caching');
})();

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});