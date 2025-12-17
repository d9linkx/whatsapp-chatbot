const fetch = require('node-fetch');

const TOKEN = process.env.META_WHATSAPP_TOKEN; // Page access token
const PHONE_NUMBER_ID = process.env.META_WHATSAPP_PHONE_NUMBER_ID; // phone number id from Meta

if (!TOKEN || !PHONE_NUMBER_ID) {
  console.warn('META_WHATSAPP_TOKEN or META_WHATSAPP_PHONE_NUMBER_ID not set; Meta WhatsApp API will not be available.');
}

const API_BASE = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}`;

async function sendRaw(payload) {
  // If dry-run mode is enabled, log instead of sending
  if (process.env.META_DRY_RUN === 'true') {
    console.log('metaWhatsapp (dry-run): would send payload:', JSON.stringify(payload, null, 2));
    return { dryRun: true, payload };
  }

  if (!TOKEN || !PHONE_NUMBER_ID) {
    console.log('metaWhatsapp: no token/phone id configured — would send:', JSON.stringify(payload, null, 2));
    return { fallback: true, payload };
  }

  const res = await fetch(`${API_BASE}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const json = await res.json();
  if (!res.ok) {
    console.error('Meta WhatsApp API error', json);
    throw new Error(JSON.stringify(json));
  }
  return json;
}

function toWaPhone(phone) {
  // Accept numbers like '2348012345678' or '+2348012345678' or 'whatsapp:+234...'
  let p = String(phone);
  p = p.replace(/^whatsapp:/i, '').replace(/^\+/, '');
  return `+${p}`;
}

async function sendText(toPhone, text) {
  const to = toWaPhone(toPhone);
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { preview_url: false, body: text },
  };
  return sendRaw(payload);
}

async function sendButtons(toPhone, text, buttons /* [{id,label}] */) {
  const to = toWaPhone(toPhone);
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text },
      action: { buttons: buttons.map(b => ({ type: 'reply', reply: { id: b.id, title: b.label } })) },
    },
  };
  return sendRaw(payload);
}

async function sendList(toPhone, headerTitle, bodyText, buttonText, sections /* [{title,rows:[{id,title,description}]}] */) {
  const to = toWaPhone(toPhone);
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      header: headerTitle ? { type: 'text', text: headerTitle } : undefined,
      body: { text: bodyText },
      action: {
        button: buttonText || 'Choose',
        sections: sections.map(s => ({
          title: s.title,
          rows: s.rows.map(r => ({ id: r.id, title: r.title, description: r.description || '' })),
        })),
      },
    },
  };
  return sendRaw(payload);
}

module.exports = { sendText, sendButtons, sendList };
