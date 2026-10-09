/* Hot-loads the extension's own scripts into a live portal tab for review
   without installing the extension in that browser. Storage is backed by
   localStorage so layouts and settings survive a reload of this loader.

   In the portal tab:
     fetch('http://127.0.0.1:8765/demo/live-load.js?v=1').then(r => r.text()).then(t => eval(t))
   After editing a file, run window.__ubifPlusLoad() to reload the tab, then
   fetch and eval this file again to pick up the new code. */
(async () => {
  'use strict';
  const BASE = 'http://127.0.0.1:8765';
  const STORE_KEY = 'ubif-plus.preview';
  const data = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
  const listeners = [];
  const snapshot = value => JSON.parse(JSON.stringify(value));
  const shim = {
    storage: {
      local: {
        get: key => Promise.resolve(key == null ? snapshot(data) : (key in data ? { [key]: snapshot(data[key]) } : {})),
        set: object => {
          Object.assign(data, snapshot(object));
          localStorage.setItem(STORE_KEY, JSON.stringify(data));
          for (const [name, value] of Object.entries(object)) listeners.forEach(fn => fn({ [name]: { newValue: snapshot(value) } }, 'local'));
          return Promise.resolve();
        }
      },
      onChanged: { addListener: fn => listeners.push(fn) }
    },
    runtime: { getManifest: () => ({ version: 'preview' }) },
    tabs: { create: ({ url }) => { window.open(url, '_blank'); return Promise.resolve({ url }); } }
  };
  try {
    Object.defineProperty(window, 'chrome', { value: shim, configurable: true, writable: true });
  } catch (error) {
    try { window.chrome.storage = shim.storage; window.chrome.runtime = shim.runtime; window.chrome.tabs = shim.tabs; }
    catch (e) { console.warn('[ubif preview] chrome shim failed', error, e); return; }
  }
  const SCRIPTS = ['settings.js', 'home.js', 'page.js', 'scanner.js', 'model.js', 'content.js', 'search-model.js', 'search.js', 'board-model.js', 'board.js', 'support.js'];
  /* Scripts keep their own observers and listeners, so a second copy cannot be
     retired cleanly from the outside. A reload therefore starts a fresh
     document, and re-fetching this file loads the new scripts into it. */
  const load = async () => {
    for (const name of SCRIPTS) {
      const code = await fetch(`${BASE}/extension/${name}?v=${Date.now()}`).then(r => {
        if (!r.ok) throw new Error(`${name}: ${r.status}`);
        return r.text();
      });
      (0, eval)(code); // indirect eval: runs in global scope, like a content script
      if (name === 'settings.js') await window.UBIFPlusSettings.get();
    }
    console.info('[ubif preview] loaded', SCRIPTS.length, 'scripts');
  };
  const reload = async () => {
    if (window.__ubifPlusStarted) { location.reload(); return; }
    return load();
  };
  window.__ubifPlusLoad = reload;
  await reload();
})();
