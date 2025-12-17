import meta from './metaWhatsapp.js';

/**
 * Displays the main menu to the user with interactive buttons.
 * @param {object} context - The request context.
 * @param {string} [headerText] - Optional text to display before the menu.
 */
async function showMainMenu(context, headerText) {
  const { waPhone, saveSession } = context;

  // Reset session stage to the start
  await saveSession({ stage: 'start' });

  const bodyText = "How can I help you today?";
  const text = headerText ? `${headerText}\n\n${bodyText}` : bodyText;

  const buttons = [
    { id: 'find_service', label: 'Find a service' },
    { id: 'buy_item', label: 'Buy an item' },
    { id: 'ask_question', label: 'Ask a question' },
  ];

  await meta.sendButtons(waPhone, text, buttons);
}

export { showMainMenu };