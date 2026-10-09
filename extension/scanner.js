(() => {
  'use strict';
  if (globalThis.__ubifPlusScannerStarted) return;
  globalThis.__ubifPlusScannerStarted = true;

  // Keyboard-wedge scanners send a rapid burst followed by Enter or Tab.
  // Timing is deliberately conservative so normal typing keeps its native behavior.
  const MAX_GAP = 80, MAX_AVERAGE = 40, MAX_LENGTH = 200;
  const S = globalThis.UBIFPlusSettings;
  let enabled = true, config = {}, settingsReady = !S;
  let buffer = '', started = 0, last = 0, target = null, original = null, route = '';
  function reset() { buffer = ''; started = last = 0; target = original = null; route = ''; }
  function receiving() {
    return /^\/boh\/inventory\/purchase-orders\/[^/]+\/receive\/?$/.test(window.location.pathname);
  }
  const dialogSelector = '[role="dialog"]:not([hidden]):not([aria-hidden="true"]), dialog[open]';
  let focusedOEM = null, pendingOEM = null;
  function oemDialog() {
    if (!receiving()) return null;
    return Array.from(document.querySelectorAll(dialogSelector)).find(dialog =>
      dialog.getAttribute('aria-label') === 'Scan OEM Serial') || null;
  }
  function syncOEM() {
    if (!settingsReady || !enabled || config.scannerReceiving === false) return;
    const dialog = oemDialog();
    const input = dialog?.querySelector('input[type="text"]:not(:disabled)');
    if (input !== focusedOEM) {
      focusedOEM = input || null;
      if (input && config.scannerOEMFocus !== false) { reset(); input.focus(); }
    }
    if (!pendingOEM || config.scannerOEMConfirm === false) return;
    if (dialog !== pendingOEM.dialog || window.location.pathname !== pendingOEM.route) { pendingOEM = null; return; }
    const button = Array.from(dialog.querySelectorAll('button')).find(node => node.textContent.trim() === 'Confirm');
    // Wait for React to apply the portal's validation before using its action.
    if (input?.value === pendingOEM.scan && button && !button.disabled && button.getAttribute('aria-disabled') !== 'true') {
      pendingOEM = null;
      button.click();
    }
  }
  new MutationObserver(syncOEM).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['role', 'aria-label', 'aria-hidden', 'hidden', 'open', 'disabled', 'aria-disabled', 'value']
  });
  if (!S) syncOEM();
  function looksLikeUrl(value) {
    return /^https?:\/\//i.test(value) || /^portal\.ubreakifix\.net\//i.test(value) || value.startsWith('/');
  }
  function destination(value) {
    // Longer bare numbers may be phone numbers or IMEIs, not work orders.
    if (/^[1-9]\d{4,9}$/.test(value)) return `/repair/workorder/${value}`;
    // Anything else that is not a portal URL is a scan the search panel wants.
    if (!looksLikeUrl(value)) return null;
    let url;
    try {
      url = new URL(value.startsWith('portal.ubreakifix.net/') ? `https://${value}` : value, 'https://portal.ubreakifix.net');
    } catch { return null; }
    if (url.origin !== 'https://portal.ubreakifix.net' || url.username || url.password) return null;
    const match = url.pathname.match(/^\/repair\/workorder\/([1-9]\d{4,14})\/?$/);
    if (match) return `/repair/workorder/${match[1]}`;
    // A portal QR for any other route (an item, a purchase order, a customer)
    // still opens that route instead of being dropped.
    return url.pathname === '/' ? null : `${url.pathname}${url.search}${url.hash}`;
  }
  /* Values that are neither work orders nor portal links are sent to the
     universal search field: item barcodes, IMEIs, serial numbers, phone
     numbers, claim references and names. Anything that reads like prose or an
     address is left alone so it keeps its normal behavior. */
  function searchTarget(value) {
    const query = value.trim();
    if (query.length < 3 || query.length > MAX_LENGTH) return null;
    if (looksLikeUrl(value)) return null;
    if (!/[0-9A-Za-z]/.test(query)) return null;
    if ((query.match(/\s/g) || []).length > 2) return null;
    return query;
  }
  function toSearch(query) {
    const ui = globalThis.UBIFPlusSearchUI;
    // Absent or switched off: the portal keeps the keystrokes as they were.
    return Boolean(ui && typeof ui.run === 'function' && ui.run(query));
  }
  function snapshot(node) {
    if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) return null;
    return { value: node.value, start: node.selectionStart, end: node.selectionEnd, direction: node.selectionDirection };
  }
  function restore() {
    if (!original || !target?.isConnected) return;
    // Use the native setter so React-controlled fields also receive the restoration.
    const prototype = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(target, original.value);
    if (original.start !== null) target.setSelectionRange(original.start, original.end, original.direction);
    target.dispatchEvent(new Event('input', { bubbles: true }));
  }
  window.addEventListener('keydown', event => {
    if (!enabled || event.isComposing || event.repeat || event.ctrlKey || event.metaKey || event.altKey) { reset(); return; }
    const isReceiving = receiving();
    if (isReceiving && config.scannerReceiving === false) { reset(); return; }
    const oem = oemDialog();
    // A new interaction cancels any delayed confirmation from a previous scan.
    pendingOEM = null;
    // Leave other dialogs to the portal. Never open work orders
    // from this workflow, even while its contents are loading or being replaced.
    if (isReceiving && (!document.querySelector('[data-testid="po-receive-container"]') ||
        (!oem && document.querySelector(dialogSelector)) ||
        event.target.closest?.('[contenteditable]:not([contenteditable="false"]), input[type="password"]'))) { reset(); return; }
    const now = event.timeStamp;
    if (buffer && (now - last > MAX_GAP || event.target !== target || route !== window.location.pathname)) reset();
    if (event.key === 'Enter' || event.key === 'Tab') {
      const rapid = buffer.length >= (isReceiving ? 4 : 5) && (now - started) / buffer.length <= MAX_AVERAGE;
      const href = !isReceiving && rapid && config.scannerOpenLinks !== false ? destination(buffer) : null;
      const query = !isReceiving && rapid && !href && config.scannerSearch !== false ? searchTarget(buffer) : null;
      const searched = Boolean(query) && toSearch(query);
      if (href || searched || (isReceiving && rapid)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const scan = buffer;
        if (!oem) restore();
        reset();
        // The portal's useListenScanDetected hook consumes this exact event.
        // Canceling the terminator also prevents its keypress detector from
        // delivering the same scan twice. Validation and Receive Parts stay native.
        if (isReceiving) {
          window.dispatchEvent(new CustomEvent('scanDetected', { detail: { scan } }));
          if (oem && config.scannerOEMConfirm !== false && /^[0-9A-Za-z]{14,22}$/.test(scan)) {
            const pending = { dialog: oem, scan, route: window.location.pathname };
            pendingOEM = pending;
            window.setTimeout(syncOEM, 0);
            window.setTimeout(() => { if (pendingOEM === pending) pendingOEM = null; }, 1000);
          }
        }
        else if (href) window.location.assign(href);
        // Otherwise the universal search field already holds the query.
      } else reset();
      return;
    }
    // Shift events are normal while scanners transmit URLs with capitals/symbols.
    if (event.key === 'Shift') return;
    if (event.key.length !== 1) { reset(); return; }
    if (!buffer) { started = now; target = event.target; original = snapshot(target); route = window.location.pathname; }
    buffer += event.key;
    last = now;
    if (buffer.length > MAX_LENGTH) reset();
  }, true);
  window.addEventListener('blur', () => { pendingOEM = null; reset(); });
  window.addEventListener('pagehide', () => { pendingOEM = null; reset(); });
  window.addEventListener('popstate', () => { pendingOEM = null; reset(); syncOEM(); });
  document.addEventListener('pointerdown', () => { pendingOEM = null; reset(); }, true);
  // The toggle is applied as soon as storage answers; the default keeps scans
  // working before it does.
  if (S) {
    const apply = settings => {
      if (!settingsReady || ['scanner', 'scannerReceiving', 'scannerOEMFocus'].some(key => config[key] !== settings[key])) focusedOEM = null;
      settingsReady = true;
      config = settings;
      enabled = settings.scanner !== false;
      pendingOEM = null; reset();
      syncOEM();
      if (!enabled) { pendingOEM = null; reset(); }
    };
    S.get().then(apply, () => {});
    S.subscribe(apply);
  }
})();
