/* Samsung forms button on a Samsung work order. It gathers the GD Bypass,
   Fenrir Bypass or WER Request details from Portal, shows them for review,
   and asks the background worker to open the Sprinklr form, which sprinklr.js
   fills. Sprinklr is filled, not submitted, unless the technician turns on
   automatic submission. Nothing is sent anywhere until they click Open. */
(() => {
  'use strict';
  if (globalThis.__ubifPlusSamsung) return;
  globalThis.__ubifPlusSamsung = true;
  const M = globalThis.UBIFPlusSamsung;
  const S = globalThis.UBIFPlusSettings;
  if (!M) return;
  const STORE_EMAILS = 'ubif-plus.samsung.store-emails.v1';
  const ORDER = ['email', 'techName', 'storeNumber', 'storeEmail', 'repairType', 'gdVersion', 'sku', 'gspn', 'workorder', 'imei'];
  let config = { samsungForms: true, samsungAutoSubmit: false, samsungRepairType: 'Store', samsungGdVersion: '', samsungEmail: '' };
  let tech = { email: '', name: '', storeId: '', storeName: '' };
  let orderId = '', order = null, loadToken = 0, values = {}, form = 'gd', sending = false;

  const el = (tag, text = '', attrs = {}) => {
    const node = document.createElement(tag); node.textContent = text;
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  };
  const host = el('div', '', { 'data-ubif-samsung': '' });
  const shadow = host.attachShadow({ mode: 'open' });
  const css = el('style');
  css.textContent = `
    :host{display:inline-flex;vertical-align:middle;margin-left:12px;font:inherit;color:var(--aui-on-surface,#242128)}
    :host([data-floating]){position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:1500;margin:0}
    *{box-sizing:border-box}button,input,select{font:inherit;color:inherit}
    button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--aui-primary,#8224ce);outline-offset:2px}
    .launch{display:inline-flex;align-items:center;gap:8px;min-height:36px;padding:6px 14px;border:1px solid var(--aui-outline,#c8c2cd);border-radius:999px;background:var(--aui-elevated-level-01,#fff);font-size:14px;font-weight:500;cursor:pointer;box-shadow:0 1px 2px #0000000f}
    .launch:hover{background:var(--aui-surface-variant,#f3f0f6)}
    .launch svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
    dialog{--line:var(--aui-outline-variant,#e4e4e7);--muted:var(--aui-on-surface-soft,#66636d);--wash:var(--aui-surface-variant,#f7f7f8);width:min(620px,calc(100vw - 32px));max-height:calc(100dvh - 32px);padding:0;border:1px solid var(--line);border-radius:12px;background:var(--aui-elevated-level-03,#fff);color:inherit;overflow:auto}
    dialog::backdrop{background:#17151d80}
    header{display:flex;align-items:flex-start;gap:16px;padding:24px 28px 16px}
    header div{flex:1;min-width:0}
    .eyebrow{display:block;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:4px}
    h2{margin:0;font-size:22px;font-weight:600;letter-spacing:-.02em}
    .close{border:0;background:none;font-size:24px;line-height:1;padding:4px 8px;border-radius:6px;cursor:pointer;color:var(--muted)}
    .forms{display:flex;gap:6px;flex-wrap:wrap;padding:0 28px 16px;margin:0;border:0}
    .forms label{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border:1px solid var(--aui-outline,#c8c2cd);border-radius:999px;font-size:14px;cursor:pointer}
    .forms label:has(input:checked){background:var(--aui-on-surface,#242128);border-color:var(--aui-on-surface,#242128);color:var(--aui-surface,#fff)}
    .forms input{position:absolute;opacity:0;pointer-events:none}
    .forms label:has(input:focus-visible){outline:2px solid var(--aui-primary,#8224ce);outline-offset:2px}
    .fields{display:grid;grid-template-columns:1fr 1fr;gap:14px 16px;padding:18px 28px;border-top:1px solid var(--line)}
    .field{display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:500;min-width:0}
    .field input,.field select{width:100%;min-width:0;padding:9px 10px;border:1px solid var(--aui-outline,#bcbac3);border-radius:6px;background:var(--aui-elevated-level-01,#fff);font-size:14px;font-weight:400}
    .field[data-invalid] input,.field[data-invalid] select{border-color:var(--aui-status-error,#b42318)}
    .field small{min-height:16px;font-size:12px;font-weight:400;color:var(--muted)}
    .field[data-invalid] small{color:var(--aui-status-error,#b42318)}
    .note{margin:0 28px 14px;padding:10px 12px;border-radius:8px;background:var(--wash);font-size:13px}
    .note:empty{display:none}
    .auto{display:flex;align-items:center;gap:8px;padding:0 28px 18px;font-size:14px}
    .auto[hidden]{display:none}
    footer{display:flex;align-items:center;gap:10px;padding:14px 28px;border-top:1px solid var(--line);background:var(--wash)}
    .status{flex:1;margin:0;font-size:13px;color:var(--muted)}
    .status[data-error=true]{color:var(--aui-status-error,#b42318)}
    footer button{min-height:40px;padding:9px 18px;border:1px solid var(--aui-outline,#c8c2cd);border-radius:999px;background:var(--aui-elevated-level-01,#fff);font-size:14px;font-weight:500;cursor:pointer}
    footer .primary{background:var(--aui-primary,#8224ce);border-color:transparent;color:var(--aui-on-primary,#fff)}
    footer button:disabled{opacity:.5;cursor:default}
    @media(max-width:560px){.fields{grid-template-columns:1fr}header,.forms,.fields,.auto,footer{padding-left:18px;padding-right:18px}.note{margin-left:18px;margin-right:18px}}
  `;
  const launch = el('button', '', { type: 'button', class: 'launch', 'aria-haspopup': 'dialog' });
  launch.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h4"/></svg>';
  launch.append(el('span', 'Samsung forms'));

  const dialog = el('dialog', '', { 'aria-labelledby': 'ubif-samsung-title' });
  const header = el('header');
  const heading = el('div');
  const subtitle = el('span', '', { class: 'eyebrow' });
  heading.append(subtitle, el('h2', 'Samsung exception request', { id: 'ubif-samsung-title' }));
  const close = el('button', '×', { type: 'button', class: 'close', 'aria-label': 'Close' });
  header.append(heading, close);
  const forms = el('fieldset', '', { class: 'forms' });
  forms.append(el('legend', 'Request type', { style: 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)' }));
  for (const [id, definition] of Object.entries(M.FORMS)) {
    const label = el('label');
    const input = el('input', '', { type: 'radio', name: 'form', value: id });
    label.append(input, el('span', definition.name));
    forms.append(label);
  }
  const fields = el('div', '', { class: 'fields' });
  const controls = {};
  for (const key of ORDER) {
    const spec = M.FIELDS[key];
    const label = el('label', '', { class: 'field', 'data-key': key });
    const control = spec.choices ? el('select') : el('input', '', { type: spec.type === 'email' ? 'email' : 'text', autocomplete: 'off', spellcheck: 'false' });
    if (spec.choices) for (const choice of spec.choices) control.append(el('option', choice, { value: choice }));
    if (key === 'workorder') control.readOnly = true;
    label.append(el('span', spec.label), control, el('small'));
    controls[key] = control;
    fields.append(label);
  }
  const note = el('p', '', { class: 'note' });
  const autoLabel = el('label', '', { class: 'auto' });
  const auto = el('input', '', { type: 'checkbox' });
  autoLabel.append(auto, el('span', 'Submit automatically when every field fills'));
  const footer = el('footer');
  const status = el('p', '', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const cancel = el('button', 'Cancel', { type: 'button' });
  const open = el('button', 'Open Sprinklr form', { type: 'button', class: 'primary' });
  footer.append(status, cancel, open);
  dialog.append(header, forms, fields, note, autoLabel, footer);
  shadow.append(css, launch, dialog);

  function storage() { return globalThis.chrome?.storage?.local || null; }
  async function storeEmails() {
    try { return (await storage()?.get(STORE_EMAILS))?.[STORE_EMAILS] || {}; } catch { return {}; }
  }

  const hide = () => { if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open'); };
  function say(text, error = false) { status.textContent = text; status.dataset.error = String(error); }

  /* Shows what the chosen form needs and which of those values are missing. */
  function render() {
    const needed = new Set(M.keysFor(form)), invalid = new Set(M.missing(form, values));
    for (const key of ORDER) {
      const field = controls[key].closest('.field');
      field.hidden = !needed.has(key);
      field.toggleAttribute('data-invalid', invalid.has(key) && needed.has(key));
      const value = values[key] || '';
      if (controls[key].value !== value) controls[key].value = value;
      field.querySelector('small').textContent = !needed.has(key) ? '' :
        invalid.has(key) ? (value ? 'Check this value' : 'Required') : hintFor(key);
    }
    const definition = M.FORMS[form];
    subtitle.textContent = definition.title;
    forms.querySelector(`input[value="${form}"]`).checked = true;
    note.textContent = definition.note || '';
    autoLabel.hidden = !definition.canSubmit;
    auto.checked = Boolean(config.samsungAutoSubmit);
    open.disabled = sending || invalid.size > 0;
    open.textContent = definition.canSubmit && config.samsungAutoSubmit ? 'Open, fill and submit' : 'Open Sprinklr form';
    if (!sending) say(invalid.size ? `${invalid.size} detail${invalid.size === 1 ? '' : 's'} needed.` : 'Sprinklr opens in a new tab and fills these details.');
  }
  function hintFor(key) {
    if (key === 'gspn' && !order?.gspn) return '';
    if (key === 'storeEmail') return 'Based on the store name; correct it if needed.';
    if (key === 'sku') return 'From the device on this order.';
    return '';
  }

  async function prepare() {
    const emails = await storeEmails();
    const number = M.storeNumber(tech.storeName, tech.storeId);
    values = {
      email: config.samsungEmail || tech.email,
      techName: tech.name,
      storeNumber: number,
      storeEmail: emails[number] || M.storeEmail(tech.storeName),
      repairType: config.samsungRepairType || 'Store',
      gdVersion: config.samsungGdVersion,
      ...(order || {})
    };
    render();
  }

  async function remember() {
    const patch = { samsungRepairType: values.repairType, samsungEmail: values.email === tech.email ? '' : values.email };
    if (M.keysFor(form).includes('gdVersion')) patch.samsungGdVersion = values.gdVersion;
    try { await S?.set(patch); } catch { /* the request still goes ahead */ }
    try {
      const emails = await storeEmails();
      if (values.storeEmail && values.storeEmail !== M.storeEmail(tech.storeName)) emails[values.storeNumber] = values.storeEmail;
      else delete emails[values.storeNumber];
      await storage()?.set({ [STORE_EMAILS]: emails });
    } catch { /* a remembered store email is a convenience */ }
  }

  async function send() {
    if (sending || M.missing(form, values).length) return;
    sending = true; open.disabled = true; say('Opening Sprinklr…');
    await remember();
    let reply;
    try {
      reply = await chrome.runtime.sendMessage({ type: 'ubif-plus-samsung-open', form, values, autoSubmit: config.samsungAutoSubmit });
    } catch { reply = { ok: false, error: 'The extension was reloaded. Refresh this page and try again.' }; }
    sending = false;
    if (reply?.ok) { hide(); return; }
    render();
    say(reply?.error || 'Could not open Sprinklr.', true);
  }

  forms.addEventListener('change', event => { form = event.target.value; render(); });
  for (const [key, control] of Object.entries(controls)) {
    control.addEventListener('input', () => { values[key] = control.value.trim(); render(); });
    control.addEventListener('change', () => { values[key] = control.value.trim(); render(); });
  }
  auto.addEventListener('change', () => {
    config = { ...config, samsungAutoSubmit: auto.checked };
    S?.set({ samsungAutoSubmit: auto.checked }).catch(() => {});
    render();
  });
  async function show(choice) {
    if (choice && M.FORMS[choice]) form = choice;
    await prepare();
    if (!dialog.open) { if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', ''); }
    (shadow.querySelector('.field:not([hidden])[data-invalid] input') || forms.querySelector('input:checked')).focus();
  }
  launch.addEventListener('click', () => show());
  // Keyboard shortcuts (hotkeys.js) open a chosen form directly.
  document.addEventListener('ubif-plus-action', event => {
    const choice = String(event.detail?.action || '').match(/^samsung\.(\w+)$/)?.[1];
    if (!choice) return;
    if (config.samsungForms && order && host.isConnected) show(choice);
    else globalThis.UBIFPlusNotePicker?.toast?.(config.samsungForms ? 'Open a Samsung work order first.' : 'Samsung forms are turned off in settings.', true);
  });
  close.addEventListener('click', hide);
  cancel.addEventListener('click', hide);
  open.addEventListener('click', send);

  async function load(id) {
    const token = ++loadToken;
    order = null;
    try {
      const response = await fetch(`/api/workorder/${id}`, { credentials: 'same-origin', cache: 'no-store', ubifPlusBoard: true });
      if (!response.ok) return;
      const workorder = (await response.json())?.workorder;
      if (token !== loadToken || String(workorder?.workorderId) !== id || !M.isSamsung(workorder)) return;
      order = M.fromWorkorder(workorder);
      // A GSPN ticket created outside the partner job is recorded in a note.
      if (!order.gspn) {
        try {
          const notes = await fetch(`/api/note?workorderId=${id}&offset=0&limit=50`, { credentials: 'same-origin', cache: 'no-store', ubifPlusBoard: true });
          if (notes.ok && token === loadToken) order.gspn = M.gspnFromNotes((await notes.json())?.notes);
        } catch { /* the technician can type it */ }
      }
      if (token === loadToken) place();
    } catch { /* not a readable order: no button */ }
  }

  /* Beside Portal's "Work order #…" heading when it can be found, otherwise a
     floating button at the bottom of the page. */
  function anchor() {
    const pattern = new RegExp(`^Work order\\s*#\\s*${orderId}\\b`, 'i');
    for (const node of document.querySelectorAll('main h1, main h2, main h3, [data-aui="text"], h1, h2')) {
      if (node.closest('[data-ubif-samsung]') || !pattern.test(node.textContent.trim())) continue;
      return node;
    }
    return null;
  }
  function place() {
    if (!globalThis.document?.body) return; // the page is going away
    if (!config.samsungForms || !order) { host.remove(); return; }
    const target = anchor();
    if (target) {
      host.removeAttribute('data-floating');
      if (host.previousElementSibling !== target) target.after(host);
    } else {
      host.setAttribute('data-floating', '');
      if (host.parentElement !== document.body) document.body.append(host);
    }
  }

  function route() {
    if (!globalThis.document?.body) return;
    const id = location.pathname.match(/^\/repair\/workorder\/(\d+)\/?$/)?.[1] || '';
    if (id === orderId) { if (order) place(); return; }
    orderId = id; order = null; loadToken++;
    if (dialog.open) hide();
    host.remove();
    if (id && config.samsungForms) load(id);
  }

  addEventListener('message', event => {
    const data = event.data;
    if (event.source !== window || data?.source !== 'ubif-plus' || data.type !== 'tech-context') return;
    tech = { email: String(data.email || '').slice(0, 200), name: String(data.name || '').slice(0, 200),
      storeId: String(data.storeId || '').slice(0, 20), storeName: String(data.storeName || '').slice(0, 200) };
  });
  function apply(next) {
    const enabled = config.samsungForms;
    config = { ...config, ...next };
    if (!config.samsungForms) { if (dialog.open) hide(); host.remove(); }
    else if (!enabled) { orderId = ''; route(); }
    if (dialog.open) render();
  }
  if (S) { S.subscribe(apply); S.get().then(next => { apply(next); route(); }, route); } else route();
  window.postMessage({ source: 'ubif-plus', type: 'message-context-request' }, '*');
  // React may re-render the heading and drop the button; the route check also
  // moves a floating button beside the heading once it appears.
  const observer = new MutationObserver(() => { if (order && !host.isConnected) place(); });
  if (document.body) observer.observe(document.body, { childList: true, subtree: true });
  setInterval(route, 500);
})();
