/* Desktop notifications for the UBIF support chat.
 *
 * The conversation lives inside the portal page, so the content script only
 * tells us that a message landed while the chat was minimized or the tab was
 * in the background; the operating system does the actual telling. One
 * notification is kept in place and refreshed as further messages arrive, and
 * it is withdrawn the moment the chat is back in front of the user. */
const ID = 'ubif-plus-support-chat';

chrome.runtime.onMessage.addListener(message => {
  if (!message || typeof message.type !== 'string') return;
  if (message.type === 'ubif-plus-chat-message') {
    if (message.desktop !== false) chrome.notifications.create(ID, {
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title: 'UBIF support',
      message: message.text || 'UBIF support has a new message',
      priority: 1,
      eventTime: Date.now()
    }, () => { void chrome.runtime.lastError; });
    if (message.badge !== false && message.unread > 0 && chrome.action && chrome.action.setBadgeText) {
      chrome.action.setBadgeText({ text: message.unread > 99 ? '99+' : String(message.unread) });
    }
  } else if (message.type === 'ubif-plus-chat-preferences') {
    if (message.desktop === false) chrome.notifications.clear(ID, () => { void chrome.runtime.lastError; });
    if (message.badge === false && chrome.action && chrome.action.setBadgeText) chrome.action.setBadgeText({ text: '' });
  } else if (message.type === 'ubif-plus-chat-seen') {
    chrome.notifications.clear(ID, () => { void chrome.runtime.lastError; });
    if (chrome.action && chrome.action.setBadgeText) chrome.action.setBadgeText({ text: '' });
  }
});

if (chrome.action && chrome.action.setBadgeBackgroundColor) {
  chrome.action.setBadgeBackgroundColor({ color: '#8224ce' });
}
