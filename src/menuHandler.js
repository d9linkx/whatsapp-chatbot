import meta from './metaWhatsapp.js';
import { supabase } from './supabaseClient.js';

/**
 * Displays the main menu to the user with interactive buttons.
 * @param {object} context - The request context.
 * @param {string} [headerText] - Optional text to display before the menu.
 */
async function showMainMenu(context, headerText) {
  const { waPhone, name, saveSession } = context;

  // Reset session stage to the start
  await saveSession({ stage: 'menu' });

  const bodyText = "How can I help you today?";
  const text = headerText ? `${headerText}\n\n${bodyText}` : bodyText;

  // Using a List message to support 4 options (Buttons support max 3)
  const sections = [{
    title: 'Main Menu',
    rows: [
      { id: 'find_service', title: 'Find a Service', description: 'Browse available services' },
      { id: 'option:faq', title: 'FAQs', description: 'Frequently Asked Questions' },
      { id: 'option:contact_support', title: 'Contact Support', description: 'Talk to our team' },
      { id: 'ask_question', title: 'Ask a Question', description: 'Ask AI' }
    ]
  }];

  await meta.sendList(waPhone, 'Menu', text, 'Select Option', sections);
}

async function handleRequestService(context) {
  const { waPhone, name, session, saveSession } = context;
  try {
    // Fetch categories from services and businesses tables
    const { data: servicesData } = await supabase.from('services').select('category');
    const { data: businessesData } = await supabase.from('businesses').select('category');

    const serviceCats = (servicesData || []).map(s => s.category);
    const businessCats = (businessesData || []).map(b => b.category);
    const uniqueCategories = [...new Set([...serviceCats, ...businessCats].filter(Boolean))];
    
    const cats = uniqueCategories.slice(0, 3);
  
    session.stage = 'awaiting_category';
    await saveSession(session);
  
    const introText = `What service do you need ${name}?`;
    const buttons = cats.map(c => ({ id: `category:${c}`, title: c }));

    if (buttons.length === 0) {
      await meta.sendText(waPhone, "No services available at the moment.");
      return;
    }
    await meta.sendButtons(waPhone, introText, buttons);
  } catch (error) {
    console.error('Error in handleRequestService:', error);
    await meta.sendText(waPhone, "Sorry, I couldn't load the services right now.");
  }
}

async function handleSelectCategory(categoryId, context) {
  const { waPhone, session, saveSession } = context;
  session.category = categoryId;
  session.stage = 'awaiting_location';
  await saveSession(session);
  await meta.sendText(waPhone, `Where do you want this service delivered? (City in Nigeria)`);
}

async function handleLocationSearch(location, context) {
  const { waPhone, session } = context;
  const category = session.category;

  if (!category) {
    await meta.sendText(waPhone, "I'm not sure which service category you're looking for. Please select a service first.");
    await handleRequestService(context);
    return;
  }

  const { data: services } = await supabase
    .from('services')
    .select('*, helpas!inner(*)')
    .eq('category', category)
    .ilike('helpas.state', `%${location}%`)
    .limit(5);

  const { data: businesses } = await supabase
    .from('businesses')
    .select('*')
    .eq('category', category)
    .ilike('state', `%${location}%`)
    .limit(5);

  const foundServices = services || [];
  const foundBusinesses = businesses || [];

  if (foundServices.length === 0 && foundBusinesses.length === 0) {
    await meta.sendText(waPhone, `Sorry, I couldn't find any ${category} providers in ${location}. Please try another location.`);
    return;
  }

  await meta.sendText(waPhone, `Here are the available ${category} providers in ${location}:`);
  for (const s of foundServices) {
    const provider = s.helpas;
    const desc = (s.description || s.name || '').substring(0, 100);
    const price = s.price ? `₦${s.price}` : 'Contact for price';
    const cardText = `*${provider.business_name || provider.name}*\n${desc}\nPrice: ${price}`;
    const buttons = [{ id: `select_provider:${provider.id}`, title: 'Select' }];
    await meta.sendButtons(waPhone, cardText, buttons);
  }

  for (const b of foundBusinesses) {
    const desc = (b.description || 'Service available').substring(0, 100);
    const price = b.price ? `₦${b.price}` : 'Contact for price';
    const cardText = `*${b.business_name || b.name}*\n${desc}\nPrice: ${price}`;
    const buttons = [{ id: `select_provider:${b.id}`, title: 'Select' }];
    await meta.sendButtons(waPhone, cardText, buttons);
  }
}

export { showMainMenu, handleRequestService, handleSelectCategory, handleLocationSearch };