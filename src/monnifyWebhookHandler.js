import crypto from 'crypto';
import { supabase } from './supabaseClient.js';
import meta from './metaWhatsapp.js';

/**
 * Verifies the signature of the incoming Monnify webhook.
 * @param {import('express').Request} req - The Express request object.
 * @returns {boolean} - True if the signature is valid, false otherwise.
 */
function verifyMonnifySignature(req) {
  const monnifySecret = process.env.MONNIFY_SECRET_KEY;
  const signature = req.headers['monnify-signature'];

  if (!monnifySecret || !signature) {
    console.warn('Monnify secret or signature header missing.');
    return false;
  }

  const calculatedSignature = crypto.createHmac('sha512', monnifySecret).update(req.rawBody).digest('hex');
  return signature === calculatedSignature;
}

/**
 * Handles the logic for a successful transaction event from Monnify.
 * @param {object} eventData - The event data from the webhook.
 */
async function handleSuccessfulTransaction(eventData) {
  const { paymentReference, amountPaid, customer, paymentDescription } = eventData;

  // Find the user by email
  const { data: userData, error: userError } = await supabase.from('users').select('*').eq('email', customer.email).single();

  if (userError || !userData) {
    console.error('Monnify Webhook: User not found for email:', customer.email);
    return; // Can't process without a user
  }

  const cleanPhone = userData.phone;
  const { data: sessionData } = await supabase.from('sessions').select('session_data').eq('phone', cleanPhone).single();

  // Security check: ensure this payment corresponds to the user's current session state
  if (!sessionData || sessionData.session_data.stage !== 'awaiting_payment' || sessionData.session_data.paymentReference !== paymentReference) {
    console.warn(`Webhook for ${paymentReference} received, but user session is not awaiting this payment.`);
    return;
  }

  const session = sessionData.session_data;

  // Log the transaction in the database
  await supabase.from('transactions').insert({
    user_id: userData.id,
    provider_id: session.provider_id,
    amount: amountPaid,
    status: 'PAID',
    payment_reference: paymentReference,
    service_details: {
      serviceName: session.serviceName,
      description: paymentDescription,
    },
  });

  // Notify user of success
  await meta.sendText(`+${cleanPhone}`, '✅ Your payment was successful! We have confirmed your booking.');

  // Reset the user's session to the main menu
  await supabase.from('sessions').upsert({ phone: cleanPhone, session_data: { stage: 'menu' } }, { onConflict: 'phone' });
}

/**
 * Main handler for all Monnify webhook events.
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 */
async function handleMonnifyWebhook(req, res) {
  if (!verifyMonnifySignature(req)) {
    console.warn('Invalid Monnify webhook signature.');
    return res.sendStatus(401);
  }

  if (req.body.eventType === 'SUCCESSFUL_TRANSACTION') {
    await handleSuccessfulTransaction(req.body.eventData);
  }

  res.sendStatus(200); // Acknowledge receipt for all events
}

export default handleMonnifyWebhook;