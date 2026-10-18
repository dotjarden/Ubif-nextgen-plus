/* Adds templates to the Portal's customer message composer; sending remains
 * the Portal's own workflow. Only template definitions are saved locally. */
(() => {
  'use strict';
  if (globalThis.__ubifPlusMessages) return;
  globalThis.__ubifPlusMessages = true;
  const M = globalThis.UBIFPlusMessageModel;
  if (!M) return;
  const KEY = 'ubif-plus.message-templates.v1';
  const SEED = 'ubif-plus.rt-templates.v1';
  const S = globalThis.UBIFPlusSettings;
  let config = { messages: true, messageShortcuts: true };
  const area = globalThis.chrome?.storage?.local;
  let shared = null;
  let templates = M.sanitize(), loaded = false, panel = null, host = null, context = {}, contextState = 'unavailable', currentId = '', requestId = '', generation = 0;
  let refreshPreview = () => {}, updateSettingsUI = () => {}, pending = false, suspended = false;
  const el = (tag, text, attrs = {}) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    return node;
  };
  function findPanel() {
    // The actual shared ChatPanel is a styled div, titled with the customer's
    // name. Its native form's Send message action is the stable DOM contract.
    const send = document.querySelector('form button[aria-label="Send message"]');
    const native = send?.closest('form')?.parentElement;
    if (native && composer(native) && getComputedStyle(native).display !== 'none') return native;
    const candidates = document.querySelectorAll('[data-message-sidebar], app-messages, app-messaging, app-workorder-messages, aside, [role="dialog"], mat-drawer, mat-sidenav, .offcanvas, .sidebar');
    return [...candidates].find(node => {
      if (node.closest('#amazon-connect-widget-frame') || node.hidden || node.getAttribute('aria-hidden') === 'true' || getComputedStyle(node).display === 'none') return false;
      const named = node.matches('[data-message-sidebar], app-messages, app-messaging, app-workorder-messages');
      const heading = [...node.querySelectorAll('h1,h2,h3,h4,[role="heading"],.sidebar-title,.offcanvas-title')].some(h => /^messages?(?:\s|$)/i.test(h.textContent.trim()));
      return (named || heading) && !!composer(node);
    }) || null;
  }
  function composer(node) {
    return [...node.querySelectorAll('textarea, [contenteditable="true"][role="textbox"]')].find(input => !input.closest('[data-ubif-message-templates]') && !input.hidden && getComputedStyle(input).display !== 'none');
  }
  function identity() {
    if (shared) return shared.open ? shared.key : '';
    const match = location.pathname.match(/^\/repair\/workorder\/(\d+)\/?$/);
    const id = match?.[1] || panel?.getAttribute('data-workorder-id') || '';
    return /^\d+$/.test(id) ? id : '';
  }
  async function loadContext() {
    const id = identity();
    if (id !== currentId) { currentId = id; context = shared?.open ? M.data(shared.record) : {}; contextState = shared?.open ? 'ready' : id ? 'loading' : 'unavailable'; requestId = ''; generation++; refreshPreview(true); }
    if (!id || requestId === id) return;
    requestId = id;
    const orderId = shared ? String(shared.record?.workorderId || '') : id;
    if (!/^\d+$/.test(orderId)) return;
    const version = generation;
    contextState = 'loading'; refreshPreview();
    try {
      const response = await fetch(`/api/workorder/${orderId}`, { credentials: 'same-origin', cache: 'no-store', ubifPlusBoard: true });
      if (!response.ok) throw new Error('Could not load order');
      const json = await response.json();
      if (version !== generation || identity() !== id) return;
      if (String(json?.workorder?.workorderId) !== orderId) throw new Error('Different order returned');
      const owner = json.workorder.CustomerDevice?.customerId || json.workorder.customer?.customerId;
      if (shared?.customerId && owner && String(owner) !== shared.customerId) throw new Error('Different customer returned');
      context = M.data(json.workorder);
      if (shared?.open) for (const [key, value] of Object.entries(M.data(shared.record))) if (value) context[key] = value;
      // The Portal loads this separately from the workorder response. Read
      // only its linked arrival, never another appointment for this customer.
      if (['appointment.date', 'device.model', 'device.issues', 'customer.email'].some(key => !context[key])) {
        try {
          const arrivalResponse = await fetch(`/api/workorder/${orderId}/arrival`, { credentials: 'same-origin', cache: 'no-store', ubifPlusBoard: true });
          if (arrivalResponse.ok) {
            const body = await arrivalResponse.json(), arrival = body?.arrival || body;
            if (version !== generation || identity() !== id) return;
            const owner = arrival?.customer?.customerId || arrival?.customerId;
            if (arrival && (!arrival.workorderId || String(arrival.workorderId) === orderId) &&
                (!shared?.customerId || !owner || String(owner) === shared.customerId)) {
              for (const [key, value] of Object.entries(M.data(arrival))) if (value && !context[key]) context[key] = value;
            }
          }
        } catch { /* A workorder can have no linked arrival. Keep its data. */ }
      }
      if (version !== generation || identity() !== id) return;
      const customerId = owner || shared?.customerId, clientId = json.workorder.clientId;
      if (/^\d+$/.test(String(customerId)) && /^\d+$/.test(String(clientId)) &&
          ['customer.name', 'customer.phone', 'customer.email'].some(key => !context[key])) {
        try {
          const response = await fetch(`/api/customers/${customerId}?clientId=${clientId}`, { credentials: 'same-origin', cache: 'no-store', ubifPlusBoard: true });
          if (response.ok) {
            const customer = await response.json();
            if (version !== generation || identity() !== id) return;
            const returnedId = customer?.customerData?.customerId || customer?.customer?.customerId;
            if (String(returnedId) === String(customerId)) {
              for (const [key, value] of Object.entries(M.data(customer))) if (value && !context[key]) context[key] = value;
            }
          }
        } catch { /* Keep the selected workorder and arrival details. */ }
      }
      if (version !== generation || identity() !== id) return;
      contextState = 'ready'; refreshPreview();
    } catch { if (version === generation) { context = shared?.open ? M.data(shared.record) : {}; contextState = shared?.open ? 'ready' : 'unavailable'; refreshPreview(); } }
  }
  function mount() {
    if (suspended || !loaded || !document.body) return;
    if (config.messages === false) { host?.remove(); host = null; panel = null; generation++; return; }
    const next = findPanel();
    if (next !== panel || host && !host.isConnected) {
      host?.remove(); panel = next; host = null; currentId = ''; requestId = ''; context = {}; generation++;
      if (panel) {
        host = el('div', '', { 'data-ubif-message-templates': '' });
        const input = composer(panel), form = input.closest('form');
        (form && form.parentElement === panel ? form : input).before(host);
        host.attachShadow({ mode: 'open' }); paint();
      }
    }
    if (panel && host) {
      const input = composer(panel), form = input?.closest('form');
      const anchor = form && form.parentElement === panel ? form : input;
      // React may insert the refreshed conversation after our unmanaged host.
      if (anchor && (host.parentElement !== anchor.parentElement || host.nextElementSibling !== anchor)) anchor.before(host);
      loadContext();
    }
  }
  function schedule() {
    if (suspended || pending) return;
    pending = true;
    queueMicrotask(() => { pending = false; mount(); });
  }
  function paint() {
    const ui = globalThis.UBIFPlusMessageUI.create(host.shadowRoot, {
      model: M,
      getTemplates: () => templates,
      getShortcuts: () => config.messageShortcuts !== false,
      getHeight: view => {
        const top = host.getBoundingClientRect().top - panel.getBoundingClientRect().top;
        const header = panel.firstElementChild === host ? 0 : panel.firstElementChild?.getBoundingClientRect().height || 0;
        return top > 0 ? Math.max(100, Math.min(420, top - header - 64 - (view === 'editor' ? 56 : 0))) : 360;
      },
      getContext: () => ({ key: currentId, values: { ...context, 'employee.firstName': globalThis.UBIFPlusEmployee?.firstName || config.employeeFirstName || '' }, loading: contextState === 'loading' }),
      openSettings: () => { try { chrome.runtime.sendMessage({ type: 'ubif-plus-open-settings', hash: '#templates/messages' }).catch?.(() => {}); } catch {} },
      getDraft: () => { const input = composer(panel); return input?.tagName === 'TEXTAREA' ? input.value : input?.textContent || ''; },
      save: async next => {
        if (!area) throw new Error('Template storage unavailable');
        await area.set({ [KEY]: next }); templates = next;
      },
      use: (text, mode) => {
        if (identity() !== currentId) { loadContext(); return 'The customer changed. Choose your template again.'; }
        const input = composer(panel);
        if (!input || input.disabled || input.readOnly) return 'Messaging is disabled for this customer by the Portal.';
        if (!text.trim()) return 'Add a message before using this template.';
        if (text.includes('{{') || text.includes('}}')) return 'Remove unrecognized details before using this template.';
        const old = input.tagName === 'TEXTAREA' ? input.value : input.textContent;
        const value = mode === 'append' && old.trim() ? `${old}\n\n${text}` : text;
        if (input.maxLength > 0 && value.length > input.maxLength) return 'This message is too long for the message box. Shorten your template.';
        if (input.tagName === 'TEXTAREA') {
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, value);
          input.setSelectionRange(value.length, value.length);
        } else input.textContent = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true })); input.focus();
        return '';
      }
    });
    refreshPreview = reset => ui.update(reset);
    updateSettingsUI = () => ui.updateSettings();
  }
  const start = () => {
    loaded = true; schedule();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'aria-hidden', 'data-workorder-id'] });
    // Client-side navigation may keep the same sidebar mounted.
    setInterval(schedule, 1000);
    addEventListener('popstate', schedule);
    addEventListener('pagehide', () => { suspended = true; generation++; });
    addEventListener('pageshow', () => { suspended = false; requestId = ''; schedule(); });
    window.postMessage({ source: 'ubif-plus', type: 'message-context-request' }, '*');
  };
  addEventListener('message', event => {
    const value = event.data;
    if (event.source !== window || value?.source !== 'ubif-plus' || value.type !== 'message-context' || typeof value.key !== 'string') return;
    const changed = !shared || shared.key !== value.key || shared.open !== value.open;
    shared = value;
    if (changed) { currentId = ''; requestId = ''; context = {}; generation++; }
    else if (value.open) {
      context = value.record?.workorderId
        ? { ...context, ...Object.fromEntries(Object.entries(M.data(value.record)).filter(([, text]) => text)) }
        : M.data(value.record);
      refreshPreview();
    }
    schedule();
  });
  const applySettings = next => {
    const changed = config.messageShortcuts !== next.messageShortcuts;
    config = next; schedule(); refreshPreview();
    if (host && changed) updateSettingsUI();
  };
  if (S) { S.subscribe(applySettings); S.get().then(applySettings, () => {}); }
  addEventListener('ubif-plus-employee', () => refreshPreview());
  if (globalThis.chrome?.storage?.onChanged) chrome.storage.onChanged.addListener((changes, scope) => {
    if (scope === 'local' && changes[KEY]) { templates = M.sanitize(changes[KEY].newValue); if (host) updateSettingsUI(); }
  });
  if (area) area.get([KEY, SEED]).then(async value => {
    templates = M.sanitize(value?.[KEY]);
    if (!value?.[SEED]) {
      for (const row of M.defaults.filter(row => row.id.startsWith('rt-'))) if (!templates.some(t => t.id === row.id)) templates.push({ ...row });
      await area.set({ [KEY]: templates, [SEED]: true });
    }
    start();
  }).catch(start);
  else start();
})();
