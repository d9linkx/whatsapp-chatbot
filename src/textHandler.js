const { generateReply } = require('./aiAssistant'); // Import AI assistant
const meta = require('./metaWhatsapp'); // Import meta to send messages

/**
 * Handles incoming text messages from the user.
 * @param {string} textBody - The text message from the user.
 * @param {object} context - The request context.
 */
async function handleTextMessage(textBody, context) {
  const { waPhone, name, session, cleanPhone } = context;

  // For any text message, use the AI assistant to generate a conversational reply.
  try {
    const aiResponse = await generateReply({
      phone: cleanPhone,
      userName: name,
      incomingText: textBody,
      session: session,
    });
    
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

module.exports = handleTextMessage;