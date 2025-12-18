import { supabase } from './supabaseClient.js';
import meta from './metaWhatsapp.js';
import handleTextMessage from './textHandler.js';
import { createPaymentLink } from './monnifyClient.js';

/**
 * Fetches a provider by ID and handles the case where the provider is not found.
 * @param {string} providerId - The UUID of the provider.
 * @param {object} context - The handler context.
 * @returns {object|null} The provider data or null if not found.
 */
async function getProviderById(providerId, context) {
  const { data: provider, error } = await supabase.from('helpa').select('*').eq('id', providerId).single();

  if (error || !provider) {
    console.error('Error fetching provider:', error);
    await meta.sendText(context.waPhone, 'Sorry, I had trouble finding that provider. Please try again.');
    return null;
  }
  return provider;
}

async function handleRequestService(context) {
  const { waPhone, name, session, saveSession } = context;
  const { data: categories } = await supabase.rpc('distinct_service_categories');
  const cats = (categories || []).map(c => ({ id: `cat_${c}`, label: c }));
 
  session.stage = 'awaiting_category';
  await saveSession(session);
 
  const introText = `Awesome! To help you find exactly what you need, here are some popular service categories available across Nigeria. If you don't see what you're looking for, no worries, you can always type it in!`;
  const sections = [{ title: 'Popular Categories', rows: cats.map(c => ({ id: `category:${c.label}`, title: c.label })) }];
  sections[0].rows.push({ id: 'category:manual', title: 'Type it in the chat' });
  await meta.sendList(waPhone, 'Find a Service', introText, 'Choose a category', sections);
}

async function handleBuyItem(context) {
  const { waPhone, saveSession } = context;
  await saveSession({ stage: 'buy_item_start' });
  // TODO: Implement the "Buy an item" flow.
  await meta.sendText(waPhone, "This feature is coming soon! For now, you can find a service or ask a question.");
}

async function handleAskQuestion(context) {
  const { waPhone, saveSession } = context;
  await saveSession({ stage: 'ask_question_start' });
  await meta.sendText(waPhone, "Of course, what would you like to know? Just type your question.");
}

async function handleViewTransactions(context) {
  const { waPhone, userData } = context;
  await meta.sendText(waPhone, 'Looking up your recent transactions...');
  const { data: userTransactions, error } = await supabase
    .from('transactions')
    .select('*, providers(business_name)')
    .eq('user_id', userData.id)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('Error fetching transactions:', error);
    await meta.sendText(waPhone, 'Sorry, I had trouble fetching your transaction history.');
    return;
  }

  if (!userTransactions || userTransactions.length === 0) {
    await meta.sendText(waPhone, 'You have no past transactions.');
    return;
  }

  let historyMessage = 'Here are your last 5 transactions:\n\n';
  userTransactions.forEach(tx => {
    const providerName = tx.providers ? tx.providers.business_name : 'N/A';
    historyMessage += `*Service:* ${tx.service_details.serviceName}\n*Provider:* ${providerName}\n*Amount:* ₦${tx.amount}\n*Date:* ${new Date(tx.created_at).toLocaleDateString()}\n*Status:* ${tx.status}\n\n`;
  });
  await meta.sendText(waPhone, historyMessage.trim());
}

async function handleSelectProvider(providerId, context) {
  const { waPhone, name, session, saveSession, userData, cleanPhone } = context;
  const provider = await getProviderById(providerId, context);
  if (!provider) return;

  const serviceName = session.serviceQuery || 'the requested service';
  const price = provider.price;

  if (!price || isNaN(parseFloat(price))) {
    await meta.sendText(waPhone, `*${provider.name}* has been notified. They will contact you shortly to discuss pricing.`);
    await saveSession({ stage: 'menu' });
    return;
  }

  const paymentDetails = {
    amount: price,
    customerName: userData.full_name,
    customerEmail: userData.email || `${cleanPhone}@chatapp.com`,
    paymentDescription: `Payment for ${serviceName} by ${provider.name}`,
  };
  const { paymentUrl, reference } = await createPaymentLink(paymentDetails);

  await meta.sendText(waPhone, `Great! To confirm your booking for *${serviceName}* with *${provider.name}* for *₦${price}*, please complete the payment below.`);
  await meta.sendText(waPhone, paymentUrl);

  session.stage = 'awaiting_payment';
  session.provider_id = providerId;
  session.serviceName = serviceName;
  session.price = price;
  session.paymentReference = reference;
  await saveSession(session);
}

async function handleViewProvider(providerId, context) {
  const { waPhone } = context;
  const provider = await getProviderById(providerId, context);
  if (!provider) return;

  let detailsMessage = `*More Details for ${provider.name}*\n\n*Description:* ${provider.description || 'N/A'}\n*Price:* ${provider.price || 'Contact for price'}`;
  await meta.sendText(waPhone, detailsMessage);
}

async function handleListReply(selectedId, context) {
  const { waPhone, session, saveSession } = context;
  let userResponse;

  if (selectedId.startsWith('category:')) {
    const category = selectedId.substring('category:'.length);
    userResponse = `I'm interested in the "${category}" category.`;
  } else if (selectedId.startsWith('service:')) {
    const serviceName = selectedId.substring('service:'.length);
    userResponse = `I'd like to request the service: "${serviceName}".`;
  }

  if (userResponse) {
    // Pass the constructed user response to the text handler to be processed by the AI
    await handleTextMessage(userResponse, context);
  }
}

async function handleTransactionAction(context, type) {
  const { waPhone, saveSession, userData } = context;
  // Generate a 6-digit code
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  
  // In a real app, send this via email provider. Here we simulate/log it.
  console.log(`[EMAIL SERVICE] Sending ${type} code ${code} to ${userData.email || 'user email'}`);
  
  await meta.sendText(waPhone, `To verify this action, we've sent a confirmation code to your registered email.\n\nPlease enter the 6-digit code here.`);
  
  await saveSession({ ...context.session, stage: 'awaiting_confirmation_code', confirmationCode: code, confirmationType: type });
}

const buttonHandlers = {
  'find_service': handleRequestService,
  'buy_item': handleBuyItem,
  'ask_question': handleAskQuestion,
  'transactions': handleViewTransactions,
  'confirm_transaction': (ctx) => handleTransactionAction(ctx, 'confirm'),
  'appeal_transaction': (ctx) => handleTransactionAction(ctx, 'appeal'),
};

const dynamicButtonHandlers = [
  { prefix: 'select_provider:', handler: handleSelectProvider },
  { prefix: 'view_provider:', handler: handleViewProvider },
];

async function handleButtonReply(replyId, context) {
  const staticHandler = buttonHandlers[replyId];
  if (staticHandler) return staticHandler(context);

  const dynamicHandler = dynamicButtonHandlers.find(h => replyId.startsWith(h.prefix));
  if (dynamicHandler) return dynamicHandler.handler(replyId.substring(dynamicHandler.prefix.length), context);
}

async function handleInteractiveMessage(interactive, context) {
  if (interactive.type === 'button_reply') {
    await handleButtonReply(interactive.button_reply.id, context);
  } else if (interactive.type === 'list_reply') {
    await handleListReply(interactive.list_reply.id, context);
  }
}

export default handleInteractiveMessage;