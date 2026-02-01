class ConversationBuffer {
  constructor() {
    this.messages = [];
    this.lastCheckTime = null;
    this.maxMessages = 50; // Keep last 50 messages max
  }

  addMessage(message) {
    this.messages.push({
      ...message,
      addedAt: new Date()
    });

    // Keep only the last N messages to avoid memory issues
    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(-this.maxMessages);
    }
  }

  getMessages() {
    return this.messages;
  }

  clear() {
    this.messages = [];
    this.lastCheckTime = new Date();
  }

  getLastCheckTime() {
    return this.lastCheckTime;
  }

  shouldGenerateSuggestions() {
    const minMessages = parseInt(process.env.MIN_MESSAGES_FOR_SUGGESTION || '15');
    const checkIntervalHours = parseInt(process.env.CHECK_INTERVAL_HOURS || '4');
    
    // Generate if we have enough messages
    if (this.messages.length >= minMessages) {
      // And if enough time has passed since last check (or first check)
      if (!this.lastCheckTime) {
        return true;
      }

      const hoursSinceLastCheck = (new Date() - this.lastCheckTime) / (1000 * 60 * 60);
      return hoursSinceLastCheck >= checkIntervalHours;
    }

    return false;
  }

  getMessageCount() {
    return this.messages.length;
  }

  // Get messages as formatted text for Claude
  getFormattedConversation() {
    return this.messages
      .map(msg => `[${new Date(msg.addedAt).toLocaleTimeString()}] ${msg.text}`)
      .join('\n');
  }
}

// Export singleton instance
const conversationBuffer = new ConversationBuffer();

module.exports = {
  conversationBuffer
};