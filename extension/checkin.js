/* MAIN world: custom diagnosis fields use the mounted native Notes textarea's
 * own React onChange. Portal then saves them with additionalDetails, alongside
 * its normal diagnosis, through its existing checkin/workorder update. */
(() => {
  'use strict';
  if (globalThis.__ubifPlusCheckin) return;
  globalThis.__ubifPlusCheckin = true;
  const START = '[UBIF Plus check-in]', END = '[/UBIF Plus check-in]';
  const fields = [
    ['model', 'Model', 100], ['color', 'Color', 80], ['issue', 'Device Issue', 400],
    ['fmip', 'FMIP', ['off', 'on']], ['accessories', 'Accessories Offered', ['yes', 'no']],
    ['services', 'Services Offered', ['yes', 'no']], ['eta', 'ETA', 100], ['price', 'Price Est', 100]
  ];
  const selector = '[data-testid="additional-details-note"], [data-testid="DeviceDiagSubIssues_Notes"]';
  let active = null;
  function split(value) {
    const start = value.indexOf(START), end = value.indexOf(END, start);
    if (start < 0 || end < 0) return { native: value, values: {} };
    const lines = value.slice(start + START.length, end).trim().split('\n');
    const values = {};
    for (const [key, label] of fields) {
      const line = lines.find(line => line.startsWith(`${label}: `));
      if (line) values[key] = line.slice(label.length + 2);
    }
    return { native: (value.slice(0, start).replace(/\n\n$/, '') + value.slice(end + END.length)), values };
  }
  function handlerFor(textarea) {
    const key = Object.keys(textarea).find(key => key.startsWith('__reactProps$'));
    return key ? textarea[key]?.onChange : null;
  }
  // Read only the rendered diagnosis element props, including collapsed
  // accordion children. Never change React state or invoke disabled actions.
  function diagnosisGroups(textarea) {
    const key = Object.keys(textarea).find(key => key.startsWith('__reactFiber$'));
    let fiber = key ? textarea[key] : null, top = fiber;
    while (top?.return) top = top.return;
    if (top?.stateNode?.current && top.stateNode.current !== top) fiber = fiber?.alternate || fiber;
    for (let depth = 0; fiber && depth++ < 35; fiber = fiber.return) {
      const groups = new Map(); let budget = 5000;
      function visit(value, category) {
        if (!value || --budget < 0) return;
        if (Array.isArray(value)) { value.forEach(child => visit(child, category)); return; }
        const props = value.props;
        if (!props) return;
        const id = props['data-testid'];
        if (typeof props.header === 'string' && typeof props.onOpenStateChange === 'function' &&
            /^(device-issue-accordion-section-\d+|\d+_.+)$/.test(id || '')) category = id;
        if (category && /^no issues?$/i.test(String(props.label || '').trim()) && typeof props.onChange === 'function') {
          if (groups.has(category)) groups.set(category, null); else groups.set(category, props);
        }
        visit(props.children, category);
      }
      visit(fiber.memoizedProps?.children, null);
      if (groups.size) return groups;
    }
    return new Map();
  }
  function mountShortcut(textarea) {
    const groups = diagnosisGroups(textarea);
    const first = [...groups.keys()].map(id => [...document.querySelectorAll('[data-testid]')].find(node => node.dataset.testid === id)).find(Boolean);
    if (!first) return null;
    let scope = textarea.parentElement;
    while (scope && !scope.contains(first)) scope = scope.parentElement;
    if (!scope) return null;
    let before = first;
    while (before.parentElement !== scope) before = before.parentElement;
    const host = document.createElement('div'); host.id = 'ubif-plus-battery-shortcut';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>:host{display:block;margin:0 0 16px;font:inherit;color:var(--aui-on-surface,#282532)}button{padding:10px 16px;border:1px solid var(--aui-outline,#a6a0b0);border-radius:4px;background:transparent;color:inherit;font:inherit;cursor:pointer}button:hover:not(:disabled){background:var(--aui-elevated-level-01,#f5f3f7)}button:focus-visible{outline:2px solid var(--aui-primary,#8224ce);outline-offset:2px}button:disabled{opacity:.5;cursor:default}p{margin:8px 0 0;font-size:12px}p:empty{display:none}</style><button type="button" title="Mark every diagnosis category as No issues">Battery not working</button><p role="status" aria-live="polite"></p>`;
    const button = root.querySelector('button'), status = root.querySelector('[role=status]');
    let running = false, disposed = false;
    const update = () => {
      const current = diagnosisGroups(textarea);
      const disabled = running || !current.size || [...current.values()].some(action => !action || action.disabled);
      if (button.disabled !== disabled) button.disabled = disabled;
    };
    button.addEventListener('click', async () => {
      if (running || disposed || !textarea.isConnected || !/^\/check-in\/?$/.test(location.pathname)) return;
      const initial = diagnosisGroups(textarea);
      if (!initial.size || [...initial.values()].some(action => !action || action.disabled)) return;
      running = true; update(); status.textContent = 'Marking diagnosis categories…';
      try {
        for (const id of initial.keys()) {
          if (disposed || !textarea.isConnected || !/^\/check-in\/?$/.test(location.pathname)) return;
          const action = diagnosisGroups(textarea).get(id);
          if (!action || action.disabled) throw new Error('A diagnosis category is unavailable. Review the native selections.');
          if (action.checked) continue;
          action.onChange();
          // Each Portal callback closes over that render's selected issues.
          // Wait for the new checked props before using the next callback.
          let confirmed = false;
          for (let attempt = 0; attempt < 50; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 20));
            if (disposed || !textarea.isConnected || !/^\/check-in\/?$/.test(location.pathname)) return;
            if (diagnosisGroups(textarea).get(id)?.checked) { confirmed = true; break; }
          }
          if (!confirmed) throw new Error('Portal has not confirmed the selection. Review the native selections.');
        }
        status.textContent = 'Diagnosis categories marked No issues. Extra Details kept.';
      } catch (error) { status.textContent = error.message || 'Review the native diagnosis selections.'; }
      finally { running = false; if (!disposed) update(); }
    });
    before.before(host); update();
    return { update, dispose() { disposed = true; host.remove(); } };
  }
  function mount(textarea, anchor) {
    const host = document.createElement('section');
    host.id = 'ubif-plus-checkin';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host{display:block;margin:0 0 24px;color:var(--aui-on-surface,#282532);font:inherit}
      section{padding:0}h3{margin:0 0 16px;font-size:20px;line-height:1.4;font-weight:300}
      .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px 24px}
      label{display:flex;flex-direction:column;gap:8px;font-size:14px;line-height:1.5}
      input,select{box-sizing:border-box;width:100%;height:48px;padding:12px 16px;border:1px solid var(--aui-outline,#a6a0b0);border-radius:4px;background:var(--aui-surface,#fff);color:inherit;font:inherit}
      input:focus,select:focus{outline:2px solid var(--aui-primary,#8224ce);outline-offset:1px}
      [role=status]{margin:8px 0 0;font-size:12px;color:var(--aui-on-surface-soft,#615b6b)}[role=status]:empty{display:none}[data-error=true]{color:var(--aui-error,#b3261e)}
      @media(max-width:600px){.grid{grid-template-columns:1fr}}
      </style><section aria-labelledby="heading"><h3 id="heading">Extra Details</h3><div class="grid"></div><p role="status" aria-live="polite"></p></section>`;
    const grid = root.querySelector('.grid'), status = root.querySelector('[role=status]');
    const controls = {}, parsed = split(textarea.value);
    let values = parsed.values, observedText = textarea.value, nativeEditPending = false;
    for (const [key, label, kind] of fields) {
      const wrapper = document.createElement('label'); wrapper.textContent = label;
      const control = document.createElement(Array.isArray(kind) ? 'select' : 'input');
      control.name = key;
      if (Array.isArray(kind)) {
        for (const value of ['', ...kind]) {
          const option = document.createElement('option'); option.value = value; option.textContent = value || 'Select…'; control.append(option);
        }
      } else { control.type = 'text'; control.maxLength = kind; }
      if (key === 'eta') control.placeholder = 'Time, date, or unsure';
      control.value = values[key] || '';
      controls[key] = control; wrapper.append(control); grid.append(wrapper);
      control.addEventListener(Array.isArray(kind) ? 'change' : 'input', () => sync(key));
    }
    function sync(changed) {
      const handler = handlerFor(textarea);
      if (!host.isConnected || !textarea.isConnected || !/^\/check-in\/?$/.test(location.pathname) || typeof handler !== 'function' || textarea.disabled || textarea.readOnly) return;
      const next = Object.fromEntries(fields.map(([key]) => [key, controls[key].value]));
      const native = split(textarea.value).native;
      const block = fields.some(([key]) => next[key]) ? [START, ...fields.map(([key, label]) => `${label}: ${next[key]}`), END].join('\n') : '';
      const combined = native + (native && block ? '\n\n' : '') + block;
      if (combined.length > 2000) {
        if (changed) controls[changed].value = values[changed] || '';
        status.textContent = 'That entry exceeds Portal’s 2,000-character Notes limit. Shorten the notes or Extra Details, then enter it again.';
        status.dataset.error = 'true'; return;
      }
      if (combined !== textarea.value) {
        const previous = textarea.value;
        try {
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, combined);
          // Verified Portal callbacks read only event.target.value.
          const event = new Event('change', { bubbles: true });
          Object.defineProperties(event, { target: { value: textarea }, currentTarget: { value: textarea } });
          handler(event);
        } catch {
          textarea.value = previous;
          if (changed) controls[changed].value = values[changed] || '';
          status.textContent = 'Extra Details could not be applied. Reopen device diagnosis and try again.';
          status.dataset.error = 'true'; return;
        }
      }
      values = next;
      observedText = combined;
      status.textContent = '';
      status.dataset.error = 'false';
    }
    // Native notes edits retain the custom section; changes still use Portal's
    // handler. No separate requests, customer storage, or background retries.
    const onNativeInput = () => {
      nativeEditPending = true;
      queueMicrotask(() => { sync(); nativeEditPending = false; });
    };
    textarea.addEventListener('input', onNativeInput);
    anchor.before(host);
    let shortcut = mountShortcut(textarea);
    const update = () => {
      // Portal may finish loading saved notes after the textarea first mounts.
      if (!nativeEditPending && textarea.value !== observedText) {
        observedText = textarea.value;
        values = split(observedText).values;
        for (const [key] of fields) controls[key].value = values[key] || '';
      }
      if (!shortcut) shortcut = mountShortcut(textarea);
      shortcut?.update();
      const enabled = typeof handlerFor(textarea) === 'function' && !textarea.disabled && !textarea.readOnly;
      for (const control of Object.values(controls)) if (control.disabled !== !enabled) control.disabled = !enabled;
      if (!enabled) status.textContent = 'Waiting for Portal’s editable diagnosis notes.';
    };
    update();
    return { textarea, host, update, dispose() { textarea.removeEventListener('input', onNativeInput); shortcut?.dispose(); host.remove(); } };
  }
  function refresh() {
    const inCheckin = /^\/check-in\/?$/.test(location.pathname);
    const candidates = inCheckin ? [...document.querySelectorAll(selector)].flatMap(node => node.matches('textarea') ? [node] : [...node.querySelectorAll('textarea')]) : [];
    const textarea = candidates.length === 1 ? candidates[0] : null;
    if (active && (active.textarea !== textarea || !active.host.isConnected)) { active.dispose(); active = null; }
    if (active) { active.update(); return; }
    if (!textarea) return;
    const anchor = textarea.closest('.note') || textarea.closest(selector) || textarea.parentElement;
    active = mount(textarea, anchor);
  }
  const observer = new MutationObserver(refresh);
  function start() { observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'readonly'] }); refresh(); }
  if (document.documentElement) start(); else addEventListener('DOMContentLoaded', start, { once: true });
  addEventListener('popstate', refresh);
  addEventListener('pagehide', () => { observer.disconnect(); active?.dispose(); active = null; });
  addEventListener('pageshow', start);
})();
