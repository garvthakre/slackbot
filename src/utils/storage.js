const { TOPIC_CATEGORIES } = require('../config/constants');

// Conversation buffer
const conversationBuffer = [];

// Search cache
const searchCache = new Map();

// Statistics
const stats = {
  totalMessages: 0,
  similarPostSearches: 0,
  postSuggestionsGenerated: 0,
  categoryMatches: {},
  cacheHits: 0,
  avgRelevanceScore: 0,
  postsUsed: 0,
  topTopics: {}
};

// Initialize category stats
Object.keys(TOPIC_CATEGORIES).forEach(cat => {
  stats.categoryMatches[cat] = 0;
});

module.exports = {
  conversationBuffer,
  searchCache,
  stats
};