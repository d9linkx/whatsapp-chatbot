import { supabase } from './supabaseClient.js';
import meta from './metaWhatsapp.js';
import handleTextMessage from './textHandler.js';

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

  // Now that the user exists, pass control to the standard text message handler.
  await handleTextMessage(textBody, context);
}

export default handleNewUser;