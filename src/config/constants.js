// Configuration and constants

module.exports = {
  // Buffer settings
  MAX_BUFFER_SIZE: 30,
  MESSAGES_BEFORE_TRIGGER: 12,
  RELEVANCE_THRESHOLD: 20,
  
  // Cache settings
  CACHE_TTL: 3600000, // 1 hour
  
  // Topic categories for detection
  TOPIC_CATEGORIES: {
    product: ['product', 'feature', 'mvp', 'launch', 'ship', 'build', 'design', 'ux', 'ui'],
    growth: ['growth', 'user', 'customer', 'acquisition', 'retention', 'churn', 'conversion'],
    metrics: ['revenue', 'arr', 'mrr', 'metric', 'kpi', 'data', 'analytics', 'dashboard'],
    team: ['team', 'hire', 'hiring', 'culture', 'remote', 'management', 'leadership'],
    startup: ['startup', 'founder', 'fundraising', 'pitch', 'investor', 'vc', 'seed'],
    technical: ['api', 'code', 'deploy', 'infrastructure', 'scale', 'performance', 'bug'],
    strategy: ['strategy', 'roadmap', 'vision', 'goal', 'okr', 'planning', 'execution'],
    marketing: ['marketing', 'content', 'seo', 'brand', 'community', 'viral', 'organic']
  },
  
  // AI settings
  AI_MODEL: 'mistralai/Mistral-7B-Instruct-v0.2',
  AI_MAX_TOKENS: 150,
  AI_TEMPERATURE: 0.3,
  AI_TIMEOUT: 15000,
  
  // Search settings
  SEARCH_RESULTS_PER_PLATFORM: 5,
  MAX_RESULTS_TO_SHOW: 3,
  SEARCH_TIMEOUT: 10000
};