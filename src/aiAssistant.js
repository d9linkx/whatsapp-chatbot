import fetch from 'node-fetch';

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
async function generateReply({ phone, userName, history, session, isNewConversationSegment }) {
  const incomingText = history[history.length - 1].content;

  // If no API key, return a gentle fallback reply with suggestions
  if (!OPENAI_API_KEY) {
    const text = `Hey ${userName || 'friend'} — I got your message: "${incomingText}". I'm here to help. Would you like to browse services or ask me something?`;
    return { text, buttons: [ { id: 'browse_services', label: 'Browse services' }, { id: 'ask_question', label: 'Ask me anything' } ] };
  }

  const systemPrompt = `You are Helpa, a super friendly and smart AI assistant for the "YourHelpa" marketplace. Your voice is informal, warm, and always helpful. Think of yourself as a friendly guide, not a robot. The user's name is ${userName || 'friend'}.

Here's how you should chat with users:

- **Greeting**: Only greet the user if this is the start of a new conversation (isNewConversationSegment is true). Otherwise, get straight to the point.
- **Keep it simple and clear**: Use easy-to-understand words. Avoid jargon and long sentences. Get straight to the point in a friendly way (2-3 sentences is perfect).
- **Be a helpful guide**: Your main job is to help people find a service, buy something, or get answers.
- **Handle specific requests**: If someone says "I need a plumber" or "I want to buy a phone," ask simple follow-up questions to get the details you need, like "Sure thing! To find the best person for the job, where are you located?". When you're in the middle of a task like this, don't show the main menu buttons.
- **Handle general questions**: If someone asks a random question (like "what's the weather like?"), give them the answer, then gently guide them back to what you can do for them. For example: "It's sunny right now! Speaking of which, is there a service I can help you find today?".
- **Use their name**: Casually use the user's name to keep the chat personal.
- **Button Logic**: The system will automatically show the main menu buttons if you end your message with a general question like "How can I help?", "What can I do for you?", or "Let me know what you need!".`;

  const messages = [
    { role: 'system', content: `${systemPrompt}\n\n(isNewConversationSegment: ${isNewConversationSegment})` },
    ...history, // Add the entire conversation history
  ];

  try {
    const aiText = await callOpenAI(messages);

    const buttons = [
      { id: 'find_service', label: 'Find a service' },
      { id: 'buy_item', label: 'Buy an item' },
      { id: 'ask_question', label: 'Ask a question' },
    ];
    // Heuristic to decide when to show main menu buttons.
    const showButtons = /how can i help|what can i do for you|how can i assist|i'm here to assist|let me know/i.test(aiText || '');

    return {
      text: aiText || "Welcome to YourHelpa! How can I assist you today?",
      buttons: showButtons ? buttons : [],
    };
  } catch (e) {
    console.error('aiAssistant error:', e && e.message);
    return { text: `Hi ${userName || 'there'}! I'm here to help. What can I do for you today?`, buttons: [ { id: 'find_service', label: 'Find a service' } ] };
  }
}

export { generateReply };
