const { supabase } = require('./supabaseClient');
const meta = require('./metaWhatsapp');
const { generateReply } = require('./aiAssistant');

/**
 * Silently creates a new user record when they message for the first time.
 * @param {object} context - The request context.
 * @param {string} textBody - The initial message from the user.
 */
async function handleNewUser(context, textBody) {
  const { cleanPhone } = context;

  // Create a new user record in Supabase without asking for a name yet.
  // The name can be collected later when a booking is made.
  const { data: newUser, error } = await supabase
    .from('users')
    .insert({ phone: cleanPhone, full_name: 'New User' }) // Use a placeholder name
    .select()
    .single();

  if (error) {
    console.error('Error creating new user:', error);
    await meta.sendTextMessage(context.waPhone, 'Sorry, there was an error setting up your account. Please try again in a moment.');
    return;
  }

  // Update context with the new user data for the rest of this request
  context.userData = newUser;
  context.name = null; // Name is not known yet

  // Now that the user exists, proceed with the standard text handling
  try {
    const aiResponse = await generateReply({
      phone: context.cleanPhone,
      userName: context.name,
      incomingText: textBody,
      session: context.session,
    });

    if (aiResponse.buttons && aiResponse.buttons.length > 0) {
      await meta.sendButtons(context.waPhone, aiResponse.text, aiResponse.buttons);
    } else {
      await meta.sendText(context.waPhone, aiResponse.text);
    }
  } catch (error) {
    console.error('Error generating AI reply for new user:', error);
    // Fallback message if the AI assistant fails
    await meta.sendText(context.waPhone, `Welcome! I'm having a little trouble right now, but I'm here to help. Please try again in a moment.`);
  }
}

module.exports = handleNewUser;