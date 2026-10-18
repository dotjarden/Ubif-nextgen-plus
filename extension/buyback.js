/* Inline search result -> sold or WO-reserved serial -> native work order buyback action. */
(() => {
  'use strict';
  if (globalThis.__ubifPlusBuyback) return;
  globalThis.__ubifPlusBuyback = true;
  const KEY = 'ubif-plus.buyback-intent';
  const el = (tag, text) => { const node = document.createElement(tag); node.textContent = text || ''; return node; };
  const style = el('style');
  style.textContent = '#ubif-buyback{margin:12px 0;padding:12px;border:1px solid var(--aui-outline,#ccc);border-radius:8px;font:inherit} #ubif-buyback button{font:inherit;cursor:pointer;padding:8px 12px;border:1px solid var(--aui-outline,#bbb);border-radius:6px;background:var(--aui-elevated-level-01,#fff);color:var(--aui-on-surface,#222)} #ubif-buyback button:focus-visible{outline:2px solid var(--aui-primary,#8224ce)} #ubif-buyback button:disabled{cursor:wait;opacity:.6} #ubif-buyback p{margin:8px 0} #ubif-buyback ul{padding-left:20px} #ubif-buyback li{margin:8px 0}';
  document.head.append(style);
  const S = globalThis.UBIFPlusSettings;
  let enabled = !S, panel, status, primary, target, origin, busy = false, run = 0, controller, stopResume;
  const active = id => id === run && enabled && panel?.isConnected && location.href === origin;
  function cancel() { run++; controller?.abort(); busy = false; panel?.remove(); panel = null; }
  async function json(path, signal) {
    const response = await fetch(path, { credentials: 'same-origin', signal, headers: { Accept: 'application/json' }, ubifPlusSearch: true });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Your portal session or permissions need attention.' : 'Could not load sold serials. Try again.');
    return response.json();
  }
  const sold = row => String(row?.SerialStatus || '').trim().toLowerCase() === 'sold';
  const reserved = row => String(row?.SerialStatus || '').trim().toLowerCase() === 'reserved';
  async function choose(row, sku, id, signal) {
    const detail = await json(`/api/boh/inventory/${encodeURIComponent(row.SerialNumber)}?includeQuarantineInfo=false&includeSalvageInfo=false`, signal);
    if (!active(id)) return;
    // A sold serial needs its sales order; a reserved one is attached to an open work order.
    const linked = (sold(detail) && String(detail.SalesOrderNumber || '').trim()) || reserved(detail);
    if (String(detail.ItemNumber) !== sku || !linked || !/^\d+$/.test(String(detail.WorkOrderId || ''))) {
      throw new Error('This serial is not attached to a work order. Open its item details to check it.');
    }
    const intent = { id: `${Date.now()}-${Math.random()}`, sku, serial: String(row.SerialNumber), order: String(detail.WorkOrderId), created: Date.now() };
    try { sessionStorage.setItem(KEY, JSON.stringify(intent)); } catch { throw new Error('Could not prepare printing. Allow tab session storage and try again.'); }
    location.assign(`/repair/workorder/${intent.order}`);
  }
  async function lookup(row) {
    if (busy || !enabled || !panel?.isConnected) return;
    busy = true; const id = run, sku = target.sku;
    controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 15000);
    primary.disabled = true;
    panel.querySelectorAll('li button').forEach(b => { b.disabled = true; });
    if (!row) panel.querySelector('ul')?.remove();
    status.textContent = row ? 'Opening the linked work order…' : 'Finding sold serials…';
    try {
      if (row || target.serial) { await choose(row || { SerialNumber: target.serial }, sku, id, controller.signal); return; }
      const rows = [], seen = new Set();
      // Complete pagination before offering a serial; never silently use only the first page.
      for (let page = 1; page <= 100; page++) {
        const params = new URLSearchParams({ pageSize: '100', page: String(page), searchTerm: '', warehouseType: 'Store', warehouseId: '' });
        const data = await json(`/api/boh/store-products/${encodeURIComponent(sku)}/inventory?${params}`, controller.signal);
        if (!active(id)) return;
        if (!Array.isArray(data?.value) || !Number.isFinite(Number(data['@odata.count']))) throw new Error('Portal returned unexpected inventory data. Open item details to check it.');
        let added = 0;
        for (const item of data.value) {
          if (item.SerialNumber && !seen.has(item.SerialNumber)) { seen.add(item.SerialNumber); added++; if (sold(item)) rows.push(item); }
        }
        if (seen.size >= Number(data['@odata.count'])) break;
        if (!added || page === 100) throw new Error('Could not load all inventory pages. Try again.');
      }
      if (!rows.length) { status.textContent = 'No sold serials found for this SKU.'; return; }
      if (rows.length === 1) { await choose(rows[0], sku, id, controller.signal); return; }
      status.textContent = `${rows.length} sold serials. Choose the serial to print:`;
      panel.querySelector('ul')?.remove();
      const list = el('ul');
      for (const item of rows) {
        const li = el('li'), button = el('button', `Print ${item.SerialNumber}`);
        button.type = 'button'; button.onclick = () => lookup(item); li.append(button); list.append(li);
      }
      panel.append(list);
    } catch (error) { if (id === run) status.textContent = error.name === 'AbortError' ? 'Lookup timed out. Try again.' : error.message; }
    finally {
      clearTimeout(timeout);
      if (id === run) { busy = false; primary.disabled = false; panel.querySelectorAll('li button').forEach(b => { b.disabled = false; }); }
    }
  }
  globalThis.UBIFPlusBuyback = Object.freeze({
    cancel,
    start(result, container) {
      if (!enabled || !result?.sku || !container?.isConnected) return false;
      cancel(); target = { sku: String(result.sku), serial: result.serial ? String(result.serial) : '' }; origin = location.href;
      panel = el('section'); panel.id = 'ubif-buyback'; panel.setAttribute('aria-label', `Buyback labels for ${target.sku}`);
      primary = el('button', 'Retry'); primary.type = 'button'; primary.onclick = () => lookup();
      const close = el('button', 'Cancel'); close.type = 'button'; close.onclick = cancel;
      status = el('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      panel.append(status, primary, close); container.append(panel); lookup(); return true;
    }
  });
  // One-time same-tab intent. It expires quickly and is consumed before any action.
  function resume() {
    let intent;
    try { intent = JSON.parse(sessionStorage.getItem(KEY) || 'null'); sessionStorage.removeItem(KEY); } catch { return; }
    if (!intent || typeof intent.id !== 'string' || typeof intent.sku !== 'string' || typeof intent.serial !== 'string' || !/^\d+$/.test(intent.order) || !Number.isFinite(intent.created) || Date.now() - intent.created < 0 || Date.now() - intent.created > 60000 || location.pathname !== `/repair/workorder/${intent.order}`) return;
    const banner = el('section'); banner.id = 'ubif-buyback'; banner.setAttribute('aria-label', 'Buyback label printing');
    const message = el('p', `Preparing buyback label for ${intent.serial}…`); message.setAttribute('role', 'status');
    const cancel = el('button', 'Cancel'); cancel.type = 'button'; banner.append(message, cancel); document.body.append(banner);
    let interval, timeout;
    const stop = () => { clearInterval(interval); clearTimeout(timeout); window.removeEventListener('message', result); stopResume = null; };
    stopResume = () => { stop(); banner.remove(); };
    const result = event => {
      if (event.source !== window || event.data?.source !== 'ubif-plus' || event.data.type !== 'buyback-print-result' || event.data.id !== intent.id) return;
      stop(); message.textContent = event.data.message; cancel.textContent = 'Dismiss';
    };
    const request = () => {
      if (location.pathname !== `/repair/workorder/${intent.order}`) { stop(); banner.remove(); return; }
      window.postMessage({ ...intent, source: 'ubif-plus', type: 'buyback-print-request' }, '*');
    };
    cancel.onclick = () => { stop(); banner.remove(); };
    window.addEventListener('message', result);
    interval = setInterval(request, 500);
    timeout = setTimeout(() => { stop(); message.textContent = 'The matching buyback action is unavailable or disabled. Use the work order’s item actions to check eligibility and printer messages.'; cancel.textContent = 'Dismiss'; }, 30000);
    request();
  }
  new MutationObserver(() => { if (panel && !active(run)) cancel(); }).observe(document.body, { childList: true, subtree: true });
  addEventListener('popstate', cancel);
  const apply = settings => {
    enabled = settings.search !== false && settings.searchBuyback !== false;
    if (!enabled) { cancel(); stopResume?.(); try { sessionStorage.removeItem(KEY); } catch {} }
  };
  if (S) { S.subscribe(apply); S.get().then(settings => { apply(settings); if (enabled) resume(); }, () => {}); }
  else resume();
})();
