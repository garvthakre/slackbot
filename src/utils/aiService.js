const axios = require('axios');
const { AI_MODEL, AI_MAX_TOKENS, AI_TEMPERATURE, AI_TIMEOUT } = require('../config/constants');

async function extractTopics(conversationText, categories) {
  try {
    const HF_API_URL = `https://api-inference.huggingface.co/models/${AI_MODEL}`;
    
    const categoryContext = categories.length > 0 
      ? `Main categories: ${categories.join(', ')}`
      : '';
    
    const prompt = `Extract 3-4 specific searchable topics from this conversation.

${categoryContext}

Conversation:
${conversationText.substring(0, 800)}

Return ONLY a JSON array:
["topic 1", "topic 2", "topic 3"]

Be specific (e.g., "B2B SaaS pricing optimization" not just "pricing")`;

    const response = await axios.post(
      HF_API_URL,
      {
        inputs: prompt,
        parameters: {
          max_new_tokens: AI_MAX_TOKENS,
          temperature: AI_TEMPERATURE,
          return_full_text: false
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: AI_TIMEOUT
      }
    );

    const responseText = response.data[0]?.generated_text?.trim() || '';
    const jsonMatch = responseText.match(/\[[\s\S]*?\]/);
    
    if (jsonMatch) {
      const topics = JSON.parse(jsonMatch[0]);
      return topics.slice(0, 4);
    }
    
    throw new Error('No JSON found');
    
  } catch (error) {
    console.error('AI extraction failed:', error.message);
    return createFallbackTopics(conversationText, categories);
  }
}

function createFallbackTopics(text, categories) {
  const topics = [];
  
  if (categories.length > 0) {
    topics.push(...categories.map(cat => `${cat} for startups`));
  }
  
  const words = text.toLowerCase().split(/\s+/);
  const commonWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for']);
  
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

module.exports = {
  extractTopics
};