/* Desktop notifications for the UBIF support chat.
 *
 * The conversation lives inside the portal page, so the content script only
 * tells us that a message landed while the chat was minimized or the tab was
 * in the background; the operating system does the actual telling. One
 * notification is kept in place and refreshed as further messages arrive, and
 * it is withdrawn the moment the chat is back in front of the user. */
const ID = 'ubif-plus-support-chat';

/* Samsung exception forms. A work order tab asks for the Sprinklr form; the
   worker opens it (a fixed URL, never one supplied by a page) and keeps the
   validated values in session storage under the new tab's id. Session storage
   is unreadable from content scripts, so only the filler in that same tab can
   read them, through a message, until it reports back or they expire. */
importScripts('samsung-model.js');
const SAMSUNG = globalThis.UBIFPlusSamsung;
const PORTAL_ORIGIN = 'https://portal.ubreakifix.net';
const jobKey = tabId => `ubif-plus.samsung-job.${tabId}`;
const session = chrome.storage && chrome.storage.session;
const origin = url => { try { return new URL(url).origin; } catch { return ''; } };

async function openSamsungForm(request) {
  const job = SAMSUNG.job(request.form, request.values, request.autoSubmit);
  if (!job) return { ok: false, error: 'Some required details are missing.' };
  const tab = await chrome.tabs.create({ url: SAMSUNG.FORM_URL, active: true });
  await session.set({ [jobKey(tab.id)]: job });
  return { ok: true };
}

async function claimSamsungJob(tabId) {
  const key = jobKey(tabId);
  const job = (await session.get(key))[key];
  if (!job) return null;
  if (!(Date.now() - job.createdAt < SAMSUNG.JOB_TTL_MS)) { await session.remove(key); return null; }
  return job;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string' || !message.type.startsWith('ubif-plus-samsung-')) return;
  const from = origin(sender.url || sender.tab?.url || '');
  const tabId = sender.tab?.id;
  let work = null;
  if (message.type === 'ubif-plus-samsung-open' && from === PORTAL_ORIGIN) work = openSamsungForm(message);
  // The filler keeps the job until it reports back, so a reload mid-fill can
  // resume; the job expires after JOB_TTL_MS either way.
  else if (message.type === 'ubif-plus-samsung-job' && from === SAMSUNG.FORM_ORIGIN && tabId !== undefined) work = claimSamsungJob(tabId).then(job => ({ ok: true, job }));
  else if (message.type === 'ubif-plus-samsung-done' && from === SAMSUNG.FORM_ORIGIN && tabId !== undefined) work = session.remove(jobKey(tabId)).then(() => ({ ok: true }));
  if (!work) { sendResponse({ ok: false, error: 'Not allowed here.' }); return; }
  work.then(sendResponse, error => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});

chrome.tabs.onRemoved.addListener(tabId => { session.remove(jobKey(tabId)).catch(() => {}); });

/* Portal features link into the settings page at a card or tab, such as
   #samsung or #templates/notes. Content scripts cannot open extension pages
   themselves. */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'ubif-plus-open-settings') return;
  const hash = typeof message.hash === 'string' && /^#[\w\-/]{0,60}$/.test(message.hash) ? message.hash : '';
  if (origin(sender.url || sender.tab?.url || '') !== PORTAL_ORIGIN) { sendResponse({ ok: false }); return; }
  chrome.tabs.create({ url: chrome.runtime.getURL(`options.html${hash}`) }).then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
  return true;
});

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
    if (message.desktop === false || message.hidePreview) chrome.notifications.clear(ID, () => { void chrome.runtime.lastError; });
    if (chrome.action && chrome.action.setBadgeText) chrome.action.setBadgeText({ text: message.badge !== false && message.unread > 0 ? (message.unread > 99 ? '99+' : String(message.unread)) : '' });
  } else if (message.type === 'ubif-plus-chat-seen') {
    chrome.notifications.clear(ID, () => { void chrome.runtime.lastError; });
    if (chrome.action && chrome.action.setBadgeText) chrome.action.setBadgeText({ text: '' });
  }
});

if (chrome.action && chrome.action.setBadgeBackgroundColor) {
  chrome.action.setBadgeBackgroundColor({ color: '#8224ce' });
}
