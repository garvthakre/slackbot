const axios = require('axios');
const { conversationBuffer, stats } = require('../utils/storage');
const { extractTopics } = require('../utils/aiService');

async function generatePostSuggestions(say, channel) {
  try {
    console.log('✨ Generating post suggestions...');
    
    await say('🤖 Creating post ideas from your conversation...');
    
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
    
    stats.postSuggestionsGenerated++;

    // Generate posts using AI
    const suggestions = await generateWithAI(conversationText, topics, allCategories);

    await sendGeneratedPosts(say, suggestions, topics);

  } catch (error) {
    console.error('❌ Error:', error);
    await say(`❌ Error: ${error.message}`);
  }
}

async function generateWithAI(conversationText, topics, categories) {
  try {
    const HF_API_URL = 'https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2';
    
    const categoryContext = categories.length > 0 
      ? `Categories: ${categories.join(', ')}`
      : '';
    
    const prompt = `Create social media posts from this startup conversation.

${categoryContext}
Topics: ${topics.join(', ')}

Conversation:
${conversationText.substring(0, 1000)}

Generate:
1. Two LinkedIn posts (150-250 words each, professional)
2. Two X posts (under 280 characters, punchy)

Format:
LINKEDIN 1:
[post]

LINKEDIN 2:
[post]

X 1:
[post]

X 2:
[post]`;

    const response = await axios.post(
      HF_API_URL,
      {
        inputs: prompt,
        parameters: {
          max_new_tokens: 800,
          temperature: 0.7,
          return_full_text: false
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 20000
      }
    );

    const responseText = response.data[0]?.generated_text || '';
    return parsePosts(responseText, conversationText, topics);

  } catch (error) {
    console.error('AI generation failed:', error.message);
    return createFallbackPosts(conversationText, topics);
  }
}

function parsePosts(text, conversation, topics) {
  const posts = {
    linkedin: [],
    x: []
  };

  // Try to extract from AI response
  const linkedinMatch1 = text.match(/LINKEDIN 1:\s*([\s\S]*?)(?=LINKEDIN 2:|X 1:|$)/i);
  const linkedinMatch2 = text.match(/LINKEDIN 2:\s*([\s\S]*?)(?=X 1:|$)/i);
  const xMatch1 = text.match(/X 1:\s*([\s\S]*?)(?=X 2:|$)/i);
  const xMatch2 = text.match(/X 2:\s*([\s\S]*?)$/i);

  if (linkedinMatch1) posts.linkedin.push(linkedinMatch1[1].trim().substring(0, 500));
  if (linkedinMatch2) posts.linkedin.push(linkedinMatch2[1].trim().substring(0, 500));
  if (xMatch1) posts.x.push(xMatch1[1].trim().substring(0, 280));
  if (xMatch2) posts.x.push(xMatch2[1].trim().substring(0, 280));

  // If parsing failed, use fallback
  if (posts.linkedin.length === 0 && posts.x.length === 0) {
    return createFallbackPosts(conversation, topics);
  }

  return posts;
}

function createFallbackPosts(conversation, topics) {
  const snippet = conversation.substring(0, 100);
  const topic = topics[0] || 'our discussion';
  
  return {
    linkedin: [
      `Just had an insightful discussion about ${topic}. Key takeaway: ${snippet}... What's your experience with this? Would love to hear your thoughts! #startup #product`,
      `Reflecting on our team conversation about ${topic}. One thing that stood out: the importance of ${topics[1] || 'execution'}. How do you approach similar challenges?`
    ],
    x: [
      `Quick insight from today: ${snippet}... 🧵`,
      `Building in public: ${topic} is harder than it looks, but we're learning! 🚀`
    ]
  };
}

async function sendGeneratedPosts(say, posts, topics) {
  // Header
  await say({
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '✨ Post Suggestions Generated',
          emoji: true
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Based on: ${topics.slice(0, 2).join(', ')}`
        }
      },
      {
        type: 'divider'
      }
    ]
  });

  // LinkedIn posts
  if (posts.linkedin.length > 0) {
    await say({
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*📘 LINKEDIN POST IDEAS*'
          }
        },
        ...posts.linkedin.map((post, idx) => ({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Post ${idx + 1}:*\n${post}\n\n<https://www.linkedin.com/feed/|Copy & Post on LinkedIn>`
          }
        }))
      ]
    });
  }

  // X posts
  if (posts.x.length > 0) {
    await say({
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*🐦 X/TWITTER POST IDEAS*'
          }
        },
        ...posts.x.map((post, idx) => ({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Post ${idx + 1}:*\n${post}\n\n<https://twitter.com/compose/tweet|Copy & Post on X>`
          }
        }))
      ]
    });
  }

  // Footer
  await say({
    blocks: [
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `💡 *${posts.linkedin.length + posts.x.length} post ideas created* | Edit & share!`
        }]
      }
    ]
  });
}

module.exports = {
  generatePostSuggestions
};