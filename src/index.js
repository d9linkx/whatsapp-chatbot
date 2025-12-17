require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const { supabase } = require('./supabaseClient');
const meta = require('./metaWhatsapp');
const handleInteractiveMessage = require('./interactiveHandler');
const handleNewUser = require('./newUserHandler');
const { generateReply } = require('./aiAssistant');
const handleMonnifyWebhook = require('./monnifyWebhookHandler');
const { showMainMenu } = require('./menuHandler');

const app = express();
// Capture raw body for signature verification
app.use(bodyParser.urlencoded({ extended: false, verify: (req, res, buf) => { req.rawBody = buf.toString(); } }));
app.use(bodyParser.json({ verify: (req, res, buf) => { req.rawBody = buf.toString(); } }));

const PORT = process.env.PORT || 3000;
// Using Meta WhatsApp Cloud API via src/metaWhatsapp.js

// Health check
app.get('/', (req, res) => res.send('WhatsApp chatbot webhook running'));

// Meta webhook verification endpoint (GET)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    console.log('Webhook verified by Meta.');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

/**
 * Middleware to verify the X-Hub-Signature-256 from Meta.
 */
function verifyMetaSignature(req, res, next) {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    console.warn('META_APP_SECRET not set. Skipping signature verification.');
    return next();
  }

  const signature = req.get('x-hub-signature-256');
  if (!signature) {
    console.warn('Missing X-Hub-Signature-256 header. Rejecting request.');
    return res.sendStatus(401);
  }

  const hmac = crypto.createHmac('sha256', appSecret).update(req.rawBody || '').digest('hex');
  const expectedSignature = `sha256=${hmac}`;

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSignature);

  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    console.warn('Invalid X-Hub-Signature-256. Rejecting request.');
    return res.sendStatus(401);
  }

  next();
}

/**
 * Middleware to extract message, load user and session, and attach to request.
 */
async function loadUserAndSession(req, res, next) {
  const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!message) {
    console.log('Received a non-message event from Meta:', JSON.stringify(req.body, null, 2));
    return res.sendStatus(200); // Not a message, but acknowledge receipt.
  }

  req.message = message;
  const waPhone = message.from;
  const cleanPhone = String(waPhone).replace(/^\+/, '');

  const { data: userData } = await supabase.from('users').select('*').eq('phone', cleanPhone).limit(1).maybeSingle();
  const { data: sessionData } = await supabase.from('sessions').select('session_data').eq('phone', cleanPhone).maybeSingle();

  req.userData = userData;
  req.session = sessionData ? sessionData.session_data : { stage: 'start' };
  req.waPhone = waPhone;
  req.cleanPhone = cleanPhone;
  req.saveSession = async (newSessionState) => {
    await supabase.from('sessions').upsert({ phone: cleanPhone, session_data: newSessionState }, { onConflict: 'phone' });
  };

  next();
}

// Incoming webhook endpoint
app.post('/webhook', verifyMetaSignature, loadUserAndSession, async (req, res, next) => {
  try {
    const { message, userData, session, saveSession, waPhone, cleanPhone } = req;
    const name = userData?.full_name;
    const context = { waPhone, name, userData, session, saveSession, cleanPhone };

    const textBody = (message.text?.body || '').trim();
    const interactive = message.interactive;

    if (!userData) {
      // If user does not exist, create them and then handle their first message
      await handleNewUser(context, textBody);
    } else if (interactive) {
      await handleInteractiveMessage(interactive, context);
    } else if (textBody) {
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
    } else {
      await showMainMenu(context, `Hi ${name}, I didn't quite get that. What would you like to do?`);
    }

    res.sendStatus(200);
  } catch (err) {
    next(err); // Pass errors to the error handler
  }
});

// Monnify Payment Confirmation Webhook
app.post('/monnify-webhook', handleMonnifyWebhook);

// Centralized error handler
app.use((err, req, res, next) => {
  console.error('An unexpected error occurred:', err);
  res.sendStatus(500);
});

// Start server only if not in test environment
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
}

// Export the app for testing
module.exports = app;
