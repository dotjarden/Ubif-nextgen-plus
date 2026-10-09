/* Single settings record for the extension. The popup writes it; the content
   scripts read it and subscribe for changes so an edit applies to tabs that
   are already open. Consumers treat a missing module as "use the defaults",
   so the demo preview and the tests can load a script without this file. */
(() => {
  'use strict';
  const KEY = 'ubif-plus.settings.v1';
  const defaults = Object.freeze({
    search: true,
    board: true,
    scanner: true,
    columns: true,
    support: true,
    searchDebounceMs: 350,
    searchMinChars: 3,
    searchHotkey: true,
    searchCustomers: true,
    searchWorkOrders: true,
    searchItems: true,
    searchClaims: true,
    searchSerials: true,
    searchNewTab: false,
    scannerOpenLinks: true,
    scannerSearch: true,
    scannerReceiving: true,
    scannerOEMFocus: true,
    scannerOEMConfirm: true,
    columnsWorkorders: true,
    columnsArrivals: true,
    supportDesktopNotifications: true,
    supportUnreadBadge: true,
    supportMessagePreview: true,
    boardAutoRefresh: true,
    boardDragDrop: true,
    boardShowEmpty: true,
    boardRefreshSec: 60,
    boardIncludeTomorrow: false,
    hideHomeCalendar: false
  });
  const range = { searchDebounceMs: [100, 2000], searchMinChars: [3, 10], boardRefreshSec: [15, 600] };
  let current = { ...defaults }, hooked = false;
  const listeners = new Set();
  const channel = name => (typeof chrome !== 'undefined' && chrome.storage && chrome.storage[name]) || null;
  const clamp = (value, [low, high]) => Math.min(high, Math.max(low, value));
  const truthy = value => value === true || value === 1 || value === 'true';

  /* Only known keys are kept, with their default type, then numeric values
     are rounded and clamped so a stale or hand-edited record stays usable. */
  function sanitize(raw) {
    const next = { ...defaults };
    if (raw && typeof raw === 'object') {
      for (const key of Object.keys(defaults)) {
        if (!(key in raw)) continue;
        if (typeof defaults[key] === 'boolean') next[key] = truthy(raw[key]);
        else { const value = Number(raw[key]); if (Number.isFinite(value)) next[key] = value; }
      }
    }
    for (const [key, bounds] of Object.entries(range)) next[key] = clamp(Math.round(next[key]), bounds);
    return next;
  }

  function get() {
    const local = channel('local');
    if (!local) return Promise.resolve({ ...current });
    return local.get(KEY).then(data => {
      current = sanitize(data && typeof data === 'object' ? data[KEY] : null);
      return { ...current };
    }, () => ({ ...current }));
  }

  function set(patch) {
    const previous = current;
    const merged = { ...current };
    if (patch && typeof patch === 'object') Object.assign(merged, patch);
    current = sanitize(merged);
    const local = channel('local');
    if (!local) return Promise.resolve({ ...current });
    return local.set({ [KEY]: { ...current } }).then(
      () => ({ ...current }),
      error => { current = previous; throw error; }
    );
  }

  function notify() { for (const listener of [...listeners]) { try { listener({ ...current }); } catch {} } }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    const bus = channel('onChanged');
    if (bus && !hooked) {
      hooked = true;
      bus.addListener((changes, area) => {
        if (area && area !== 'local') return;
        const change = changes && changes[KEY];
        if (!change) return;
        current = sanitize(change.newValue);
        notify();
      });
    }
    return () => listeners.delete(listener);
  }

  globalThis.UBIFPlusSettings = Object.freeze({ KEY, defaults, get, set, subscribe, sanitize });
})();
