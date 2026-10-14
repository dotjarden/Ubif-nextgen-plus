/* MAIN world: custom diagnosis fields use the mounted native Notes textarea's
 * own React onChange. Portal then saves them with additionalDetails, alongside
 * its normal diagnosis, through its existing checkin/workorder update. */
(() => {
  'use strict';
  if (globalThis.__ubifPlusCheckin) return;
  globalThis.__ubifPlusCheckin = true;
  const LEGACY_START = '[UBIF Plus check-in]', LEGACY_END = '[/UBIF Plus check-in]';
  const HEADING = 'Extra Details:';
  const fields = [
    ['model', 'Model', 100], ['color', 'Color', 80], ['issue', 'Device Issue', 400],
    ['fmip', 'FMIP', ['off', 'on']], ['accessories', 'Accessories Offered', ['yes', 'no']],
    ['services', 'Services Offered', ['yes', 'no']], ['eta', 'ETA', 100], ['price', 'Price Est', 100]
  ];
  const selector = '[data-testid="additional-details-note"], [data-testid="DeviceDiagSubIssues_Notes"]';
  let active = null, config = { checkin: true, checkinBattery: true };
  function split(value) {
    const legacyStart = value.indexOf(LEGACY_START), legacyEnd = value.indexOf(LEGACY_END, legacyStart);
    let start, end, lines;
    if (legacyStart >= 0 && legacyEnd >= 0) {
      start = legacyStart; end = legacyEnd + LEGACY_END.length;
      lines = value.slice(start + LEGACY_START.length, legacyEnd).trim().split('\n');
    } else {
      // Only recognize the complete ordered section we generate. Ordinary notes
      // mentioning Extra Details or individual labels remain untouched.
      const pattern = new RegExp('(?:^|\\n)' + HEADING + '\\n' + fields.map(([, label]) => label + ': ([^\\n]*)').join('\\n') + '(?=\\n|$)', 'g');
      const match = pattern.exec(value);
      if (!match) return { native: value, values: {} };
      start = match.index + (match[0].startsWith('\n') ? 1 : 0); end = match.index + match[0].length;
      lines = value.slice(start + HEADING.length + 1, end).split('\n');
    }
    const values = {};
    for (const [key, label] of fields) {
      const line = lines.find(line => line.startsWith(`${label}: `));
      if (line) values[key] = line.slice(label.length + 2);
    }
    return { native: value.slice(0, start).replace(/\n\n$/, '') + value.slice(end), values };
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
    let path = [];
    if (top?.stateNode?.current) {
      // React leaves the DOM's __reactFiber pointer on its original alternate.
      // Bailouts also reuse return pointers, so comparing that chain's root and
      // swapping one alternate can still select an old render. Resolve the
      // textarea through the committed root, retaining the actual parent path.
      const stack = [[top.stateNode.current, []]]; let budget = 30000;
      while (stack.length && budget-- > 0) {
        const [node, parents] = stack.pop();
        if (node.stateNode === textarea) { path = [node, ...parents]; break; }
        if (node.sibling) stack.push([node.sibling, parents]);
        if (node.child) stack.push([node.child, [node, ...parents]]);
      }
      if (!path.length) return new Map();
    } else {
      // Older Portal renderers and lightweight fixtures without a root handle.
      for (let depth = 0; fiber && depth++ < 35; fiber = fiber.return) path.push(fiber);
    }
    let best = new Map();
    for (const current of path) {
      const groups = new Map(), options = new Map(), reasons = new Map(), sections = new Map(); let budget = 5000;
      function visit(value, category) {
        if (!value || --budget < 0) return;
        if (Array.isArray(value)) { value.forEach(child => visit(child, category)); return; }
        const props = value.props;
        if (!props) return;
        const id = props['data-testid'];
        if (typeof props.header === 'string' && typeof props.onOpenStateChange === 'function' &&
            /^(device-issue-accordion-section-\d+|\d+_.+)$/.test(id || '')) {
          category = id; options.set(category, []); sections.set(category, props);
        }
        if (category && typeof props.label === 'string' && typeof props.checked === 'boolean' && typeof props.onChange === 'function') {
          options.get(category)?.push(props);
        }
        if (category && id === 'cant-test-label-note' && typeof props.onChange === 'function') reasons.set(category, props);
        visit(props.children, category);
      }
      visit(current.memoizedProps?.children, null);
      for (const [category, actions] of options) {
        const targets = actions.filter(action => /^(?:can['’]?t|cannot) test$/i.test(action.label.trim()));
        groups.set(category, targets.length === 1 ? { ...targets[0], others: actions.filter(action => action.checked && action !== targets[0]), reason: reasons.get(category), section: sections.get(category) } : null);
      }
      // An inner render can contain Hardware alone. Continue outward to the
      // full diagnosis element so collapsed sibling categories are included.
      const score = map => [...map.values()].reduce((total, action) => total + (action?.reason ? 1 : 0), 0);
      if (groups.size > best.size || groups.size === best.size && score(groups) > score(best)) best = groups;
    }
    return best;
  }
  function mountShortcut(textarea) {
    if (!config.checkinBattery) return null;
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
    root.innerHTML = `<style>
      :host{display:block;margin:0 0 20px;font:inherit;color:var(--aui-on-surface,#282532)}
      .row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
      button{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;min-height:40px;border:1px solid var(--aui-outline,#a6a0b0);border-radius:20px;background:transparent;color:inherit;font:inherit;font-size:14px;cursor:pointer}
      button svg{width:18px;height:18px}button:hover:not(:disabled){background:var(--aui-elevated-level-01,#f5f3f7)}button[aria-pressed=true]{color:var(--aui-primary,#8224ce);border-color:currentColor;background:var(--aui-primary-container,#f3eafa)}
      button:focus-visible{outline:2px solid var(--aui-primary,#8224ce);outline-offset:2px}button:disabled{opacity:.5;cursor:default}p{margin:6px 0 0;font-size:12px;color:var(--aui-on-surface-soft,#615b6b)}p:empty{display:none}
      </style><div class="row"><button type="button" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="7" width="16" height="10" rx="2"/><path d="M21 10v4M11 9l-2 4h4l-2 3"/></svg><span>Battery not working</span></button></div><p role="status" aria-live="polite"></p>`;
    const button = root.querySelector('button'), status = root.querySelector('[role=status]');
    let running = false, disposed = false;
    const available = action => action && !action.others.some(other => other.disabled) && (action.checked || !action.disabled || action.others.length > 0);
    const update = () => {
      const current = diagnosisGroups(textarea);
      const disabled = running || !current.size || [...current.values()].some(action => !available(action));
      if (button.disabled !== disabled) button.disabled = disabled;
      const applied = current.size > 0 && [...current.values()].every(action => action?.checked && !action.others.length);
      button.setAttribute('aria-pressed', String(applied));
    };
    button.addEventListener('click', async () => {
      if (running || disposed || !textarea.isConnected || !/^\/check-in\/?$/.test(location.pathname)) return;
      const initial = diagnosisGroups(textarea);
      if (!initial.size || [...initial.values()].some(action => !available(action))) return;
      running = true; update();
      let completed = 0;
      status.textContent = `Updating diagnosis: 0 of ${initial.size} categories…`;
      try {
        for (const id of initial.keys()) {
          if (disposed || !textarea.isConnected || !/^\/check-in\/?$/.test(location.pathname)) return;
          async function confirmed(predicate, waitingFor = 'the Can’t test selection') {
            for (let attempt = 0; attempt < 100; attempt++) {
              await new Promise(resolve => setTimeout(resolve, 20));
              if (disposed || !textarea.isConnected || !/^\/check-in\/?$/.test(location.pathname)) throw new Error('Check-in changed. Review the current diagnosis.');
              const current = diagnosisGroups(textarea).get(id);
              if (current && predicate(current)) return current;
            }
            throw new Error(`${action?.section?.header || id}: Portal has not confirmed ${waitingFor}. Review this category.`);
          }
          let action = diagnosisGroups(textarea).get(id);
          if (!available(action)) throw new Error('A diagnosis category is unavailable. Review the native selections.');
          // Clear conflicting selections through their own current callbacks.
          // Can't test is disabled by Portal while real issues are selected.
          for (let step = 0; action.others.length && step < 100; step++) {
            const other = action.others[0];
            if (other.disabled) throw new Error('An existing issue cannot be cleared. Review the native selections.');
            other.onChange();
            action = await confirmed(current => !current.others.some(selected => selected.label === other.label));
          }
          if (action.others.length) throw new Error('Existing issues could not be cleared. Review the native selections.');
          if (!action.checked) {
            if (action.disabled) throw new Error('Can’t test is unavailable for this category. Review the native selections.');
            action.onChange();
            action = await confirmed(current => current.checked);
          }
          // Standard Portal requires a reason for every Can't test category.
          // Ensure its textarea has mounted, even if the accordion was collapsed.
          if (!action.reason && textarea.closest('[data-testid="additional-details-note"]')) {
            if (action.section?.isOpen === false) action.section.onOpenStateChange();
            action = await confirmed(current => !!current.reason, 'the required reason field');
          }
          const reason = action.reason;
          if (reason && String(reason.value || '').replace(/\s/g, '').length < 10) {
            if (reason.disabled || reason.readOnly) throw new Error('The required test reason cannot be edited. Review the native notes.');
            const text = [reason.value, 'Unable to test because the battery is not working.'].filter(Boolean).join(' ');
            const event = new Event('change', { bubbles: true });
            Object.defineProperty(event, 'target', { value: { value: text } });
            reason.onChange(event);
            await confirmed(current => current.reason?.value === text, 'the reason text');
          }
          completed++; status.textContent = `Updating diagnosis: ${completed} of ${initial.size} categories…`;
        }
        const final = diagnosisGroups(textarea);
        if (final.size !== initial.size || [...initial.keys()].some(id => !final.get(id)?.checked || final.get(id).others.length)) throw new Error('Diagnosis changed during the update. Review the native selections.');
        status.textContent = `All ${initial.size} diagnosis categories marked Can’t test.`;
      } catch (error) { status.textContent = `${completed} of ${initial.size} categories updated. ${error.message || 'Review the native diagnosis selections.'}`; }
      finally { running = false; if (!disposed) update(); }
    });
    const heading = scope.querySelector('[data-testid="device-diagnosis-title"]') || [...scope.querySelectorAll('h2,h3')].find(node => /^device diagnosis$/i.test(node.textContent.trim()));
    if (heading) heading.after(host); else before.before(host);
    update();
    return { update, isRunning: () => running, dispose() { disposed = true; host.remove(); } };
  }
  function mount(textarea, anchor) {
    const host = document.createElement('section');
    host.id = 'ubif-plus-checkin';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host{display:block;margin:0 0 24px;color:var(--aui-on-surface,#282532);font:inherit}
      section{padding:0}h3{margin:0 0 16px;font-size:20px;line-height:1.4;font-weight:300}
      .required-hint{margin:-8px 0 16px;font-size:13px;color:var(--aui-on-surface-soft,#615b6b)}
      .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px 24px}
      label{display:flex;flex-direction:column;gap:8px;font-size:14px;line-height:1.5}
      input,select{box-sizing:border-box;width:100%;height:48px;padding:12px 16px;border:1px solid var(--aui-outline,#a6a0b0);border-radius:4px;background:var(--aui-surface,#fff);color:inherit;font:inherit}
      input:focus,select:focus{outline:2px solid var(--aui-primary,#8224ce);outline-offset:1px}
      [role=status]{margin:8px 0 0;font-size:12px;color:var(--aui-on-surface-soft,#615b6b)}[role=status]:empty{display:none}[data-error=true]{color:var(--aui-error,#b3261e)}
      @media(max-width:600px){.grid{grid-template-columns:1fr}}
      </style><section aria-labelledby="heading"><h3 id="heading">Extra Details</h3><p class="required-hint">All fields are required. Enter “unsure” for ETA when needed.</p><div class="grid"></div><p role="status" aria-live="polite"></p></section>`;
    const grid = root.querySelector('.grid'), status = root.querySelector('[role=status]');
    const controls = {}, parsed = split(textarea.value);
    let values = parsed.values, observedText = textarea.value, nativeEditPending = false;
    for (const [key, label, kind] of fields) {
      const wrapper = document.createElement('label'); wrapper.textContent = `${label} *`;
      const control = document.createElement(Array.isArray(kind) ? 'select' : 'input');
      control.name = key; control.required = true;
      control.setAttribute('aria-required', 'true');
      control.addEventListener('input', () => control.removeAttribute('aria-invalid'));
      control.addEventListener('change', () => control.removeAttribute('aria-invalid'));
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
      if (!host.isConnected || !textarea.isConnected || !/^\/check-in\/?$/.test(location.pathname) || typeof handler !== 'function' || textarea.disabled || textarea.readOnly) return false;
      const next = Object.fromEntries(fields.map(([key]) => [key, controls[key].value]));
      const native = split(textarea.value).native;
      const block = fields.some(([key]) => next[key]) ? [HEADING, ...fields.map(([key, label]) => `${label}: ${next[key]}`)].join('\n') : '';
      const combined = native + (native && block ? '\n\n' : '') + block;
      if (combined.length > 2000) {
        if (changed) controls[changed].value = values[changed] || '';
        status.textContent = 'That entry exceeds Portal’s 2,000-character Notes limit. Shorten the notes or Extra Details, then enter it again.';
        status.dataset.error = 'true'; return false;
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
          status.dataset.error = 'true'; return false;
        }
      }
      values = next;
      observedText = combined;
      status.textContent = '';
      status.dataset.error = 'false';
      return true;
    }
    // Native notes edits retain the custom section; changes still use Portal's
    // handler. No separate requests, customer storage, or background retries.
    const onNativeInput = () => {
      nativeEditPending = true;
      queueMicrotask(() => { sync(); nativeEditPending = false; });
    };
    textarea.addEventListener('input', onNativeInput);
    anchor.before(host);
    if (textarea.value.includes(LEGACY_START) && textarea.value.includes(LEGACY_END)) sync();
    let shortcut = mountShortcut(textarea);
    const update = () => {
      // Portal may finish loading saved notes after the textarea first mounts.
      if (!nativeEditPending && textarea.value !== observedText) {
        observedText = textarea.value;
        values = split(observedText).values;
        for (const [key] of fields) controls[key].value = values[key] || '';
        if (textarea.value.includes(LEGACY_START) && textarea.value.includes(LEGACY_END)) sync();
      }
      if (!config.checkinBattery) { shortcut?.dispose(); shortcut = null; }
      if (!shortcut) shortcut = mountShortcut(textarea);
      shortcut?.update();
      const enabled = typeof handlerFor(textarea) === 'function' && !textarea.disabled && !textarea.readOnly;
      for (const control of Object.values(controls)) if (control.disabled !== !enabled) control.disabled = !enabled;
      if (!enabled) status.textContent = 'Waiting for Portal’s editable diagnosis notes.';
    };
    update();
    function validate() {
      if (shortcut?.isRunning()) { status.textContent = 'Wait for the battery diagnosis update to finish.'; status.dataset.error = 'true'; return false; }
      const missing = fields.filter(([key, , kind]) => {
        const value = controls[key].value.trim();
        return !value || Array.isArray(kind) && !kind.includes(value);
      });
      for (const [key] of fields) controls[key].setAttribute('aria-invalid', String(missing.some(([missingKey]) => missingKey === key)));
      if (missing.length) {
        status.textContent = `Complete Extra Details: ${missing.map(([, label]) => label).join(', ')}.`;
        status.dataset.error = 'true';
        host.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        const first = controls[missing[0][0]]; first.focus(); first.reportValidity?.();
        return false;
      }
      const stored = split(textarea.value).values;
      const alreadyApplied = fields.every(([key]) => stored[key] === controls[key].value);
      if (!alreadyApplied && !sync()) { status.textContent ||= 'Extra Details could not be applied. Reopen device diagnosis and try again.'; status.dataset.error = 'true'; return false; }
      return true;
    }
    return { textarea, host, update, validate, dispose() { textarea.removeEventListener('input', onNativeInput); shortcut?.dispose(); host.remove(); } };
  }
  function refresh() {
    const inCheckin = config.checkin && /^\/check-in\/?$/.test(location.pathname);
    const candidates = inCheckin ? [...document.querySelectorAll(selector)].flatMap(node => node.matches('textarea') ? [node] : [...node.querySelectorAll('textarea')]) : [];
    const textarea = candidates.length === 1 ? candidates[0] : null;
    if (active && (active.textarea !== textarea || !active.host.isConnected)) { active.dispose(); active = null; }
    if (active) { active.update(); return; }
    if (!textarea) return;
    const anchor = textarea.closest('.note') || textarea.closest(selector) || textarea.parentElement;
    active = mount(textarea, anchor);
  }
  addEventListener('message', event => {
    if (event.source !== window || event.data?.source !== 'ubif-plus' || event.data.type !== 'feature-settings') return;
    config = { checkin: event.data.checkin !== false, checkinBattery: event.data.checkinBattery !== false };
    refresh();
  });
  window.postMessage({ source: 'ubif-plus', type: 'feature-settings-request' }, '*');
  const observer = new MutationObserver(refresh);
  function start() { observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'readonly'] }); refresh(); }
  if (document.documentElement) start(); else addEventListener('DOMContentLoaded', start, { once: true });
  // Capture before React's delegated click handler. Shadow-root required
  // controls are outside Portal's form and need an explicit progression guard.
  function guardProgress(event) {
    if (!active || !active.textarea.isConnected || !/^\/check-in\/?$/.test(location.pathname)) return;
    const ids = new Set(['DeviceDiagIssues_Continue', 'DeviceDiagSubIssues_Continue']);
    const isContinue = event.type === 'click' && event.composedPath().some(node => ids.has(node?.getAttribute?.('data-testid')));
    const isSubmit = event.type === 'submit' && event.target?.contains(active.textarea);
    if ((isContinue || isSubmit) && !active.validate()) { event.preventDefault(); event.stopImmediatePropagation(); }
  }
  addEventListener('click', guardProgress, true);
  addEventListener('submit', guardProgress, true);
  addEventListener('popstate', refresh);
  addEventListener('pagehide', () => { observer.disconnect(); active?.dispose(); active = null; });
  addEventListener('pageshow', start);
})();
