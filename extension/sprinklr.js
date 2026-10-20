/* Fills a Samsung exception request on Sprinklr's guided-workflow form. Runs
   only in a tab the extension opened from a Portal work order: the background
   worker hands this tab its job, and any other Sprinklr page gets none.

   Finding fields follows WD40's Portal Pro, which fills this form today: a
   label is any element, or a "label"-classed one, whose text holds the field
   name; a dropdown is the combobox input after it, opened by clicking it and
   its parent, typed into, and answered by clicking a matching option. An
   exact label wins over one that only contains the name, and a label that
   names a longer field ("Store Email Address") never stands in for a shorter
   one ("Email Address"). A control named by aria-label or placeholder counts
   too. The search reaches into shadow roots and same-origin frames, since
   Sprinklr's widgets may render in either. Each later label is waited for,
   because Sprinklr shows the follow-up questions only after the dropdowns
   before them are chosen. If none of the form's labels ever appear, the
   banner says so at once and lists the labels the page does have. The form
   is submitted only when the technician asked for it and every field filled;
   otherwise a banner asks them to review and submit. */
(() => {
  'use strict';
  if (globalThis.__ubifPlusSprinklr) return;
  globalThis.__ubifPlusSprinklr = true;
  const M = globalThis.UBIFPlusSamsung;
  if (!M) return;
  const TIMINGS = Object.freeze({ firstField: 30000, nextField: 5000, option: 3000 });
  const POLL_MS = 50;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const normalize = value => String(value || '').replace(/[*:]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  let banner = null;

  const windowOf = node => node.ownerDocument?.defaultView || window;
  const hostOf = node => node.parentElement || (node.parentNode instanceof windowOf(node).ShadowRoot ? node.parentNode.host : null);
  function visible(node) {
    for (let current = node; current && current.nodeType === 1; current = hostOf(current)) {
      if (current.hidden) return false;
      const style = windowOf(current).getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  }
  const ours = node => Boolean(node.closest?.('[data-ubif-sprinklr]'));

  /* The page document, then every shadow root and same-origin frame inside
     it. A content script can open closed shadow roots too. */
  function roots() {
    const found = [], pending = [document];
    while (pending.length) {
      const root = pending.shift();
      found.push(root);
      for (const node of root.querySelectorAll('*')) {
        if (ours(node)) continue;
        const shadow = globalThis.chrome?.dom?.openOrClosedShadowRoot?.(node) || node.shadowRoot;
        if (shadow) pending.push(shadow);
        if (node.tagName === 'IFRAME' || node.tagName === 'FRAME') {
          try { if (node.contentDocument?.body) pending.push(node.contentDocument); } catch { /* another origin */ }
        }
      }
    }
    return found;
  }
  const all = (selector, scopes = roots()) => scopes.flatMap(root => [...root.querySelectorAll(selector)]);

  /* Elements that may be labels, in page order: labelled ones first, then
     the parent of every text node, as Portal Pro searches. */
  function labelCandidates(scopes) {
    const marked = all('label, legend, [class*="label" i]', scopes), parents = [];
    for (const root of scopes) {
      const walker = (root.ownerDocument || root).createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.parentElement && node.textContent.trim()) parents.push(node.parentElement);
    }
    return [...new Set([...marked, ...parents])].filter(node => !ours(node) &&
      !node.closest('[role="option"], [role="listbox"], select, option, button, script, style'));
  }

  /* The label for a field: the innermost visible element whose whole text is
     the name, else the first whose text contains it and no longer field name
     from `others`. */
  function findLabel(text, scopes = roots(), others = []) {
    const wanted = normalize(text);
    const longer = others.map(normalize).filter(other => other !== wanted && other.includes(wanted));
    const candidates = labelCandidates(scopes);
    let best = null;
    for (const node of candidates) {
      if (normalize(node.textContent) !== wanted || !visible(node)) continue;
      if (!best || best.contains(node)) best = node;
    }
    if (best) return best;
    return candidates.find(node => {
      const own = normalize(node.textContent);
      return own.length < wanted.length + 40 && own.includes(wanted) && !longer.some(other => own.includes(other)) && visible(node);
    }) || null;
  }

  const TEXT = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([type=button]):not([type=file]):not([role=combobox]):not([aria-haspopup=listbox]), textarea';
  const CHOICE = 'select, [role="combobox"], [aria-haspopup="listbox"]';
  const usable = node => !ours(node) && !node.disabled && visible(node);

  /* The first control of that kind after the label, in the nearest container
     that has one. Earlier fields' controls come before the label and are
     never picked. */
  function controlFor(label, selector) {
    const root = label.getRootNode();
    const id = label.getAttribute('for');
    if (id) { const linked = root.getElementById?.(id); if (linked?.matches(selector)) return linked; }
    if (label.id) {
      const named = [...root.querySelectorAll('[aria-labelledby]')].find(node => node.getAttribute('aria-labelledby').split(/\s+/).includes(label.id));
      if (named?.matches(selector)) return named;
    }
    let scope = label.parentElement;
    for (let depth = 0; scope && depth < 6; depth++, scope = scope.parentElement) {
      const found = [...scope.querySelectorAll(selector)].find(node => usable(node) &&
        (label.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING));
      if (found) return found;
    }
    return null;
  }

  /* A control that names itself: aria-label or placeholder equal to the label. */
  function namedControl(text, selector, scopes) {
    const wanted = normalize(text);
    return all(selector, scopes).find(node => usable(node) &&
      (normalize(node.getAttribute('aria-label')) === wanted || normalize(node.getAttribute('placeholder')) === wanted)) || null;
  }

  function findControl(text, selector, others) {
    const scopes = roots(), label = findLabel(text, scopes, others);
    return (label && controlFor(label, selector)) || namedControl(text, selector, scopes);
  }

  /* Labels the page does show, for the banner when none of ours appear. */
  function pageLabels() {
    const scopes = roots(), seen = new Set();
    for (const node of all('label, legend', scopes)) if (!ours(node) && visible(node)) seen.add(node.textContent.replace(/\s+/g, ' ').replace(/\s*\*$/, '').trim());
    for (const node of all(`${TEXT}, ${CHOICE}`, scopes)) if (usable(node)) seen.add((node.getAttribute('aria-label') || node.getAttribute('placeholder') || '').trim());
    seen.delete('');
    return [...seen].slice(0, 8);
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
     an input event updates it the way typing does. The prototype is taken
     from the control's own window, which differs inside a frame. */
  function setValue(control, value) {
    const view = windowOf(control);
    const prototype = control.tagName === 'TEXTAREA' ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    control.focus();
    if (setter) setter.call(control, value); else control.value = value;
    control.dispatchEvent(new view.Event('input', { bubbles: true, composed: true }));
    control.dispatchEvent(new view.Event('change', { bubbles: true }));
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

  /* Portal Pro's option lists, most specific first. */
  const OPTIONS = ['[role="option"]', '[role="listbox"] li', '[class*="option" i]', 'li'];
  function findOption(value, number) {
    for (const selector of OPTIONS) {
      const option = pickOption(all(selector).filter(node => !ours(node) && visible(node) && node.textContent.trim()), value, number);
      if (option) return option;
    }
    return null;
  }

  async function choose(control, value, number, timings) {
    const view = windowOf(control);
    if (control.tagName === 'SELECT') {
      const option = pickOption([...control.options], value, number);
      if (!option) return false;
      control.value = option.value;
      control.dispatchEvent(new view.Event('input', { bubbles: true, composed: true }));
      control.dispatchEvent(new view.Event('change', { bubbles: true }));
      return true;
    }
    // Opened the way Portal Pro opens it: a click on the box, then the input.
    control.parentElement?.click();
    control.click();
    control.focus();
    // Typing narrows long lists such as UBIF Location.
    if (control.tagName === 'INPUT') {
      control.dispatchEvent(new view.KeyboardEvent('keydown', { bubbles: true, composed: true }));
      setValue(control, number ? value.replace(/\D/g, '') : value);
    }
    const option = await waitFor(() => findOption(value, number), timings.option);
    if (!option) {
      control.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
      return false;
    }
    option.scrollIntoView?.({ block: 'nearest' });
    option.click();
    await sleep(POLL_MS);
    return true;
  }

  /* A button reading "Submit", else Portal Pro's submit selectors. */
  function submitButton() {
    const buttons = all('button, input[type=submit]').filter(usable);
    return buttons.find(node => /^submit$/i.test((node.value || node.textContent || '').trim())) ||
      buttons.find(node => node.matches('[type="submit"], [class*="submit" i], [data-testid*="submit" i]')) || null;
  }

  /* Fills each step in order. When the first field never appears and no
     other label of the form is on the page either, it stops: this is not
     the form it expects, and waiting on every field would only look stuck. */
  async function fill(job, timings = TIMINGS) {
    const steps = M.steps(job), failed = [], labels = steps.map(step => step.label);
    for (const [index, step] of steps.entries()) {
      show('working', index ? `Filling ${step.label}…` : 'Waiting for the Sprinklr form…');
      const selector = step.dropdown ? CHOICE : TEXT;
      const control = await waitFor(() => findControl(step.label, selector, labels), index ? timings.nextField : timings.firstField, 100);
      if (!control && !index && !steps.some(other => findLabel(other.label, roots(), labels) || namedControl(other.label, other.dropdown ? CHOICE : TEXT))) {
        return { filled: 0, total: steps.length, failed: steps.map(other => other.label), notFound: true, labels: pageLabels() };
      }
      let ok = false;
      try {
        if (control && step.dropdown) ok = await choose(control, step.value, step.number, timings);
        else if (control) { setValue(control, step.value); control.dispatchEvent(new (windowOf(control).Event)('blur')); ok = true; }
      } catch { ok = false; }
      if (!ok) failed.push(step.label);
      await sleep(POLL_MS);
    }
    return { filled: steps.length - failed.length, total: steps.length, failed, notFound: false, labels: [] };
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

  async function claim() {
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

  async function run(current, timings = TIMINGS) {
    const definition = M.FORMS[current?.form];
    if (!definition) return;
    show('working', `Filling ${definition.name}…`);
    let result;
    try { result = await fill(current, timings); } catch (error) {
      // Kept for a reload of this tab, which tries again.
      show('warn', `Could not fill ${definition.name}`, `Fill the form yourself, then submit. (${error?.message || error})`);
      return;
    }
    let submitted = false;
    if (current.autoSubmit && !result.failed.length) {
      const button = await waitFor(submitButton, 2000);
      if (button) { button.click(); submitted = true; }
    }
    try { await chrome.runtime.sendMessage({ type: 'ubif-plus-samsung-done' }); } catch { /* the job expires anyway */ }
    if (result.notFound) show('warn', `Could not find the ${definition.name} fields`,
      `Fill the form yourself, then submit. Looked for "${result.failed[0]}"${result.labels.length ? `; this page shows ${result.labels.map(label => `"${label}"`).join(', ')}` : ''}.`);
    else if (submitted) show('done', `${definition.name} submitted`, 'Check Sprinklr for the confirmation.');
    else if (result.failed.length) show('warn', `Filled ${result.filled} of ${result.total} fields`, `Fill these yourself, then submit: ${result.failed.join(', ')}.`);
    else show('done', `${definition.name} filled`, definition.note || (current.autoSubmit ? 'Submit was not found. Review the form, then submit.' : 'Review the form, then submit.'));
  }

  globalThis.UBIFPlusSprinklr = Object.freeze({ findLabel, controlFor, findControl, pickOption, fill, run });
  if (location.origin === M.FORM_ORIGIN) claim().then(current => run(current));
})();
