const { supabase } = require('./supabaseClient');
const meta = require('./metaWhatsapp');
const { createPaymentLink } = require('./monnifyClient');

/**
 * Fetches a provider by ID and handles the case where the provider is not found.
 * @param {string} providerId - The UUID of the provider.
 * @param {object} context - The handler context.
 * @returns {object|null} The provider data or null if not found.
 */
async function getProviderById(providerId, context) {
  const { data: provider, error } = await supabase.from('providers').select('*').eq('id', providerId).single();

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

  const sections = [{ title: 'Service categories', rows: cats.map(c => ({ id: `category:${c.label}`, title: c.label })) }];
  sections[0].rows.push({ id: 'category:manual', title: 'Type it in the chat' });
  await meta.sendList(waPhone, `Hi ${name}`, 'Choose a service category or type the service you want.', 'Choose category', sections);
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
    await meta.sendText(waPhone, `*${provider.business_name}* has been notified. They will contact you shortly to discuss pricing.`);
    await saveSession({ stage: 'menu' });
    return;
  }

  const paymentDetails = {
    amount: price,
    customerName: userData.full_name,
    customerEmail: userData.email || `${cleanPhone}@chatapp.com`,
    paymentDescription: `Payment for ${serviceName} by ${provider.business_name}`,
  };
  const { paymentUrl, reference } = await createPaymentLink(paymentDetails);

  await meta.sendText(waPhone, `Great! To confirm your booking for *${serviceName}* with *${provider.business_name}* for *₦${price}*, please complete the payment below.`);
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

  let detailsMessage = `*More Details for ${provider.business_name}*\n\n*Services:* ${provider.services || 'N/A'}\n*Typical Availability:* ${provider.timing || 'N/A'}\n\n${provider.description || 'No additional details available.'}`;
  await meta.sendText(waPhone, detailsMessage);
}

async function handleListReply(selectedId, context) {
  const { waPhone, session, saveSession } = context;

  if (selectedId.startsWith('category:')) {
    const category = selectedId.split(':')[1];
    await saveSession({ stage: 'awaiting_service', category });
    await meta.sendText(waPhone, `You picked *${category}*. Please type the service you want or choose from the list.`);

    const { data: services } = await supabase.from('services').select('id,name,description').ilike('category', `%${category}%`).limit(10);
    if (services && services.length) {
      const rows = [{ title: 'Suggested services', rows: services.map(s => ({ id: `service:${s.id}`, title: s.name, description: s.description })) }];
      await meta.sendList(waPhone, `Services in ${category}`, 'Choose a service or type your own.', 'Choose service', rows);
    }
  }

  if (selectedId.startsWith('state:')) {
    const state = selectedId.split(':')[1];
    const service = session.serviceQuery;
    if (!service) {
      await meta.sendText(waPhone, 'I did not find which service you want. Please type the service name.');
      return;
    }

    const { data: providers } = await supabase.from('providers').select('*').ilike('services', `%${service}%`).ilike('state', `%${state}%`).limit(20);
    if (!providers || !providers.length) {
      await meta.sendText(waPhone, `No providers found for ${service} in ${state}.`);
      return;
    }

    for (const p of providers) {
      const body = `*${p.business_name}*\nPrice: ${p.price || 'N/A'}\nServices: ${p.services || ''}\nTiming: ${p.timing || 'N/A'}`;
      await meta.sendButtons(waPhone, body, [{ id: `select_provider:${p.id}`, label: 'Select & Pay' }, { id: `view_provider:${p.id}`, label: 'More details' }]);
    }
    session.state = state;
    await saveSession(session);
  }
}

const buttonHandlers = {
  'request_service': handleRequestService,
  'transactions': handleViewTransactions,
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

module.exports = handleInteractiveMessage;