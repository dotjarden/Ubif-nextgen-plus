/* Inline search result -> Portal's Dymo label print for an inventory serial,
 * without the item details popup and its confirm dialog. The print itself runs
 * in label-page.js; this side keeps Portal's ReprintLabel action log. */
(() => {
  'use strict';
  if (globalThis.__ubifPlusLabel) return;
  globalThis.__ubifPlusLabel = true;
  const S = globalThis.UBIFPlusSettings;
  let enabled = !S;
  const pending = new Map();
  addEventListener('message', event => {
    const m = event.data;
    if (event.source !== window || m?.source !== 'ubif-plus' || m.type !== 'label-print-result') return;
    const done = pending.get(m.id);
    if (done) { pending.delete(m.id); done(m); }
  });
  // Same entry Portal writes after its own reprint; failures never block the print.
  function log(serial) {
    fetch('/api/boh/user-actions/create-log', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ ActionType: 'ReprintLabel', ActionLog: `Reprinted label for part ${serial}` }), ubifPlusSearch: true }).catch(() => {});
  }
  function print(target) {
    const serial = String(target?.serial || '').trim(), text = String(target?.text || '').trim();
    if (!enabled) return Promise.resolve({ state: 'error', message: 'Label printing is turned off in settings.' });
    if (!serial || !text) return Promise.resolve({ state: 'error', message: 'This serial has no product name to print.' });
    const id = `${Date.now()}-${Math.random()}`;
    return new Promise(resolve => {
      const timeout = setTimeout(() => { pending.delete(id); resolve({ state: 'error', message: 'The label printer did not respond. Reload the page and try again.' }); }, 10000);
      pending.set(id, result => {
        clearTimeout(timeout);
        if (result.state === 'printed') log(serial);
        resolve({ state: result.state, message: String(result.message || '') });
      });
      window.postMessage({ source: 'ubif-plus', type: 'label-print-request', id, serial, text }, '*');
    });
  }
  globalThis.UBIFPlusLabel = Object.freeze({ print });
  const apply = settings => { enabled = settings.search !== false && settings.searchLabels !== false; };
  if (S) { S.subscribe(apply); S.get().then(apply, () => {}); }
})();
