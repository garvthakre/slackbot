const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

async function generatePostSuggestions(messages) {
  try {
    // Format messages into conversation text
    const conversationText = messages
      .map(msg => msg.text)
      .join('\n\n');

    const prompt = `You are analyzing a Slack conversation between two co-founders working on their startup. Based on their discussion, suggest authentic social media posts.

Here's their conversation:

${conversationText}

---

Based on this conversation, generate:
1. Two LinkedIn post suggestions (professional, insightful, 150-300 words each)
2. Two X (Twitter) post suggestions (concise, engaging, max 280 characters each)

The posts should:
- Feel authentic and conversational (like they actually said these things)
- Highlight interesting insights, lessons, or observations from their discussion
- Be ready to copy-paste with minimal editing
- Match a founder/builder tone (not corporate or overly polished)
- Focus on product, growth, lessons learned, or interesting observations

Return your response in this EXACT JSON format:
{
  "linkedin": [
    "First LinkedIn post here...",
    "Second LinkedIn post here..."
  ],
  "twitter": [
    "First tweet here (under 280 chars)",
    "Second tweet here (under 280 chars)"
  ]
}

IMPORTANT: Return ONLY the JSON, no other text.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    // Extract the text response
    const responseText = message.content[0].text;
    
    // Parse JSON response
    const suggestions = JSON.parse(responseText);

    return {
      linkedin: suggestions.linkedin || [],
      twitter: suggestions.twitter || [],
      raw: responseText
    };

  } catch (error) {
    console.error('Error generating suggestions:', error);
    
    // Return fallback suggestions on error
    return {
      linkedin: [
        "Error generating LinkedIn suggestions. Please try again."
      ],
      twitter: [
        "Error generating X suggestions. Please try again."
      ],
      error: error.message
    };
  }
}

module.exports = {
  generatePostSuggestions
};