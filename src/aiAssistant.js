const fetch = require('node-fetch');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_API_URL = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/chat/completions';

if (!OPENAI_API_KEY) {
  console.warn('OPENAI_API_KEY not set; aiAssistant will use a simple fallback responder.');
}

async function callOpenAI(messages) {
  const res = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: OPENAI_MODEL, messages, max_tokens: 400 }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
  const choice = json.choices && json.choices[0];
  return choice ? (choice.message && choice.message.content) : null;
}

/**
 * generateReply: produce a friendly, conversational reply.
 * Returns { text, buttons } where buttons is optional array [{id,label}]
 */
async function generateReply({ phone, userName, incomingText, session }) {
  // If no API key, return a gentle fallback reply with suggestions
  if (!OPENAI_API_KEY) {
    const text = `Hey ${userName || 'friend'} — I got your message: "${incomingText}". I'm here to help. Would you like to browse services or ask me something?`;
    return { text, buttons: [ { id: 'browse_services', label: 'Browse services' }, { id: 'ask_question', label: 'Ask me anything' } ] };
  }

  // Construct a helpful system prompt that keeps the assistant friendly and nudges toward relevant services
  const system = `You are Helpa, a world-class conversational AI for a marketplace called YourHelpa.
Your personality is friendly, human, and extremely helpful.

RULES:
1.  **Greeting:** If the user starts with a greeting (like "hi", "hello"), respond with a warm welcome to YourHelpa, ask how you can help, and ALWAYS show the three main action buttons.
2.  **General Questions & Pivot:** If the user asks a general question (e.g., "what is the capital of France?"), first answer it accurately. Then, immediately and smoothly pivot the conversation back to the marketplace's purpose. For example: "The capital of France is Paris! By the way, if you need help finding any services or items, I'm here to assist." After pivoting, ALWAYS show the three main action buttons.
3.  **Service Intent:** If the user's intent is clearly to use a service (e.g., "I need a plumber"), start the process by asking a clarifying question (e.g., "Sure, I can help with that. What is your location?"). DO NOT show buttons in this case.
4.  **Concise:** Keep all your text responses concise and conversational (2-3 sentences max).`;

  const userMsg = `The user (${userName || 'new user'}) sent this message: "${incomingText}". Follow the rules in the system prompt to generate the perfect response.`;

  try {
    const aiText = await callOpenAI([
      { role: 'system', content: system },
      { role: 'user', content: userMsg },
    ]);

    const buttons = [
      { id: 'find_service', label: 'Find a service' },
      { id: 'buy_item', label: 'Buy an item' },
      { id: 'ask_question', label: 'Ask a question' },
    ];

    // Per the rules, show buttons after a greeting or a pivot from a general question.
    const showButtons = /how can i help|what can i do for you|how can i assist|i'm here to assist|let me know/i.test(aiText);

    return {
      text: aiText || "Welcome to YourHelpa! How can I assist you today?",
      buttons: showButtons ? buttons : [],
    };
  } catch (e) {
    console.error('aiAssistant error:', e && e.message);
    return { text: `Hi ${userName || 'there'}! I'm here to help. What can I do for you today?`, buttons: [ { id: 'find_service', label: 'Find a service' } ] };
  }
}

module.exports = { generateReply };
