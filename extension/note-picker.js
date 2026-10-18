/* Note template picker. A small "Templates" button sits under Portal's notes
   fields and inserts a status, lead or check-in template without replacing
   what is already written:
   - Work-order notes (data-testid "notes-input"), the note boxes in Portal's
     status dialogs ("notes-area-text-field") and the Update Today editor's
     note offer status and lead templates, inserted at the caret or the end.
   - Check-in Additional Details ("additional-details-note", Samsung
     "DeviceDiagSubIssues_Notes") offers check-in templates, inserted at the
     caret or the start, so the Extra Details section stays last.
   Keyboard shortcuts insert into the last notes field used on the page. */
(() => {
  'use strict';
  if (globalThis.__ubifPlusNotePicker) return;
  globalThis.__ubifPlusNotePicker = true;
  const T = globalThis.UBIFPlusNoteTemplates;
  const S = globalThis.UBIFPlusSettings;
  if (!T) return;
  const TARGETS = [
    { selector: '[data-testid="notes-input"], [data-testid="notes-area-text-field"]', where: 'notes' },
    { selector: '[data-testid="additional-details-note"], [data-testid="DeviceDiagSubIssues_Notes"]', where: 'checkin' }
  ];
  const EDITABLE = 'textarea, [contenteditable="true"], [contenteditable=""]';
  let config = { noteTemplates: true, noteTemplatesCheckin: true };
  let templates = T.list();
  const fields = new Map(); // field -> { where, host, anchor, explicit }
  const carets = new WeakMap(); // field -> { start, end } the technician placed
  let lastField = null, scanQueued = false, toastTimer = 0, bindings = {};

  const el = (tag, text = '', attrs = {}) => {
    const node = document.createElement(tag); node.textContent = text;
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  };
  const enabledFor = where => (where === 'checkin' ? config.noteTemplatesCheckin : config.noteTemplates);
  const groupsFor = where => T.GROUPS.filter(group => group.where === where).map(group => group.id);
  function visible(node) {
    if (!node?.isConnected) return false;
    for (let current = node; current && current.nodeType === 1; current = current.parentElement) {
      if (current.hidden || current.getAttribute('aria-hidden') === 'true' || getComputedStyle(current).display === 'none') return false;
    }
    return true;
  }
  /* Where the button goes: after Portal's field wrapper (the element that
     carries the test id, or the nearest ancestor holding the field's label
     and no other control), so it sits below the field rather than inside
     its box. */
  function anchorFor(node) {
    if (!node.matches(EDITABLE)) return node;
    let current = node;
    for (let depth = 0; depth < 3 && current.parentElement && current.parentElement !== document.body; depth++) {
      current = current.parentElement;
      if (current.querySelectorAll('textarea, input, select, [contenteditable="true"]').length !== 1) break;
      if (current.querySelector('label, legend')) return current;
    }
    return node.parentElement && node.parentElement !== document.body ? node.parentElement : node;
  }

  const CSS_TEXT = `
    :host{display:block;position:relative;margin:6px 0 2px;font:inherit;color:var(--aui-on-surface,#242128)}
    *{box-sizing:border-box}button,input{font:inherit;color:inherit}
    .open{display:inline-flex;align-items:center;gap:6px;min-height:30px;padding:4px 12px;border:1px solid var(--aui-outline,#c8c2cd);border-radius:999px;background:var(--aui-elevated-level-01,#fff);font-size:13px;font-weight:500;cursor:pointer}
    .open:hover{background:var(--aui-surface-variant,#f3f0f6)}
    .open svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
    button:focus-visible,input:focus-visible{outline:2px solid var(--aui-primary,#8224ce);outline-offset:2px}
    .menu{position:absolute;z-index:2000;left:0;top:calc(100% + 6px);width:min(380px,calc(100vw - 24px));max-height:min(420px,60vh);display:flex;flex-direction:column;border:1px solid var(--aui-outline-variant,#e4e4e7);border-radius:10px;background:var(--aui-elevated-level-03,#fff);box-shadow:0 10px 30px #0000002e;overflow:hidden}
    .menu[hidden]{display:none}
    .menu[data-up]{top:auto;bottom:calc(100% + 6px)}
    .search{margin:10px;padding:8px 10px;border:1px solid var(--aui-outline,#bcbac3);border-radius:6px;background:var(--aui-elevated-level-01,#fff);font-size:14px}
    .list{overflow:auto;padding:0 6px 8px}
    h3{margin:10px 8px 4px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--aui-on-surface-soft,#66636d)}
    .item{display:block;width:100%;text-align:left;padding:8px 10px;border:0;border-radius:6px;background:none;cursor:pointer}
    .item:hover,.item:focus-visible{background:var(--aui-surface-variant,#f3f0f6)}
    .item strong{display:block;font-size:14px;font-weight:500}
    .item small{display:block;font-size:12px;color:var(--aui-on-surface-soft,#66636d)}
    .item kbd{float:right;font:11px/1.6 inherit;color:var(--aui-on-surface-soft,#66636d)}
    .empty{margin:8px 10px;font-size:13px;color:var(--aui-on-surface-soft,#66636d)}
    .status{margin:4px 0 0;font-size:12px;color:var(--aui-on-surface-soft,#66636d)}
    .status:empty{display:none}.status[data-error=true]{color:var(--aui-status-error,#b42318)}
  `;

  function editableOf(target) {
    if (!target) return null;
    return target.matches(EDITABLE) ? target : target.querySelector(EDITABLE);
  }

  function remember(field) {
    const save = () => { if (field instanceof HTMLTextAreaElement) carets.set(field, { start: field.selectionStart, end: field.selectionEnd }); };
    for (const type of ['keyup', 'mouseup', 'select', 'input']) field.addEventListener(type, save);
    field.addEventListener('focus', () => { lastField = field; });
  }

  function buildHost(field, where) {
    const host = el('div', '', { 'data-ubif-note-templates': where });
    const shadow = host.attachShadow({ mode: 'open' });
    const style = el('style'); style.textContent = CSS_TEXT;
    const open = el('button', '', { type: 'button', class: 'open', 'aria-haspopup': 'true', 'aria-expanded': 'false' });
    open.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6z"/><path d="M9 11h7M9 15h7M9 7h3"/></svg>';
    open.append(el('span', where === 'checkin' ? 'Check-in templates' : 'Note templates'));
    const menu = el('div', '', { class: 'menu', role: 'dialog', 'aria-label': 'Note templates', hidden: '' });
    const search = el('input', '', { type: 'search', class: 'search', placeholder: 'Find a template', 'aria-label': 'Find a template' });
    const list = el('div', '', { class: 'list' });
    menu.append(search, list);
    const status = el('p', '', { class: 'status', role: 'status', 'aria-live': 'polite' });
    shadow.append(style, open, menu, status);

    const render = () => {
      const query = search.value.trim().toLowerCase();
      list.replaceChildren();
      for (const group of T.GROUPS.filter(g => groupsFor(where).includes(g.id))) {
        const items = templates.filter(t => t.group === group.id && (!query || `${t.name} ${t.summary} ${t.text}`.toLowerCase().includes(query)));
        if (!items.length) continue;
        list.append(el('h3', group.name));
        for (const template of items) {
          const item = el('button', '', { type: 'button', class: 'item', 'data-template': template.id });
          const shortcut = globalThis.UBIFPlusHotkeys && bindings[`template.${template.id}`];
          if (shortcut) item.append(el('kbd', globalThis.UBIFPlusHotkeys.format(shortcut)));
          item.append(el('strong', template.name), el('small', template.edited ? `${template.summary} · edited` : template.summary));
          item.addEventListener('click', () => { close(); insert(field, template.id, status); });
          list.append(item);
        }
      }
      if (!list.childElementCount) list.append(el('p', 'No templates match.', { class: 'empty' }));
    };
    const close = () => { menu.hidden = true; open.setAttribute('aria-expanded', 'false'); };
    open.addEventListener('click', () => {
      if (!menu.hidden) { close(); return; }
      search.value = ''; render();
      menu.hidden = false; open.setAttribute('aria-expanded', 'true');
      // Open upward when there is no room below.
      const rect = host.getBoundingClientRect?.();
      menu.toggleAttribute('data-up', Boolean(rect && rect.bottom + 430 > innerHeight && rect.top > 430));
      search.focus();
    });
    search.addEventListener('input', render);
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.stopPropagation(); close(); open.focus(); }
      if (event.key === 'Enter' && event.target === search) { event.preventDefault(); list.querySelector('.item')?.click(); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const items = [...list.querySelectorAll('.item')];
        const index = items.indexOf(shadow.activeElement);
        items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      }
    });
    host.addEventListener('focusout', event => { if (!host.contains(event.relatedTarget) && !shadow.contains(event.relatedTarget)) setTimeout(() => { if (!shadow.activeElement) close(); }, 0); });
    host.ubifStatus = status;
    host.ubifRender = () => { if (!menu.hidden) render(); };
    return host;
  }

  function attach(field, where, anchor) {
    if (!field || fields.has(field)) return;
    const host = buildHost(field, where);
    fields.set(field, { where, host, anchor });
    remember(field);
    place(field);
  }

  function place(field) {
    const entry = fields.get(field);
    if (!entry) return;
    const show = enabledFor(entry.where) && field.isConnected && !field.disabled && !field.readOnly;
    if (!show) { entry.host.remove(); return; }
    if (entry.host.previousElementSibling !== entry.anchor || !entry.host.isConnected) entry.anchor.after(entry.host);
  }

  function scan() {
    scanQueued = false;
    if (!globalThis.document?.body) return;
    for (const [field, entry] of fields) {
      if (!field.isConnected) { entry.host.remove(); fields.delete(field); if (lastField === field) lastField = null; }
      else place(field);
    }
    for (const target of TARGETS) {
      for (const node of document.querySelectorAll(target.selector)) {
        const field = editableOf(node);
        if (!field || fields.has(field) || field.closest('[data-ubif-note-templates]')) continue;
        attach(field, target.where, anchorFor(node));
      }
    }
    // Fallback when Portal does not forward its test id to the page: a notes
    // box named "note(s)" or "additional details" on a work order or check-in.
    const where = /^\/repair\/workorder\/\d+/.test(location.pathname) ? 'notes' : /^\/check-in\b/.test(location.pathname) ? 'checkin' : '';
    if (!where) return;
    for (const field of document.querySelectorAll(EDITABLE)) {
      if (fields.has(field) || field.closest('[data-ubif-note-templates], [data-ubif-samsung], [data-ubif-message-templates], #amazon-connect-widget-frame')) continue;
      const name = nameOf(field);
      if (where === 'notes' ? /\bnotes?\b/i.test(name) && !/message|sms|text the customer/i.test(name) : /additional details|\bnotes?\b/i.test(name)) {
        attach(field, where, anchorFor(field));
      }
    }
  }

  /* The field's accessible name: aria-label, its label, or placeholder. */
  function nameOf(field) {
    const byId = id => document.getElementById(id)?.textContent || '';
    const labelled = (field.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(byId).join(' ');
    const forLabel = field.id ? [...document.querySelectorAll('label[for]')].find(label => label.htmlFor === field.id)?.textContent || '' : '';
    const wrapping = field.closest('label')?.textContent || '';
    return [field.getAttribute('aria-label'), labelled, forLabel, wrapping, field.getAttribute('placeholder'), field.getAttribute('name')].filter(Boolean).join(' ');
  }
  const queueScan = () => { if (!scanQueued) { scanQueued = true; (globalThis.requestAnimationFrame || setTimeout)(scan); } };

  function setText(field, value, caret) {
    const prototype = Object.getPrototypeOf(field);
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set || Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    field.focus();
    if (setter) setter.call(field, value); else field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    try { field.setSelectionRange(caret, caret); } catch {}
    carets.set(field, { start: caret, end: caret });
  }

  function report(status, text, error = false) {
    if (status) { status.textContent = text; status.dataset.error = String(error); clearTimeout(status.ubifTimer); status.ubifTimer = setTimeout(() => { status.textContent = ''; }, 4000); }
    else toast(text, error);
  }

  /* Inserts a template; returns true when the field changed. */
  function insert(field, id, status = fields.get(field)?.host.ubifStatus) {
    const template = T.get(id);
    const entry = fields.get(field);
    if (!template || !entry) return false;
    if (!groupsFor(entry.where).includes(template.group)) { report(status, `${template.name} is for ${entry.where === 'checkin' ? 'work-order notes' : 'check-in notes'}.`, true); return false; }
    const at = entry.where === 'checkin' ? 'start' : 'end';
    if (field instanceof HTMLTextAreaElement) {
      const caret = carets.get(field);
      const { value, caret: next } = T.combine(field.value, template.text, { ...(caret || {}), at });
      const limit = field.maxLength > 0 ? field.maxLength : T.MAX;
      if (value.length > limit) { report(status, `${template.name} does not fit: ${value.length - limit} characters over the ${limit} limit.`, true); field.focus(); return false; }
      setText(field, value, next);
    } else {
      // Rich editors take the text at the caret, like typing or pasting.
      field.focus();
      const selection = getSelection();
      if (!selection.rangeCount || !field.contains(selection.anchorNode)) {
        const range = document.createRange(); range.selectNodeContents(field); range.collapse(at === 'start');
        selection.removeAllRanges(); selection.addRange(range);
      }
      const existing = field.textContent.trim() ? (at === 'start' ? '' : '\n\n') : '';
      const text = at === 'start' && field.textContent.trim() ? `${template.text}\n\n` : `${existing}${template.text}`;
      if (!document.execCommand('insertText', false, text)) { report(status, 'This field does not accept inserted text. Type or paste the template instead.', true); return false; }
    }
    lastField = field;
    report(status, `Inserted ${template.name}.`);
    return true;
  }

  function toast(text, error) {
    let host = document.querySelector('[data-ubif-note-toast]');
    if (!host) {
      host = el('div', '', { 'data-ubif-note-toast': '', role: 'status', 'aria-live': 'polite' });
      host.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483000;max-width:min(480px,calc(100vw - 32px));padding:10px 16px;border-radius:8px;background:#242128;color:#fff;font:14px/1.4 system-ui,sans-serif;box-shadow:0 6px 20px #0000003d';
      document.body.append(host);
    }
    host.textContent = text;
    host.style.background = error ? '#7a1d14' : '#242128';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => host.remove(), 3500);
  }

  /* Keyboard shortcut: the field last used if it takes this template, else
     the only visible field on the page that does. */
  function insertFromShortcut(id) {
    const template = T.get(id);
    if (!template) return;
    const where = T.GROUPS.find(group => group.id === template.group)?.where;
    if (!enabledFor(where)) { toast(`${where === 'checkin' ? 'Check-in' : 'Note'} templates are turned off in settings.`, true); return; }
    const usable = [...fields].filter(([field, entry]) => entry.where === where && field.isConnected && !field.disabled && !field.readOnly && visible(field));
    const field = usable.find(([candidate]) => candidate === lastField)?.[0] || (usable.length === 1 ? usable[0][0] : null);
    if (!field) {
      toast(usable.length ? 'Click into the notes field first, then use the shortcut.' : `Open ${where === 'checkin' ? 'the check-in notes' : 'a notes field'} first, then use the shortcut.`, true);
      return;
    }
    insert(field, id, null);
  }

  document.addEventListener('ubif-plus-action', event => {
    const action = String(event.detail?.action || '');
    if (action.startsWith('template.')) insertFromShortcut(action.slice(9));
  });

  function apply(next) {
    config = { ...config, ...next };
    for (const field of fields.keys()) place(field);
    queueScan();
  }

  globalThis.UBIFPlusNotePicker = Object.freeze({
    /* For fields the extension renders itself, such as Update Today's note. */
    attach: (field, where = 'notes', anchor = field) => attach(field, where, anchor),
    insert: (field, id) => insert(field, id),
    toast
  });

  T.subscribe(next => { templates = next; for (const entry of fields.values()) entry.host.ubifRender(); });
  T.load().then(next => { templates = next; });
  globalThis.UBIFPlusHotkeys?.load().then(next => { bindings = next; });
  globalThis.UBIFPlusHotkeys?.subscribe(next => { bindings = next; for (const entry of fields.values()) entry.host.ubifRender(); });
  if (S) { S.subscribe(apply); S.get().then(apply, () => {}); }
  const observer = new MutationObserver(queueScan);
  const start = () => { if (document.body) { observer.observe(document.body, { childList: true, subtree: true }); scan(); } };
  start();
  addEventListener('pageshow', start);
})();
