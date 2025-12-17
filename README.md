# WhatsApp Chatbot (Twilio + Supabase)

This project is a simple WhatsApp chatbot webhook that checks whether an incoming sender's phone number exists in a Supabase `users` table. If the phone is found the bot addresses the user by the stored name and asks what they need; otherwise it asks for the user's name.

Features
- Express webhook endpoint (/webhook) for incoming WhatsApp messages (designed for Twilio's WhatsApp integration)
- Supabase client for user lookup
- Reply sent via Twilio API (configurable via env vars)

Getting started

1) Copy environment template

   cp .env.example .env

2) Fill in your Supabase and Twilio credentials in `.env`.

3) Install dependencies

   npm install

4) Start server

   npm start

Exposing your local server to Twilio

Use ngrok (or similar) to expose your local server to the internet and configure Twilio's webhook to point to:

   https://<your-ngrok>.ngrok.io/webhook

Twilio webhook configuration (for WhatsApp sandbox or numbers) expects an HTTP POST.

Supabase schema

Create a `users` table with at minimum the columns:

- id (uuid)
- auth_id (uuid) — optional, if you link to Supabase Auth
- full_name (text) — user's display name
- email (text) — optional
- phone (text) — store phone numbers without leading plus sign, e.g. `2348012345678`
- created_at (timestamptz)

Example SQL (Supabase SQL editor):

```
create table users (
   id uuid default gen_random_uuid() primary key,
   auth_id uuid,
   full_name text,
   email text,
   phone text unique,
   created_at timestamptz default now()
);
```

How it works

- An incoming message from Twilio contains `From` like `whatsapp:+123...` and `Body`.
- The server extracts the phone and queries Supabase `users` where phone = `<digits>`.
- If found: reply "Hi <name>, what can I help you with today?"
- If not found: reply "Welcome! I don't have your name on record. What's your name?"

Note: this project now uses Meta WhatsApp Cloud API instead of Twilio. The webhook listens for Meta's incoming messages format and replies using interactive messages (buttons and lists) when possible.

Flow implemented
- On first message: check `users` table by phone. If found — greet by name and present main options:
   - Buy an item
   - Request a service
   - General Inquiry
   - Transactions
- If user chooses "Request a service": present service categories (from `services` table) or let the user type the service name.
- Once a service is chosen (button or typed), ask user to pick a Nigerian state (list of 36 states + FCT).
- After state selection, search `providers` table for providers offering the service in that state and display providers as messages with buttons to "Select this provider" or "More details".
- When a provider is selected, the bot generates a Monnify payment link (or a test link if Monnify creds missing) and sends it to the user, warning that funds will be held in escrow and the provider will be notified.
- When the provider marks the job complete (this repo leaves an endpoint placeholder or provider-notify flow), the bot asks the user to confirm completion; if user confirms, proceed to release funds (integration with Monnify disbursement not implemented — placeholder).

Next steps / improvements

- Persist conversational state (e.g., when asking for the user's name, save a pending state and create the user when they reply)
- Support Meta WhatsApp Cloud API in addition to Twilio
- Add product catalog and simple checkout flows
- Add unit tests and CI

Credentials required (what to provide)
- Supabase:
   - SUPABASE_URL
   - SUPABASE_KEY (service role or anon key — for server use the service role if you need elevated privileges; otherwise the anon key for read/write as configured)

- Meta (WhatsApp Cloud API):
   - META_WHATSAPP_TOKEN (Page access token / Bearer token)
   - META_WHATSAPP_PHONE_NUMBER_ID (phone number ID from the WhatsApp business account)
   - META_VERIFY_TOKEN (A secret string you create to verify the webhook with Meta)
   - META_APP_SECRET (Your app's secret from the Meta dashboard to validate incoming webhooks)

- Monnify:
   - MONNIFY_API_KEY
   - MONNIFY_SECRET_KEY
   - MONNIFY_CONTRACT_CODE
   - MONNIFY_BASE_URL (optional; default https://api.monnify.com)

- OpenAI / LLM (optional):
   - OPENAI_API_KEY
   - OPENAI_MODEL (optional; default set in code)
   - OPENAI_API_URL (optional; if using a proxy or alternate provider)

Database schema notes
- `users` table: `id`, `auth_id`, `full_name`, `email`, `phone`, `created_at`
- `services` table: `id`, `name`, `category`, `description`
- `providers` table: `id`, `business_name`, `phone`, `state`, `services` (text list or JSON), `price`, `timing`, `details`

Placeholders and limitations
- Monnify integration here initializes a transaction and returns a payment URL — actual escrow and release flows require server-to-server disbursement setup with Monnify and are not implemented in this demo.
- Provider notifications are implemented by sending a message to the provider's phone via Meta only if you store provider phone numbers in the `providers` table and have Meta credentials.
