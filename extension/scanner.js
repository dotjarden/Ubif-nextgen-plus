(() => {
  'use strict';
  if (globalThis.__ubifPlusScannerStarted) return;
  globalThis.__ubifPlusScannerStarted = true;

  // Keyboard-wedge scanners send a rapid burst followed by Enter or Tab.
  // Timing is deliberately conservative so normal typing keeps its native behavior.
  const MAX_GAP = 80, MAX_AVERAGE = 40, MAX_LENGTH = 200;
  let buffer = '', started = 0, last = 0, target = null, original = null, route = '';
  function reset() { buffer = ''; started = last = 0; target = original = null; route = ''; }
  function receiving() {
    return /^\/boh\/inventory\/purchase-orders\/[^/]+\/receive\/?$/.test(window.location.pathname);
  }
  function destination(value) {
    // Longer bare numbers may be phone numbers or IMEIs, not work orders.
    if (/^[1-9]\d{4,9}$/.test(value)) return `/repair/workorder/${value}`;
    let url;
    try {
      url = new URL(value.startsWith('portal.ubreakifix.net/') ? `https://${value}` : value, 'https://portal.ubreakifix.net');
    } catch { return null; }
    if (url.origin !== 'https://portal.ubreakifix.net' || url.username || url.password) return null;
    const match = url.pathname.match(/^\/repair\/workorder\/([1-9]\d{4,14})\/?$/);
    return match ? `/repair/workorder/${match[1]}` : null;
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
    if (event.isComposing || event.repeat || event.ctrlKey || event.metaKey || event.altKey) { reset(); return; }
    const isReceiving = receiving();
    // Let native serial/IMEI dialogs handle their own scans. Never open work orders
    // from this workflow, even while its contents are loading or being replaced.
    if (isReceiving && (!document.querySelector('[data-testid="po-receive-container"]') ||
        document.querySelector('[role="dialog"]:not([hidden]):not([aria-hidden="true"]), dialog[open]') ||
        event.target.closest?.('[contenteditable]:not([contenteditable="false"]), input[type="password"]'))) { reset(); return; }
    const now = event.timeStamp;
    if (buffer && (now - last > MAX_GAP || event.target !== target || route !== window.location.pathname)) reset();
    if (event.key === 'Enter' || event.key === 'Tab') {
      const rapid = buffer.length >= (isReceiving ? 4 : 5) && (now - started) / buffer.length <= MAX_AVERAGE;
      const href = !isReceiving && rapid ? destination(buffer) : null;
      if (href || (isReceiving && rapid)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const scan = buffer;
        restore();
        reset();
        // The portal's useListenScanDetected hook consumes this exact event.
        // Canceling the terminator also prevents its keypress detector from
        // delivering the same scan twice. Validation and Receive Parts stay native.
        if (isReceiving) window.dispatchEvent(new CustomEvent('scanDetected', { detail: { scan } }));
        else window.location.assign(href);
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
  window.addEventListener('blur', reset);
  window.addEventListener('pagehide', reset);
  window.addEventListener('popstate', reset);
  document.addEventListener('pointerdown', reset, true);
})();
