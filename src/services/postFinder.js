const { conversationBuffer, stats } = require('../utils/storage');
const { extractTopics } = require('../utils/aiService');
const { searchPostsWithCache, removeDuplicates } = require('../utils/searchService');
const { MAX_RESULTS_TO_SHOW } = require('../config/constants');

async function findSimilarPosts(say, channel) {
  try {
    console.log('🔍 Finding similar posts...');
    
    await say('🤖 Analyzing conversation...');
    
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

    console.log(`📊 Categories: ${allCategories.join(', ')}`);

    const topics = await extractTopics(conversationText, allCategories);
    console.log(`🎯 Topics: ${topics.join(', ')}`);
    
    topics.forEach(topic => {
      stats.topTopics[topic] = (stats.topTopics[topic] || 0) + 1;
    });

    stats.similarPostSearches++;

    await say('🔍 Searching LinkedIn and X...');

    const allSearches = await Promise.all(
      topics.map(topic => searchPostsWithCache(topic))
    );

    const allPosts = { linkedin: [], x: [] };
    allSearches.forEach(results => {
      allPosts.linkedin.push(...results.linkedin);
      allPosts.x.push(...results.x);
    });

    allPosts.linkedin = removeDuplicates(allPosts.linkedin);
    allPosts.x = removeDuplicates(allPosts.x);

    console.log(`✅ Found ${allPosts.linkedin.length} LinkedIn, ${allPosts.x.length} X posts`);

    await sendSimilarPostsResults(say, topics, allCategories, allPosts);

  } catch (error) {
    console.error('❌ Error:', error);
    await say(`❌ Error: ${error.message}`);
  }
}

async function sendSimilarPostsResults(say, topics, categories, posts) {
  const topicsList = topics.slice(0, 3).join(', ');
  const categoriesList = categories.slice(0, 3).join(', ');
  
  // Header
  await say({
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🔍 Similar Posts Found',
          emoji: true
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Categories:* ${categoriesList}\n*Topics:* ${topicsList}`
        }
      },
      {
        type: 'divider'
      }
    ]
  });

  // LinkedIn posts
  if (posts.linkedin.length > 0) {
    const linkedinPosts = posts.linkedin.slice(0, MAX_RESULTS_TO_SHOW);
    const blocks = [{
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*📘 LINKEDIN POSTS*'
      }
    }];

    linkedinPosts.forEach((post, idx) => {
      const stars = getStars(post.relevance);
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

  // X posts
  if (posts.x.length > 0) {
    const xPosts = posts.x.slice(0, MAX_RESULTS_TO_SHOW);
    const blocks = [{
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*🐦 X/TWITTER POSTS*'
      }
    }];

    xPosts.forEach((post, idx) => {
      const stars = getStars(post.relevance);
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

  // Footer
  await say({
    blocks: [
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `💡 *${posts.linkedin.length + posts.x.length} similar posts found* | ⭐ = relevance`
        }]
      }
    ]
  });
}

function getStars(score) {
  if (score >= 15) return '⭐⭐⭐';
  if (score >= 8) return '⭐⭐';
  if (score >= 4) return '⭐';
  return '';
}

module.exports = {
  findSimilarPosts
};