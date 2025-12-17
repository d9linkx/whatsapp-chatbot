import { generateReply } from './aiAssistant.js'; // Import AI assistant
import meta from './metaWhatsapp.js'; // Import meta to send messages

const MAX_HISTORY_LENGTH = 6; // Keep the last 3 user/assistant message pairs

/**
 * Handles incoming text messages from the user.
 * @param {string} textBody - The text message from the user.
 * @param {object} context - The request context.
 */
async function handleTextMessage(textBody, context) {
  const { waPhone, name, session, cleanPhone, saveSession, isNewConversationSegment } = context;

  // Ensure history exists and is an array
  const history = Array.isArray(session.history) ? session.history : [];

  // Add user's message to history
  history.push({ role: 'user', content: textBody });

  // For any text message, use the AI assistant to generate a conversational reply.
  try {
    const aiResponse = await generateReply({
      phone: cleanPhone,
      userName: name,
      history: history, // Pass the whole history
      session: session,
      isNewConversationSegment: isNewConversationSegment,
    });

    // Add AI's response to history
    history.push({ role: 'assistant', content: aiResponse.text });

    // Trim history to save space and tokens
    session.history = history.slice(-MAX_HISTORY_LENGTH);
    await saveSession(session);

    if (aiResponse.buttons && aiResponse.buttons.length > 0) {
      await meta.sendButtons(waPhone, aiResponse.text, aiResponse.buttons);
    } else {
      await meta.sendText(waPhone, aiResponse.text);
    }
  } catch (error) {
    console.error('Error generating AI reply:', error);
    // Fallback message if the AI assistant fails
    await meta.sendText(waPhone, `Sorry, I'm having a little trouble right now. Please try again in a moment.`);
  }
}

export default handleTextMessage;