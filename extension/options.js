/* Full settings page: groups of feature cards, search that jumps to a setting,
   a "changed" filter, deep links (#samsung, #templates/notes), the templates
   hub, saved layouts and store emails, backup and reset. Control binding
   lives in settings-ui.js; the template and shortcut editors live in
   settings-editors.js. */
(() => {
  'use strict';
  const S = globalThis.UBIFPlusSettings;
  const UI = globalThis.UBIFPlusSettingsUI;
  const T = globalThis.UBIFPlusNoteTemplates;
  const H = globalThis.UBIFPlusHotkeys;
  const MM = globalThis.UBIFPlusMessageModel;
  if (!S || !UI) return;
  const LAYOUTS = 'ubif-plus.columns.v1.';
  const STORE_EMAILS = 'ubif-plus.samsung.store-emails.v1';
  const MESSAGES = 'ubif-plus.message-templates.v1';
  const local = () => (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) || null;
  const $ = id => document.getElementById(id);
  const el = (tag, text = '', attrs = {}) => {
    const node = document.createElement(tag); node.textContent = text;
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  };

  const groups = [...document.querySelectorAll('main .group')];
  const navLinks = [...document.querySelectorAll('nav [data-group]')];
  const search = $('settings-search');
  const changedButton = $('changed-only');
  const status = $('ubif-status');
  let selected = 'general', changedOnly = false, current = null;

  const binder = UI.bind({ status, onChange: settings => { current = settings; countChanges(); if (changedOnly) applyChangedFilter(); } });

  /* ---------- Navigation ---------- */
  const groupOf = node => node?.closest('.group')?.dataset.group || '';
  function showGroup(id) {
    selected = groups.some(g => g.dataset.group === id) ? id : 'general';
    for (const group of groups) group.hidden = group.dataset.group !== selected;
    for (const link of navLinks) {
      if (link.dataset.group === selected) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    }
  }
  function flash(node) {
    if (!node) return;
    node.removeAttribute('data-flash');
    void node.offsetWidth;
    node.setAttribute('data-flash', '');
    setTimeout(() => node.removeAttribute('data-flash'), 1700);
  }
  /* #general (group), #samsung (card), #templates/notes/checkin (tab),
     #row:searchDebounceMs (one setting). */
  function go(hash, { focus = true, scroll = true } = {}) {
    const route = String(hash || '').replace(/^#/, '');
    clearSearch();
    if (changedOnly) setChangedOnly(false);
    if (!route) { showGroup(selected); return; }
    const [head, ...rest] = route.split('/');
    if (head === 'templates') { showGroup('templates'); selectTab(rest[0] || 'messages', rest[1]); if (focus) $('group-templates-title').focus(); return; }
    if (head.startsWith('row:')) {
      const control = document.querySelector(`[data-key="${head.slice(4).replace(/\W/g, '')}"]`);
      const row = control?.closest('.row') || control?.closest('.theme');
      if (!row) return;
      showGroup(groupOf(row));
      for (let details = row.closest('details'); details; details = details.parentElement.closest('details')) details.open = true;
      if (scroll) row.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      flash(row);
      if (focus) (control.disabled ? row.closest('.card')?.querySelector('h3') : control)?.focus({ preventScroll: true });
      return;
    }
    if (groups.some(g => g.dataset.group === head)) { showGroup(head); if (focus) $(`group-${head}-title`)?.focus(); $('settings-content').scrollTop = 0; return; }
    const card = document.getElementById(head);
    if (card?.matches('[data-card]')) {
      showGroup(groupOf(card));
      if (rest[0] === 'options') card.querySelector('details.options')?.setAttribute('open', '');
      if (scroll) card.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
      flash(card);
      if (focus) card.querySelector('h3')?.focus({ preventScroll: true });
    }
  }
  navLinks.forEach(link => link.addEventListener('click', event => { event.preventDefault(); history.replaceState(null, '', `#${link.dataset.group}`); go(link.dataset.group); }));
  document.addEventListener('click', event => {
    const link = event.target.closest?.('[data-go]');
    if (!link) return;
    event.preventDefault();
    history.replaceState(null, '', `#${link.dataset.go}`);
    go(link.dataset.go);
  });
  addEventListener('hashchange', () => go(location.hash));

  /* ---------- Search ---------- */
  const words = text => String(text || '').toLowerCase().split(/\s+/).filter(Boolean);
  function indexEntries() {
    const entries = [];
    for (const card of document.querySelectorAll('[data-card]')) {
      const group = card.closest('.group')?.querySelector('h2')?.textContent || '';
      const title = card.querySelector('h3')?.textContent || '';
      entries.push({ title, detail: `${group}`, text: `${title} ${card.querySelector('.card-title p')?.textContent || ''} ${group}`, target: card.id });
      for (const control of card.querySelectorAll('.row:not(.main) [data-key]')) {
        const row = control.closest('.row');
        const label = row.querySelector('span')?.childNodes[0]?.textContent?.trim() || '';
        const desc = row.querySelector('small:not(.why)')?.textContent || '';
        entries.push({ title: label, detail: `${group} › ${title}`, text: `${label} ${desc} ${title}`, target: `row:${control.dataset.key}` });
      }
      if (card.querySelector('.theme')) entries.push({ title: 'Theme: off, dark or dimmed', detail: `${group} › ${title}`, text: 'theme dark mode dimmed night appearance', target: 'row:darkModeFollowSystem' });
    }
    for (const tab of document.querySelectorAll('[data-tab]')) entries.push({ title: `${tab.textContent} templates`, detail: 'Templates', text: `${tab.textContent} templates wording edit`, target: `templates/${tab.dataset.tab}` });
    for (const action of H ? H.actions() : []) entries.push({ title: `Shortcut: ${action.name}`, detail: 'General › Keyboard shortcuts', text: `shortcut hotkey key ${action.name} ${action.group}`, target: `shortcut:${action.id}` });
    entries.push({ title: 'Export or import your setup', detail: 'About & updates › Back up', text: 'export import backup move share json', target: 'backup' });
    entries.push({ title: 'Reset everything', detail: 'About & updates › Start over', text: 'reset defaults everything clear', target: 'reset-all' });
    entries.push({ title: 'Update the extension', detail: 'About & updates', text: 'update git pull zip reload version help', target: 'updates' });
    return entries;
  }
  let entries = null;
  function runSearch() {
    const query = words(search.value);
    const results = $('search-results'), list = $('search-list');
    if (!query.length) { clearSearch(true); return; }
    entries ||= indexEntries();
    const matches = entries.filter(entry => query.every(word => entry.text.toLowerCase().includes(word))).slice(0, 40);
    for (const group of groups) group.hidden = true;
    $('no-changes').hidden = true;
    results.hidden = matches.length === 0;
    $('no-results').hidden = matches.length !== 0;
    list.replaceChildren(...matches.map(entry => {
      const item = el('li'), button = el('button', '', { type: 'button' });
      button.append(el('strong', entry.title), el('small', entry.detail));
      button.addEventListener('click', () => open(entry.target));
      item.append(button);
      return item;
    }));
    for (const link of navLinks) link.removeAttribute('aria-current');
  }
  function open(target) {
    if (target.startsWith('shortcut:')) { go('shortcuts'); globalThis.UBIFPlusShortcutEditor?.record(target.slice(9)); return; }
    history.replaceState(null, '', `#${target.startsWith('row:') ? '' : target}`);
    go(target);
  }
  /* Leaves search mode; `keepText` keeps what was typed (Escape clears it). */
  function clearSearch(keepText = false) {
    if (!keepText) search.value = '';
    $('search-results').hidden = true;
    $('no-results').hidden = true;
    if (!changedOnly) showGroup(selected);
  }
  search.addEventListener('input', runSearch);
  search.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); $('search-list').querySelector('button')?.click(); }
    if (event.key === 'Escape') clearSearch();
    if (event.key === 'ArrowDown') { event.preventDefault(); $('search-list').querySelector('button')?.focus(); }
  });
  $('search-list').addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const buttons = [...$('search-list').querySelectorAll('button')], index = buttons.indexOf(document.activeElement);
    const next = buttons[index + (event.key === 'ArrowDown' ? 1 : -1)];
    (next || search).focus();
  });
  document.addEventListener('keydown', event => {
    const typing = event.target.closest?.('input, textarea, select, [contenteditable="true"]');
    if (event.key === '/' && !typing && !globalThis.UBIFPlusShortcutEditor?.listening()) { event.preventDefault(); search.focus(); search.select(); }
  });

  /* ---------- Changed filter ---------- */
  function countChanges() {
    if (!current) return;
    const count = UI.changed(current, S.defaults).length;
    $('changed-count').textContent = count ? String(count) : '';
    changedButton.title = count ? `${count} setting${count === 1 ? '' : 's'} differ from the defaults. Show only those.` : 'Everything is at its default.';
  }
  function applyChangedFilter() {
    const settingsGroups = groups.filter(g => !['templates', 'about'].includes(g.dataset.group));
    let any = false;
    for (const group of groups) group.hidden = !settingsGroups.includes(group);
    for (const group of settingsGroups) {
      let groupAny = false;
      for (const card of group.querySelectorAll('[data-card]')) {
        const changedRows = [...card.querySelectorAll('.row[data-changed]')];
        const themeChanged = card.querySelector('.theme') && current && (current.darkMode || current.darkDimmed);
        const show = changedRows.length > 0 || Boolean(themeChanged);
        card.hidden = !show;
        for (const row of card.querySelectorAll('.row:not(.main)')) row.hidden = !row.hasAttribute('data-changed');
        if (show) { card.querySelectorAll('details').forEach(d => { if (d.querySelector('.row[data-changed]')) d.open = true; }); groupAny = true; }
      }
      group.hidden = !groupAny;
      any ||= groupAny;
    }
    $('no-changes').hidden = any;
  }
  function setChangedOnly(on) {
    changedOnly = on;
    changedButton.setAttribute('aria-pressed', String(on));
    if (on) { search.value = ''; $('search-results').hidden = true; $('no-results').hidden = true; for (const link of navLinks) link.removeAttribute('aria-current'); applyChangedFilter(); return; }
    $('no-changes').hidden = true;
    for (const card of document.querySelectorAll('[data-card]')) card.hidden = false;
    for (const row of document.querySelectorAll('.row')) row.hidden = false;
    showGroup(selected);
  }
  changedButton.addEventListener('click', () => setChangedOnly(!changedOnly));

  /* ---------- Templates hub ---------- */
  let messagesMounted = false;
  function selectTab(tab, sub) {
    const id = tab === 'notes' ? 'notes' : 'messages';
    for (const button of document.querySelectorAll('[data-tab]')) button.setAttribute('aria-selected', String(button.dataset.tab === id));
    $('templates-messages').hidden = id !== 'messages';
    $('templates-notes').hidden = id !== 'notes';
    if (id === 'messages') mountMessages();
    if (id === 'notes' && sub) globalThis.UBIFPlusTemplateEditor?.showGroup(sub);
  }
  document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
    history.replaceState(null, '', `#templates/${button.dataset.tab}`);
    selectTab(button.dataset.tab);
  }));
  document.querySelector('[role=tablist]')?.addEventListener('keydown', event => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const tabs = [...document.querySelectorAll('[data-tab]')], index = tabs.indexOf(document.activeElement);
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    next.focus(); next.click();
  });

  /* The same editor as in the Portal chat, with an example customer for
     previews. Using a template only works from a customer chat. */
  async function mountMessages() {
    if (messagesMounted || !MM || !globalThis.UBIFPlusMessageUI) return;
    messagesMounted = true;
    const area = local();
    let templates = MM.sanitize();
    try { templates = MM.sanitize((await area?.get(MESSAGES))?.[MESSAGES]); } catch {}
    const host = $('message-editor');
    const root = host.attachShadow({ mode: 'open' });
    const sample = { 'customer.firstName': 'Alex', 'customer.name': 'Alex Morgan', 'customer.phone': '(555) 010-0142', 'customer.email': 'alex@example.com',
      'device.name': 'Samsung Galaxy S25', 'device.model': 'SM-S931U', 'device.issues': 'Cracked screen', 'workorder.number': '10001234',
      'workorder.status': 'Ready for work', 'workorder.nextUpdate': 'Tomorrow, 3:00 PM', 'appointment.date': 'Oct 20, 2026, 1:00 PM' };
    const ui = globalThis.UBIFPlusMessageUI.create(root, {
      model: MM,
      getTemplates: () => templates,
      getShortcuts: () => false,
      getHeight: () => 460,
      getContext: () => ({ key: 'settings-preview', values: { ...sample, 'employee.firstName': current?.employeeFirstName || 'Jordan' }, loading: false }),
      getDraft: () => '',
      save: async next => { if (!area) throw new Error('Template storage unavailable'); await area.set({ [MESSAGES]: next }); templates = next; },
      use: () => 'Templates are sent from a customer chat in Portal. Here you can create, edit and preview them.'
    });
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) chrome.storage.onChanged.addListener((changes, scope) => {
      if (scope === 'local' && changes[MESSAGES]) { templates = MM.sanitize(changes[MESSAGES].newValue); ui.updateSettings?.(); ui.update?.(true); }
    });
    // On this page the library sits inline and stays open, instead of popping
    // up above a chat box.
    const inline = document.createElement('style');
    inline.textContent = `.workspace{position:static!important;box-shadow:none!important;margin:0 0 6px!important}.shortcuts{display:none!important}.shortcut-bar{justify-content:flex-end;padding:0!important}`;
    root.append(inline);
    root.querySelector('.toggle')?.click();
  }

  /* ---------- Saved layouts and store emails ---------- */
  async function storageAll() { try { return (await local()?.get(null)) || {}; } catch { return {}; } }
  const layoutName = key => {
    const rest = key.slice(LAYOUTS.length);
    return rest.startsWith('arrivals.') ? `Arrivals · ${rest.slice(9) || 'Default'}` : `Workorders · ${rest || 'Default'}`;
  };
  async function renderLayouts() {
    const panel = $('layout-summary');
    if (!panel) return;
    const data = await storageAll();
    const keys = Object.keys(data).filter(key => key.startsWith(LAYOUTS)).sort();
    panel.replaceChildren();
    if (!keys.length) { panel.append(el('p', 'No saved layouts yet. Use the Columns button on a Workorders or Arrivals tab.', { class: 'muted' })); return; }
    for (const key of keys) {
      const layout = data[key] || {};
      const total = Array.isArray(layout.order) ? layout.order.length : 0, hidden = Array.isArray(layout.hidden) ? layout.hidden.length : 0;
      const item = el('div', '', { class: 'item' });
      const name = el('span', layoutName(key));
      if (total) name.append(el('small', ` · ${total - hidden} of ${total} columns shown`));
      const reset = el('button', 'Reset', { type: 'button', 'aria-label': `Reset ${layoutName(key)} layout` });
      reset.addEventListener('click', async () => { await local()?.remove(key); binder?.flash(`${layoutName(key)} layout reset.`); renderLayouts(); });
      item.append(name, reset);
      panel.append(item);
    }
  }
  async function renderStoreEmails() {
    const panel = $('store-emails');
    if (!panel) return;
    const data = await storageAll();
    const emails = data[STORE_EMAILS] && typeof data[STORE_EMAILS] === 'object' ? data[STORE_EMAILS] : {};
    panel.replaceChildren();
    const entries = Object.entries(emails);
    if (!entries.length) { panel.append(el('p', 'None yet. A store email you correct in a Samsung request is remembered for that store.', { class: 'muted' })); return; }
    for (const [store, email] of entries) {
      const item = el('div', '', { class: 'item' });
      const name = el('span', `Store #${store}`); name.append(el('small', ` · ${email}`));
      const forget = el('button', 'Forget', { type: 'button', 'aria-label': `Forget the email for store ${store}` });
      forget.addEventListener('click', async () => {
        const next = { ...emails }; delete next[store];
        await local()?.set({ [STORE_EMAILS]: next }); renderStoreEmails();
      });
      item.append(name, forget);
      panel.append(item);
    }
  }
  async function renderShortcutLists() {
    if (!H) return;
    const bindings = await H.load();
    const actions = H.actions();
    for (const panel of document.querySelectorAll('[data-shortcut-list]')) {
      panel.replaceChildren();
      for (const id of panel.dataset.shortcutList.split(' ')) {
        const action = actions.find(a => a.id === id);
        if (!action) continue;
        const item = el('div', '', { class: 'item' });
        const name = el('span', action.name); name.append(el('small', ` · ${bindings[id] ? H.format(bindings[id]) : 'Not set'}`));
        const change = el('button', bindings[id] ? 'Change' : 'Set shortcut', { type: 'button' });
        change.addEventListener('click', () => open(`shortcut:${id}`));
        item.append(name, change);
        panel.append(item);
      }
    }
  }
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) chrome.storage.onChanged.addListener((changes, area) => {
    if (area && area !== 'local') return;
    const keys = Object.keys(changes || {});
    if (keys.some(key => key.startsWith(LAYOUTS))) renderLayouts();
    if (keys.includes(STORE_EMAILS)) renderStoreEmails();
    if (H && keys.includes(H.KEY)) renderShortcutLists();
  });

  /* ---------- Backup ---------- */
  const backupStatus = $('backup-status');
  const sayBackup = (text, error = false) => { backupStatus.textContent = text; backupStatus.style.color = error ? 'var(--error)' : ''; };
  function pickBackup(data) {
    const out = {};
    for (const [key, value] of Object.entries(data || {})) {
      if (key === S.KEY || key === STORE_EMAILS || key === MESSAGES || (T && key === T.KEY) || (H && key === H.KEY) || key.startsWith(LAYOUTS)) out[key] = value;
    }
    return out;
  }
  $('export-settings').addEventListener('click', async () => {
    const data = pickBackup(await storageAll());
    const manifest = typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.();
    const file = { app: 'ubif-nextgen-plus', version: manifest?.version || '', exportedAt: new Date().toISOString(), data };
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const link = el('a', '', { href: URL.createObjectURL(blob), download: `ubif-nextgen-plus-setup-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    sayBackup(`Exported ${Object.keys(data).length} item${Object.keys(data).length === 1 ? '' : 's'}.`);
  });
  $('import-settings').addEventListener('click', () => $('import-file').click());
  /* Each part is checked with the same rules the extension uses when it
     reads storage; anything unknown is ignored. */
  function cleanImport(data) {
    const out = {}, parts = [];
    if (data[S.KEY]) { out[S.KEY] = S.sanitize(data[S.KEY]); parts.push('settings'); }
    if (T && data[T.KEY]) { out[T.KEY] = { version: 1, overrides: T.sanitize(data[T.KEY]) }; parts.push('note templates'); }
    if (H && data[H.KEY]) { out[H.KEY] = H.sanitize(data[H.KEY]); parts.push('shortcuts'); }
    if (MM && data[MESSAGES]) { out[MESSAGES] = MM.sanitize(data[MESSAGES]); parts.push('message templates'); }
    if (data[STORE_EMAILS] && typeof data[STORE_EMAILS] === 'object') {
      out[STORE_EMAILS] = Object.fromEntries(Object.entries(data[STORE_EMAILS]).filter(([store, email]) => /^\d{1,6}$/.test(store) && typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)).map(([s, e]) => [s, e.slice(0, 200)]));
      parts.push('store emails');
    }
    const layouts = Object.entries(data).filter(([key, value]) => key.startsWith(LAYOUTS) && /^[\w.\- ]{1,80}$/.test(key.slice(LAYOUTS.length)) && value && Array.isArray(value.order));
    for (const [key, value] of layouts) out[key] = value;
    if (layouts.length) parts.push(`${layouts.length} column layout${layouts.length === 1 ? '' : 's'}`);
    return { out, parts };
  }
  $('import-file').addEventListener('change', async () => {
    const file = $('import-file').files?.[0];
    $('import-file').value = '';
    if (!file) return;
    let parsed;
    try { parsed = JSON.parse(await file.text()); } catch { sayBackup('That file is not a setup export.', true); return; }
    if (parsed?.app !== 'ubif-nextgen-plus' || !parsed.data || typeof parsed.data !== 'object') { sayBackup('That file is not a UBIF NextGen Plus setup export.', true); return; }
    const { out, parts } = cleanImport(parsed.data);
    if (!parts.length) { sayBackup('Nothing to import in that file.', true); return; }
    if (!globalThis.confirm(`Replace your ${parts.join(', ')} with the ones in ${file.name}?`)) { sayBackup('Import cancelled.'); return; }
    try { await local()?.set(out); sayBackup(`Imported ${parts.join(', ')}.`); await S.get(); renderLayouts(); renderStoreEmails(); renderShortcutLists(); }
    catch { sayBackup('Could not import. Try again.', true); }
  });

  /* ---------- Reset everything ---------- */
  const dialog = $('reset-dialog');
  $('reset-everything').addEventListener('click', () => { if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', ''); });
  dialog.addEventListener('close', async () => {
    if (dialog.returnValue !== 'reset') return;
    const form = dialog.querySelector('form'), checked = name => form.elements[name]?.checked;
    const done = [];
    try {
      if (checked('settings')) { await S.set({ ...S.defaults }); done.push('settings'); }
      if (checked('notes') && T) { await local()?.set({ [T.KEY]: { version: 1, overrides: {} } }); done.push('note templates'); }
      if (checked('hotkeys') && H) { await H.save({}); done.push('shortcuts'); }
      if (checked('layouts')) { const keys = Object.keys(await storageAll()).filter(key => key.startsWith(LAYOUTS)); if (keys.length) await local()?.remove(keys); done.push('column layouts'); }
      if (checked('storeEmails')) { await local()?.remove(STORE_EMAILS); done.push('store emails'); }
      binder?.flash(done.length ? `Reset ${done.join(', ')}.` : 'Nothing was reset.');
      renderLayouts(); renderStoreEmails(); renderShortcutLists();
    } catch { binder?.flash('Could not reset. Try again.', true); }
  });

  /* ---------- Toolbar popup ---------- */
  // The toolbar icon opens this same page as a popup. It needs a fixed size
  // there (Chrome sizes popups from their content), and can move to a tab.
  const views = typeof chrome !== 'undefined' && chrome.extension?.getViews?.({ type: 'popup' });
  const inPopup = Array.isArray(views) && views.includes(window);
  document.documentElement.classList.toggle('in-popup', inPopup);
  $('open-settings').hidden = !inPopup;
  $('open-settings').addEventListener('click', () => { UI.openSettings(location.hash); globalThis.close?.(); });

  /* ---------- What's new, About, links, reload ---------- */
  const SEEN = 'ubif-plus.whats-new-seen.v1';
  const news = globalThis.UBIFPlusWhatsNew;
  if (news) {
    $('whats-new-subtitle').textContent = news.title;
    $('whats-new-list').replaceChildren(...news.items.map(item => el('li', item)));
    // Shown once at the top after an update, until dismissed.
    Promise.resolve(local()?.get(SEEN)).then(data => {
      if (data?.[SEEN] === news.id) return;
      $('news-banner-title').textContent = news.title;
      $('news-banner-list').replaceChildren(...news.items.map(item => el('li', item)));
      $('news-banner').hidden = false;
    }, () => {});
    $('news-dismiss').addEventListener('click', () => {
      $('news-banner').hidden = true;
      Promise.resolve(local()?.set({ [SEEN]: news.id })).catch(() => {});
    });
  }
  for (const link of document.querySelectorAll('[data-external]')) link.addEventListener('click', event => {
    event.preventDefault();
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) chrome.tabs.create({ url: link.href });
    else window.open(link.href, '_blank');
  });
  const reload = $('reload-extension');
  const canReload = typeof chrome !== 'undefined' && typeof chrome.runtime?.reload === 'function';
  reload.disabled = !canReload;
  $('preview-note').hidden = canReload;
  reload.addEventListener('click', () => { if (canReload) chrome.runtime.reload(); });
  $('news-reload').hidden = !canReload;
  $('news-reload').addEventListener('click', () => { if (canReload) chrome.runtime.reload(); });
  const manifest = typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.();
  if (manifest) $('ubif-version').textContent = `v${manifest.version}`;

  renderLayouts(); renderStoreEmails(); renderShortcutLists();
  go(location.hash || '#general', { focus: false, scroll: false });
  if (!location.hash) showGroup('general');
  globalThis.UBIFPlusOptions = Object.freeze({ go, open });
})();
