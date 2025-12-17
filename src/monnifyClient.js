const fetch = require('node-fetch');

const MONNIFY_API_KEY = process.env.MONNIFY_API_KEY;
const MONNIFY_SECRET_KEY = process.env.MONNIFY_SECRET_KEY;
const MONNIFY_BASE_URL = process.env.MONNIFY_BASE_URL || 'https://api.monnify.com';
const MONNIFY_CONTRACT_CODE = process.env.MONNIFY_CONTRACT_CODE; // required to initialize payments

if (!MONNIFY_API_KEY || !MONNIFY_SECRET_KEY) {
  console.warn('Monnify credentials not configured; monnifyClient will return a fake payment link for testing.');
}

async function createPaymentLink({ amount, customerName, customerEmail, customerPhone, invoiceReference }) {
  if (!MONNIFY_API_KEY || !MONNIFY_SECRET_KEY || !MONNIFY_CONTRACT_CODE) {
    // Return a fake link for local testing
    return { paymentUrl: `https://example.com/pay?amount=${amount}&ref=${invoiceReference}`, reference: invoiceReference };
  }

  // Monnify authentication to get access token
  const auth = Buffer.from(`${MONNIFY_API_KEY}:${MONNIFY_SECRET_KEY}`).toString('base64');
  const authRes = await fetch(`${MONNIFY_BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
  });
  const authJson = await authRes.json();
  if (!authRes.ok) throw new Error('Monnify auth failed: ' + JSON.stringify(authJson));

  const token = authJson.response.accessToken;

  const payload = {
    amount,
    customerName,
    customerEmail,
    customerMobile: customerPhone,
    paymentDescription: 'Payment for service via Helpa',
    currencyCode: 'NGN',
    contractCode: MONNIFY_CONTRACT_CODE,
    invoiceReference,
  };

  const res = await fetch(`${MONNIFY_BASE_URL}/api/v2/merchant/transactions/init-transaction`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok) throw new Error('Monnify init transaction failed: ' + JSON.stringify(json));
  return { paymentUrl: json.response.paymentUrl, reference: json.response.transactionReference };
}

module.exports = { createPaymentLink };
