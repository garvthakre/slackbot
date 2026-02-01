const axios = require('axios');
const { searchCache, stats } = require('./storage');
const { CACHE_TTL, SEARCH_RESULTS_PER_PLATFORM, SEARCH_TIMEOUT } = require('../config/constants');

async function searchPostsWithCache(topic) {
  const cacheKey = topic.toLowerCase();
  const cached = searchCache.get(cacheKey);
  
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    console.log(`💾 Cache hit: ${topic}`);
    stats.cacheHits++;
    return cached.results;
  }

  console.log(`🔍 Searching: ${topic}`);
  
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
    console.error('Search error:', error.message);
  }

  return results;
}

async function searchPlatform(topic, platform) {
  try {
    let query;
    
    if (platform === 'LinkedIn') {
      query = `site:linkedin.com/posts ${topic} startup`;
    } else {
      query = `site:x.com OR site:twitter.com ${topic}`;
    }

    // SerpAPI
    if (process.env.SERPAPI_KEY) {
      const response = await axios.get('https://serpapi.com/search', {
        params: {
          q: query,
          api_key: process.env.SERPAPI_KEY,
          num: SEARCH_RESULTS_PER_PLATFORM,
          engine: 'google'
        },
        timeout: SEARCH_TIMEOUT
      });

      return (response.data.organic_results || []).slice(0, SEARCH_RESULTS_PER_PLATFORM).map(result => ({
        title: result.title.substring(0, 100),
        snippet: (result.snippet || '').substring(0, 150),
        url: result.link,
        platform: platform,
        relevance: calculateRelevance(result.title, result.snippet, topic)
      }));
    }

    // Google Custom Search
    if (process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_ENGINE_ID) {
      const response = await axios.get('https://www.googleapis.com/customsearch/v1', {
        params: {
          key: process.env.GOOGLE_SEARCH_API_KEY,
          cx: process.env.GOOGLE_SEARCH_ENGINE_ID,
          q: query,
          num: SEARCH_RESULTS_PER_PLATFORM
        },
        timeout: SEARCH_TIMEOUT
      });

      return (response.data.items || []).slice(0, SEARCH_RESULTS_PER_PLATFORM).map(item => ({
        title: item.title.substring(0, 100),
        snippet: (item.snippet || '').substring(0, 150),
        url: item.link,
        platform: platform,
        relevance: calculateRelevance(item.title, item.snippet, topic)
      }));
    }

    // Fallback
    const encodedQuery = encodeURIComponent(query);
    return [{
      title: `Search ${platform} for: ${topic.substring(0, 50)}`,
      snippet: 'Click to find posts',
      url: `https://www.google.com/search?q=${encodedQuery}`,
      platform: platform,
      relevance: 0
    }];

  } catch (error) {
    console.error(`${platform} search error:`, error.message);
    return [];
  }
}

function calculateRelevance(title, snippet, topic) {
  const text = `${title} ${snippet}`.toLowerCase();
  const topicWords = topic.toLowerCase().split(/\s+/);
  
  let score = 0;
  if (text.includes(topic.toLowerCase())) score += 10;
  
  topicWords.forEach(word => {
    if (word.length > 3 && text.includes(word)) score += 2;
  });
  
  const boostWords = ['founder', 'startup', 'built', 'growth'];
  boostWords.forEach(word => {
    if (text.includes(word)) score += 1;
  });
  
  return score;
}

function removeDuplicates(posts) {
  const seen = new Set();
  return posts.filter(post => {
    if (seen.has(post.url)) return false;
    seen.add(post.url);
    return true;
  }).sort((a, b) => (b.relevance || 0) - (a.relevance || 0));
}

module.exports = {
  searchPostsWithCache,
  removeDuplicates
};