# Slack Content Suggester Bot

https://github.com/user-attachments/assets/169d8b07-4cde-4b94-9702-067c851d9ebf

A Slack bot that listens to your conversations and helps you find similar posts or generate content ideas for LinkedIn and X (Twitter).

## What it does

- **Listens** to your Slack conversations
- **Finds** similar posts from LinkedIn and X based on your discussion
- **Generates** ready-to-post content suggestions
- Auto-triggers after detecting interesting startup/product discussions

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment**
   
   Copy `.env.example` to `.env` and fill in:
   ```
   SLACK_BOT_TOKEN=xoxb-your-token
   SLACK_SIGNING_SECRET=your-secret
   SLACK_APP_TOKEN=xapp-your-token
   ANTHROPIC_API_KEY=sk-ant-your-key
   SERPAPI_KEY=your-key (optional, for better search)
   ```

3. **Run**
   ```bash
   npm start
   ```

## Usage

The bot auto-detects relevant conversations and offers options. You can also use:

- `/getposts` - Choose between finding similar posts or generating new ideas
- `/find-posts` - Search for similar existing posts
- `/suggest-posts` - Generate new post suggestions
- `bot help` - See all commands
- `bot stats` - View usage statistics

## How it works

1. Monitors your Slack messages
2. Analyzes conversations for startup/product/growth topics
3. After 12+ relevant messages, prompts you with options
4. Either searches the web for similar content or generates new post ideas

---

Built with Claude AI and Slack Bolt
