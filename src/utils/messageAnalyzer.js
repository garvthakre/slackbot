const { TOPIC_CATEGORIES } = require('../config/constants');
const { stats } = require('./storage');

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

module.exports = {
  analyzeMessage
};