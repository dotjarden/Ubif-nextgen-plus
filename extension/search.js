(() => {
  'use strict';
  if (globalThis.__ubifPlusSearchStarted) return;
  globalThis.__ubifPlusSearchStarted = true;
  // A reinjected content script shares this document with the instance it
  // replaces; only the newest one owns the field, so an older copy can never
  // re-mount its own input next to the live one.
  const owner = `${Date.now()}-${Math.random()}`;
  document.documentElement.dataset.ubifPlusSearchOwner = owner;
  const owns = () => document.documentElement.dataset.ubifPlusSearchOwner === owner;
  const { categories, plan, rows } = globalThis.UBIFPlusSearch;
  const S = globalThis.UBIFPlusSettings;
  const fallback = { search: true, searchDebounceMs: 350, searchMinChars: 3, searchHotkey: true };
  let config = { ...fallback };
  const el = (tag, text, attrs = {}) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  };
  const style = el('style');
  style.textContent = `
    [data-ubif-native-search] { display:none!important }
    #ubif-universal-search { position:relative; width:100%; min-width:180px; max-width:640px; font:inherit; color:var(--aui-on-surface,#222); }
    #ubif-universal-search[data-ubif-slot=header] { flex:0 1 420px; width:auto; min-width:200px; max-width:520px; }
    #ubif-universal-search input { box-sizing:border-box; width:100%; min-height:48px; border:1px solid var(--aui-outline,#bbb); border-radius:12px; padding:12px 42px 12px 16px; font:inherit; color:inherit; background:var(--aui-elevated-level-01,#fff); }
    #ubif-universal-search input:focus { outline:2px solid var(--aui-primary,#8224ce); outline-offset:2px; }
    #ubif-universal-search button { font:inherit; color:inherit; cursor:pointer; }
    #ubif-search-clear { position:absolute; right:8px; top:8px; border:0; background:transparent; padding:6px; }
    #ubif-search-results { position:absolute; top:calc(100% + 8px); left:0; width:min(640px,calc(100vw - 32px)); box-sizing:border-box; max-height:70vh; overflow:auto; z-index:1100; padding:16px; border:1px solid var(--aui-outline,#ddd); border-radius:16px; background:var(--aui-elevated-level-03,#fff); box-shadow:0 8px 32px #0003; }
    #ubif-search-results[hidden] { display:none; }
    #ubif-search-results h3 { font:inherit; font-weight:bold; margin:16px 0 6px; }
    #ubif-search-results p { margin:6px 0; font-size:14px; }
    #ubif-search-results a { display:block; padding:10px; border-radius:8px; color:inherit; text-decoration:none; overflow-wrap:anywhere; }
    #ubif-search-results a:hover, #ubif-search-results a:focus { background:var(--aui-primary-container,#eee2f9); outline:2px solid var(--aui-primary,#8224ce); }
    #ubif-search-results .ubif-result-label { display:block; font-size:12px; font-weight:600; color:var(--aui-on-surface-soft,#5d5e61); margin-bottom:4px; }
    #ubif-search-results small { display:block; margin-top:4px; }
  `;
  document.head.append(style);
  const root = el('div', '', { id: 'ubif-universal-search', role: 'search', 'aria-label': 'Universal portal search' });
  const input = el('input', '', { type: 'search', placeholder: 'Search everything…', 'aria-label': 'Search customers, work orders, items, claims and serial numbers', autocomplete: 'off', maxlength: '200', 'aria-controls': 'ubif-search-results', 'aria-expanded': 'false' });
  const clear = el('button', '×', { id: 'ubif-search-clear', type: 'button', 'aria-label': 'Clear search' });
  const panel = el('div', '', { id: 'ubif-search-results', hidden: '', 'aria-label': 'Search results' });
  const status = el('p', '', { role: 'status', 'aria-live': 'polite' });
  root.append(input, clear, panel);
  let timer, controller, generation = 0, groups = [], composing = false, mounted = false;
  function open(value) { panel.hidden = !value; input.setAttribute('aria-expanded', String(value)); }
  function stop() { clearTimeout(timer); controller?.abort(); generation++; }
  function render() {
    panel.replaceChildren(status);
    if (!groups.length) { status.textContent = `Search all five categories. Enter at least ${config.searchMinChars} characters.`; return; }
    const count = groups.reduce((sum, g) => sum + g.rows.length, 0);
    const pending = groups.some(g => g.pending);
    status.textContent = `${pending ? 'Searching… ' : ''}${count} result${count === 1 ? '' : 's'}${groups.some(g => g.error) ? ' · Some searches could not finish' : ''}`;
    for (const group of groups) {
      const section = el('section', '', { 'aria-label': group.name });
      section.append(el('h3', `${group.name}${group.rows.length ? ` (${group.rows.length})` : ''}`));
      if (!group.active) section.append(el('p', group.name === 'Work orders' ? 'Enter a work order number (at least 5 digits).' : group.name === 'Claims' ? 'Claims need at least 6 characters.' : 'Enter an inventory serial, e.g. I-1234567890.'));
      for (const row of group.rows) {
        const link = el('a', row.title, { href: row.href });
        if (row.label) link.prepend(el('span', row.label, { class: 'ubif-result-label' }));
        if (row.detail) link.append(el('small', row.detail));
        section.append(link);
      }
      if (group.pending) section.append(el('p', 'Searching…'));
      else if (group.active && !group.rows.length && !group.error) section.append(el('p', 'No matches'));
      if (group.error) section.append(el('p', group.error));
      panel.append(section);
    }
    if (groups.some(g => g.error)) {
      const retry = el('button', 'Retry search', { type: 'button' });
      retry.onclick = () => search();
      panel.append(retry);
    }
  }
  async function search() {
    stop();
    const id = generation, query = input.value.trim(), requests = plan(query, config.searchMinChars);
    groups = categories.map(name => ({ name, rows: [], pending: requests.filter(r => r.category === name).length, active: requests.some(r => r.category === name), error: '' }));
    if (!requests.length) groups = [];
    render();
    if (!requests.length) return;
    controller = new AbortController();
    const currentController = controller;
    const timeout = setTimeout(() => currentController.abort(), 15000);
    const run = async request => {
      const group = groups.find(g => g.name === request.category);
      try {
        const response = await fetch(request.path, { method: request.body ? 'POST' : 'GET', credentials: 'same-origin', signal: currentController.signal, headers: { Accept: 'application/json', ...(request.body ? { 'Content-Type': 'application/json' } : {}) }, ...(request.body ? { body: JSON.stringify(request.body) } : {}), ubifPlusSearch: true });
        if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Your portal session or permissions need attention.' : 'Could not search this category. Try again.');
        const json = await response.json();
        const results = rows(request, json, query);
        if (id !== generation) return;
        const known = new Set(group.rows.map(r => r.key));
        group.rows.push(...results.filter(r => !known.has(r.key) && known.add(r.key)));
        // Native customer search also includes arrivals for a unique customer.
        if (request.kind === 'customers' && json.length === 1 && json[0].id != null) {
          group.pending++;
          render();
          await run({ category: request.category, kind: 'arrivals', path: `/api/customers/${encodeURIComponent(json[0].id)}/arrivals?isCrossStoreSearch=true` });
        }
      } catch (error) {
        if (id !== generation) return;
        group.error = error.name === 'AbortError' ? 'Search timed out. Try again.' : error.message === 'Your portal session or permissions need attention.' ? error.message : 'Could not search this category. Try again.';
      } finally {
        if (id === generation) { group.pending--; render(); }
      }
    };
    await Promise.all(requests.map(run));
    clearTimeout(timeout);
  }
  function changed() {
    stop(); groups = []; render(); open(true);
    if (!composing && input.value.trim().length >= config.searchMinChars) {
      status.textContent = 'Searching…'; timer = setTimeout(search, config.searchDebounceMs);
    }
  }
  input.addEventListener('input', changed);
  input.addEventListener('compositionstart', () => { composing = true; stop(); });
  input.addEventListener('compositionend', () => { composing = false; changed(); });
  input.addEventListener('focus', () => { render(); open(true); });
  clear.onclick = () => { input.value = ''; changed(); input.focus(); };
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') { open(false); input.focus(); open(false); }
    if (event.key === 'Enter' && event.target === input && !event.isComposing) { event.preventDefault(); open(true); search(); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const links = [...panel.querySelectorAll('a, button')];
      if (!links.length) return;
      event.preventDefault(); open(true);
      const index = links.indexOf(document.activeElement);
      links[(index + (event.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length].focus();
    }
  });
  document.addEventListener('pointerdown', event => { if (!root.contains(event.target)) open(false); });
  root.addEventListener('focusout', event => { if (!root.contains(event.relatedTarget)) open(false); });
  document.addEventListener('keydown', event => {
    if (config.searchHotkey && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && mounted) { event.preventDefault(); input.focus(); }
  });
  function mount() {
    if (!globalThis.document || !config.search || !owns()) return;
    // Observed portal header slot, shared by the collapsed and expanded search.
    const slot = document.querySelector('header .components-header-searchbox');
    if (!slot) return;
    for (const child of slot.children) {
      if (child !== root) child.setAttribute('data-ubif-native-search', '');
    }
    // The portal collapses that slot at some widths. Parking the field in the
    // visible header keeps a scanned query and its results on screen.
    const header = slot.closest('header');
    const target = (slot.getClientRects().length === 0 && header) ? header : slot;
    if (root.parentElement === target) { mounted = true; return; }
    if (mounted) { stop(); input.value = ''; groups = []; open(false); }
    target.prepend(root);
    root.dataset.ubifSlot = target === header ? 'header' : 'slot';
    mounted = true;
  }
  function unmount() {
    stop(); input.value = ''; groups = []; open(false);
    root.remove(); mounted = false;
    // Hand the portal's own search field back when the feature is switched off.
    for (const node of document.querySelectorAll('[data-ubif-native-search]')) node.removeAttribute('data-ubif-native-search');
  }
  function apply(next) {
    config = { ...fallback, ...(next || {}) };
    if (!owns()) return;
    if (config.search) mount(); else unmount();
  }
  /* Programmatic entry point for scanner.js: a scan lands in the field and is
     searched straight away, with no typing delay. Returns false when the
     feature is off or not mounted so the caller can leave the portal alone. */
  globalThis.UBIFPlusSearchUI = Object.freeze({
    run(value) {
      const query = String(value == null ? '' : value).trim();
      if (!config.search || !mounted || query.length < config.searchMinChars) return false;
      stop();
      groups = [];
      input.value = query.slice(0, Number(input.getAttribute('maxlength')) || 200);
      open(true);
      render();
      status.textContent = 'Searching…';
      input.focus();
      search();
      return true;
    }
  });
  new MutationObserver(() => { if (config.search) mount(); }).observe(document.body, { childList: true, subtree: true });
  // A window resize can collapse the portal's slot without touching the DOM.
  let resizeTimer;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (config.search) mount(); }, 150);
  });
  window.addEventListener('popstate', () => { stop(); input.value = ''; groups = []; open(false); });
  mount();
  // Settings arrive after the first paint so the default behavior is immediate.
  if (S) { S.get().then(apply, () => {}); S.subscribe(apply); }
})();
