/* Single settings record for the extension. The popup writes it; the content
   scripts read it and subscribe for changes so an edit applies to tabs that
   are already open. Consumers treat a missing module as "use the defaults",
   so the demo preview and the tests can load a script without this file. */
(() => {
  'use strict';
  const KEY = 'ubif-plus.settings.v1';
  const defaults = Object.freeze({
    messages: true,
    messageShortcuts: true,
    employeeName: true,
    employeeFirstName: '',
    checkin: true,
    checkinBattery: true,
    searchInlineTags: true,
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
    searchBuyback: true,
    scannerOpenLinks: true,
    scannerSearch: true,
    scannerReceiving: true,
    scannerOEMFocus: true,
    scannerOEMConfirm: true,
    columnsWorkorders: true,
    columnsArrivals: true,
    arrivalsPagination: true,
    arrivalsPageSize: 10,
    supportDesktopNotifications: true,
    supportUnreadBadge: true,
    supportMessagePreview: true,
    boardAutoRefresh: true,
    boardDragDrop: true,
    boardShowEmpty: true,
    boardRefreshSec: 60,
    boardIncludeTomorrow: false,
    hideHomeCalendar: false,
    navEnhance: true,
    darkMode: false,
    darkModeFollowSystem: false,
    darkBrightness: 100,
    darkContrast: 100,
    darkSepia: 0,
    darkGrayscale: 0,
    darkDimmed: false,
    noteTemplates: true,
    noteTemplatesCheckin: true,
    hotkeys: true,
    samsungForms: true,
    samsungAutoSubmit: false,
    samsungRepairType: 'Store',
    samsungGdVersion: '',
    samsungEmail: ''
  });
  const choices = { samsungRepairType: ['Store', 'Kiosk'] };
  const range = {
    searchDebounceMs: [100, 2000], searchMinChars: [3, 10], boardRefreshSec: [15, 600],
    darkBrightness: [50, 150], darkContrast: [50, 150], darkSepia: [0, 100], darkGrayscale: [0, 100]
  };
  let current = { ...defaults }, hooked = false, revision = 0, writes = Promise.resolve();
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
        else if (typeof defaults[key] === 'string') next[key] = String(raw[key] || '').trim().slice(0, 80);
        else { const value = Number(raw[key]); if (Number.isFinite(value)) next[key] = value; }
      }
    }
    for (const [key, bounds] of Object.entries(range)) next[key] = clamp(Math.round(next[key]), bounds);
    if (![10, 25, 50, 100].includes(next.arrivalsPageSize)) next.arrivalsPageSize = defaults.arrivalsPageSize;
    for (const [key, allowed] of Object.entries(choices)) if (!allowed.includes(next[key])) next[key] = defaults[key];
    return next;
  }

  function publish(raw) {
    const next = sanitize(raw);
    revision++;
    if (Object.keys(defaults).every(key => current[key] === next[key])) return;
    current = next;
    for (const listener of [...listeners]) { try { listener({ ...current }); } catch {} }
  }

  function hook() {
    const bus = channel('onChanged');
    if (!bus || hooked) return;
    hooked = true;
    bus.addListener((changes, area) => {
      if (area && area !== 'local') return;
      const change = changes && changes[KEY];
      if (change) publish(change.newValue);
    });
  }

  async function get() {
    hook();
    const local = channel('local');
    if (!local) return { ...current };
    const before = revision;
    const data = await local.get(KEY);
    let raw = data && data[KEY];
    // Preserve the page-size choice from the original standalone control.
    // Once the shared record has this key, including after a reset, it wins.
    if (before === revision && (!raw || !Object.prototype.hasOwnProperty.call(raw, 'arrivalsPageSize'))) {
      const legacy = await local.get('ubif-plus.arrivals.page-size.v1');
      const value = legacy && legacy['ubif-plus.arrivals.page-size.v1'];
      if ([10, 25, 50, 100].includes(value)) raw = { ...raw, arrivalsPageSize: value };
    }
    // A slow initial read must never undo a newer storage event.
    if (before === revision) publish(raw);
    return { ...current };
  }

  function set(patch) {
    const requested = Object.fromEntries(Object.entries(patch || {}).filter(([key]) => key in defaults));
    const save = async () => {
      const perform = async () => {
        await get();
        const next = sanitize({ ...current, ...requested });
        const local = channel('local');
        const before = revision;
        if (local) await local.set({ [KEY]: next });
        // Chrome may deliver onChanged before the write promise resolves.
        if (revision === before) publish(next);
        return { ...current };
      };
      // Settings pages share the extension origin. Serialize their read/merge/
      // write cycles as well as rapid edits within this document.
      const locks = globalThis.navigator?.locks;
      return locks ? locks.request(KEY, perform) : perform();
    };
    const result = writes.then(save, save);
    writes = result.catch(() => {});
    return result;
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    hook();
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
  hook();
  // A restored/suspended portal tab also reconciles with the persisted record.
  const reconcile = () => { get().catch(() => {}); };
  globalThis.addEventListener?.('focus', reconcile);
  globalThis.addEventListener?.('pageshow', reconcile);
  globalThis.document?.addEventListener('visibilitychange', () => {
    if (!document.hidden) reconcile();
  });

  globalThis.UBIFPlusSettings = Object.freeze({ KEY, defaults, get, set, subscribe, sanitize });
})();
