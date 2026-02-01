const { analyzeMessage } = require('../utils/messageAnalyzer');
const { conversationBuffer, stats } = require('../utils/storage');
const { findSimilarPosts } = require('../services/postFinder');
const { generatePostSuggestions } = require('../services/postGenerator');
const { MESSAGES_BEFORE_TRIGGER, RELEVANCE_THRESHOLD, MAX_BUFFER_SIZE } = require('../config/constants');

let messageCount = 0;

async function handleMessage(event, say, bot) {
  try {
    // Ignore bot messages
    if (event.subtype || event.bot_id) return;

    console.log(`📨 Message: "${event.text?.substring(0, 50)}..."`);
    
    stats.totalMessages++;
    const analysis = analyzeMessage(event.text);
    
    // Store message with metadata
    conversationBuffer.push({
      text: event.text,
      user: event.user,
      timestamp: event.ts,
      analysis: analysis,
      addedAt: Date.now()
    });

    // Smart buffer management - keep most relevant messages
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
    
    console.log(`📊 Messages: ${messageCount}/${MESSAGES_BEFORE_TRIGGER} | Relevance: ${totalScore}`);

    // Smart triggering
    const shouldTrigger = messageCount >= MESSAGES_BEFORE_TRIGGER || totalScore >= RELEVANCE_THRESHOLD;

    if (shouldTrigger) {
      console.log('🎯 Auto-triggering both modes...');
      messageCount = 0;
      
      // Trigger both modes
      await say('🤖 I noticed an interesting discussion! Let me help you with that...');
      
      // Show action buttons
      await say({
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '*What would you like me to do?*'
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
    }

  } catch (error) {
    console.error('❌ Error handling message:', error);
  }
}

function getStats() {
  const topCategories = Object.entries(stats.categoryMatches)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cat, count]) => `${cat}: ${count}`)
    .join(', ') || 'None yet';

  const recentTopics = Object.entries(stats.topTopics)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([topic, count]) => `"${topic.substring(0, 40)}..." (${count}x)`)
    .join('\n') || 'None yet';

  return {
    totalMessages: stats.totalMessages,
    similarPostSearches: stats.similarPostSearches,
    postSuggestionsGenerated: stats.postSuggestionsGenerated,
    cacheHits: stats.cacheHits,
    avgRelevanceScore: stats.avgRelevanceScore,
    postsUsed: stats.postsUsed,
    bufferSize: conversationBuffer.length,
    topCategories: topCategories,
    recentTopics: recentTopics
  };
}

function clearCache() {
  const { searchCache } = require('../utils/storage');
  searchCache.clear();
  console.log('✅ Cache cleared');
}

module.exports = {
  handleMessage,
  getStats,
  clearCache
};