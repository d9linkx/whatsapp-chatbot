import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { supabase } from './supabaseClient.js';
import meta from './metaWhatsapp.js';
import handleInteractiveMessage from './interactiveHandler.js';
import handleTextMessage from './textHandler.js'; // New import for text handling
import handleNewUser from './newUserHandler.js';
import handleMonnifyWebhook from './monnifyWebhookHandler.js';

const app = express();
const PORT = process.env.PORT || 3000;

// --- Security Middleware ---

// Set security-related HTTP response headers
app.use(helmet());

// Rate limiting to prevent brute-force attacks
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// --- Body Parsers ---

// Use express.json() with a verify function to capture the raw body
// This is needed for webhook signature verification
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({ extended: false })); // For URL-encoded bodies if needed

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

  const hmac = crypto.createHmac('sha256', appSecret).update(req.rawBody).digest('hex');
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
  const TEN_MINUTES_IN_MS = 10 * 60 * 1000;

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

  const session = sessionData ? sessionData.session_data : { stage: 'start' };
  const lastInteraction = session.lastInteraction || 0;
  const isNewConversationSegment = (Date.now() - lastInteraction) > TEN_MINUTES_IN_MS;

  req.userData = userData;
  req.session = session;
  req.waPhone = waPhone;
  req.cleanPhone = cleanPhone;
  req.isNewConversationSegment = isNewConversationSegment;

  req.saveSession = async (newSessionState) => {
    // Always update the last interaction time on save
    const updatedSession = { ...newSessionState, lastInteraction: Date.now() };
    await supabase.from('sessions').upsert({ phone: cleanPhone, session_data: updatedSession }, { onConflict: 'phone' });
    req.session = updatedSession; // Keep req.session in sync
  };

  next();
}

// Incoming webhook endpoint
app.post('/webhook', verifyMetaSignature, loadUserAndSession, async (req, res, next) => {
  try {
    const { message, userData, session, saveSession, waPhone, cleanPhone, isNewConversationSegment } = req;
    const name = userData?.full_name;
    const context = { waPhone, name, userData, session, saveSession, cleanPhone, isNewConversationSegment };

    const textBody = (message.text?.body || '').trim();
    const interactive = message.interactive;

    if (!userData) {
      // If user does not exist, create them and then handle their first message
      await handleNewUser(context, textBody);
    } else if (interactive) {
      await handleInteractiveMessage(interactive, context);
    } else if (textBody) {
      // For any text message, use the AI assistant to generate a conversational reply.
      await handleTextMessage(textBody, context);
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
export default app;
