require('dotenv').config();

console.log('🧪 Testing Configuration...\n');

// Check required environment variables
const requiredVars = [
  'SLACK_BOT_TOKEN',
  'SLACK_SIGNING_SECRET',
  'SLACK_CHANNEL_ID',
  'ANTHROPIC_API_KEY'
];

let allPresent = true;

requiredVars.forEach(varName => {
  const value = process.env[varName];
  if (value) {
    console.log(`✅ ${varName}: Set (${value.substring(0, 10)}...)`);
  } else {
    console.log(`❌ ${varName}: Missing`);
    allPresent = false;
  }
});

console.log('\n📊 Optional Configuration:');
console.log(`   PORT: ${process.env.PORT || '3000 (default)'}`);
console.log(`   CHECK_INTERVAL_HOURS: ${process.env.CHECK_INTERVAL_HOURS || '4 (default)'}`);
console.log(`   MIN_MESSAGES_FOR_SUGGESTION: ${process.env.MIN_MESSAGES_FOR_SUGGESTION || '15 (default)'}`);

if (allPresent) {
  console.log('\n✨ All required variables are set! You can start the server with: npm start');
} else {
  console.log('\n⚠️  Some required variables are missing. Please check your .env file.');
}

// Test Anthropic connection
if (process.env.ANTHROPIC_API_KEY) {
  console.log('\n🤖 Testing Anthropic API connection...');
  const Anthropic = require('@anthropic-ai/sdk');
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
  });

  anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 10,
    messages: [{ role: 'user', content: 'Hi' }]
  })
  .then(() => {
    console.log('✅ Anthropic API: Connected successfully');
  })
  .catch(error => {
    console.log('❌ Anthropic API: Connection failed');
    console.log(`   Error: ${error.message}`);
  });
}