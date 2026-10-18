/* Fills a Samsung exception request on Sprinklr's guided-workflow form. Runs
   only in a tab the extension opened from a Portal work order: the background
   worker hands this tab its job, and any other Sprinklr page gets none.

   Fields are found by their visible label, matched exactly (ignoring case,
   spacing and a required "*"), so "Email Address" never lands in "Store Email
   Address". Each later label is waited for, because Sprinklr shows the
   follow-up questions only after the dropdowns before them are chosen. The
   form is submitted only when the technician asked for it and every field
   filled; otherwise a banner asks them to review and submit. */
(() => {
  'use strict';
  if (globalThis.__ubifPlusSprinklr) return;
  globalThis.__ubifPlusSprinklr = true;
  const M = globalThis.UBIFPlusSamsung;
  if (!M) return;
  const FIRST_FIELD_MS = 30000, NEXT_FIELD_MS = 5000, OPTION_MS = 3000, POLL_MS = 50;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const normalize = value => String(value || '').replace(/[*:]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  let banner = null;

  function visible(node) {
    for (let current = node; current && current.nodeType === 1; current = current.parentElement) {
      if (current.hidden || current.getAttribute('aria-hidden') === 'true') return false;
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  }
  const ours = node => Boolean(node.closest?.('[data-ubif-sprinklr]'));

  /* The innermost visible element whose whole text is the label. */
  function findLabel(text) {
    const wanted = normalize(text);
    let best = null;
    for (const node of document.body.querySelectorAll('label, legend, span, div, p, h3, h4, h5, h6, td, th')) {
      if (ours(node) || node.closest('[role="option"], [role="listbox"], select, option, button')) continue;
      if (normalize(node.textContent) !== wanted || !visible(node)) continue;
      if (!best || best.contains(node)) best = node;
    }
    return best;
  }

  const TEXT = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]):not([type=file]):not([role=combobox]):not([aria-haspopup=listbox]), textarea';
  const CHOICE = 'select, [role="combobox"], [aria-haspopup="listbox"]';

  /* The first control of that kind after the label, in the nearest container
     that has one. Earlier fields' controls come before the label and are
     never picked. */
  function controlFor(label, selector) {
    const id = label.getAttribute('for');
    if (id) { const linked = document.getElementById(id); if (linked?.matches(selector)) return linked; }
    if (label.id) {
      const named = [...document.querySelectorAll('[aria-labelledby]')].find(node => node.getAttribute('aria-labelledby').split(/\s+/).includes(label.id));
      if (named?.matches(selector)) return named;
    }
    let scope = label.parentElement;
    for (let depth = 0; scope && depth < 6; depth++, scope = scope.parentElement) {
      const found = [...scope.querySelectorAll(selector)].find(node => !ours(node) && !node.disabled && visible(node) &&
        (label.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING));
      if (found) return found;
    }
    return null;
  }

  async function waitFor(find, ms, every = POLL_MS) {
    const deadline = Date.now() + ms;
    for (;;) {
      const found = find();
      if (found || Date.now() >= deadline) return found || null;
      await sleep(every);
    }
  }

  /* React keeps its own copy of an input's value; the prototype setter plus
     an input event updates it the way typing does. */
  function setValue(control, value) {
    const prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    control.focus();
    if (setter) setter.call(control, value); else control.value = value;
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function press(node) {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      const Event_ = type.startsWith('pointer') && typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
      node.dispatchEvent(new Event_(type, { bubbles: true, cancelable: true, view: window }));
    }
  }

  /* Exact text first, then a prefix, then containment; a store number only
     matches as a whole number ("#878", "878 - Manchester"). */
  function pickOption(options, value, number) {
    const wanted = normalize(value);
    const texts = options.map(option => normalize(option.textContent));
    if (number) {
      const whole = new RegExp(`(^|\\D)${value.replace(/\D/g, '')}(\\D|$)`);
      return options[texts.findIndex(text => whole.test(text))] || null;
    }
    return options[texts.indexOf(wanted)] || options[texts.findIndex(text => text.startsWith(wanted))] ||
      options[texts.findIndex(text => text.includes(wanted))] || null;
  }

  async function choose(control, value, number) {
    if (control instanceof HTMLSelectElement) {
      const option = pickOption([...control.options], value, number);
      if (!option) return false;
      control.value = option.value;
      control.dispatchEvent(new Event('input', { bubbles: true }));
      control.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    press(control);
    control.focus();
    // Typing narrows long lists such as UBIF Location.
    if (control instanceof HTMLInputElement) setValue(control, number ? value.replace(/\D/g, '') : value);
    const option = await waitFor(() => pickOption([...document.querySelectorAll('[role="option"]')].filter(node => !ours(node) && visible(node)), value, number), OPTION_MS);
    if (!option) {
      control.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return false;
    }
    option.scrollIntoView?.({ block: 'nearest' });
    press(option);
    await sleep(POLL_MS);
    return true;
  }

  function submitButton() {
    return [...document.querySelectorAll('button, input[type=submit]')].find(node => !ours(node) && !node.disabled && visible(node) &&
      /^submit$/i.test((node.value || node.textContent || '').trim())) || null;
  }

  async function fill(job) {
    const steps = M.steps(job), failed = [];
    let first = true;
    for (const step of steps) {
      show('working', `Filling ${step.label}…`);
      const selector = step.dropdown ? CHOICE : TEXT;
      const control = await waitFor(() => { const label = findLabel(step.label); return label && controlFor(label, selector); }, first ? FIRST_FIELD_MS : NEXT_FIELD_MS, 100);
      first = false;
      let ok = false;
      try {
        if (control && step.dropdown) ok = await choose(control, step.value, step.number);
        else if (control) { setValue(control, step.value); control.dispatchEvent(new Event('blur')); ok = true; }
      } catch { ok = false; }
      if (!ok) failed.push(step.label);
      await sleep(POLL_MS);
    }
    return { filled: steps.length - failed.length, total: steps.length, failed };
  }

  function show(state, message, detail = '') {
    if (!banner) {
      const host = document.createElement('div');
      host.setAttribute('data-ubif-sprinklr', '');
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `<style>
        :host{position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;width:min(560px,calc(100vw - 32px));font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
        .box{display:flex;gap:12px;align-items:flex-start;padding:14px 16px;border-radius:10px;background:#1f1d24;color:#f4f2f7;box-shadow:0 8px 28px #0000004d}
        .box[data-state=done]{background:#123d2a}.box[data-state=warn]{background:#4a2a07}
        .text{flex:1;min-width:0}strong{display:block;font-weight:600}p{margin:2px 0 0;color:#dcd8e2;overflow-wrap:anywhere}
        button{border:0;background:none;color:inherit;font-size:20px;line-height:1;cursor:pointer;padding:0 4px}
      </style><div class="box" role="status" aria-live="polite"><div class="text"><strong></strong><p></p></div><button type="button" aria-label="Dismiss">×</button></div>`;
      shadow.querySelector('button').addEventListener('click', () => host.remove());
      (document.body || document.documentElement).append(host);
      banner = shadow;
    }
    banner.querySelector('.box').dataset.state = state;
    banner.querySelector('strong').textContent = `UBIF NextGen Plus · ${message}`;
    banner.querySelector('p').textContent = detail;
  }

  async function job() {
    // The worker stores the job just after it opens this tab.
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const reply = await chrome.runtime.sendMessage({ type: 'ubif-plus-samsung-job' });
        if (reply?.job) return reply.job;
      } catch { return null; }
      await sleep(250);
    }
    return null;
  }

  async function run() {
    const current = await job();
    if (!current) return;
    const definition = M.FORMS[current.form];
    show('working', `Filling ${definition.name}…`);
    const result = await fill(current);
    let submitted = false;
    if (current.autoSubmit && !result.failed.length) {
      const button = await waitFor(submitButton, 2000);
      if (button) { press(button); submitted = true; }
    }
    try { await chrome.runtime.sendMessage({ type: 'ubif-plus-samsung-done' }); } catch { /* the job expires anyway */ }
    if (submitted) show('done', `${definition.name} submitted`, 'Check Sprinklr for the confirmation.');
    else if (result.failed.length) show('warn', `Filled ${result.filled} of ${result.total} fields`, `Fill these yourself, then submit: ${result.failed.join(', ')}.`);
    else show('done', `${definition.name} filled`, definition.note || (current.autoSubmit ? 'Submit was not found. Review the form, then submit.' : 'Review the form, then submit.'));
  }

  globalThis.UBIFPlusSprinklr = Object.freeze({ findLabel, controlFor, pickOption, fill });
  if (location.origin === M.FORM_ORIGIN) run();
})();
