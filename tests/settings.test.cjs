const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');

const read = name => fs.readFileSync(`${__dirname}/../extension/${name}`, 'utf8');
const settingsScript = read('settings.js');
const popupScript = read('popup.js');
const popupHtml = read('popup.html');
const searchModel = read('search-model.js');
const searchScript = read('search.js');
const scannerScript = read('scanner.js');
const boardModel = read('board-model.js');
const boardScript = read('board.js');
const columnScripts = ['model.js', 'content.js'].map(read);
const manifest = JSON.parse(read('manifest.json'));
const KEY = 'ubif-plus.settings.v1';
const tick = (w, ms = 40) => new Promise(resolve => w.setTimeout(resolve, ms));

/* chrome.storage.local stand-in: pending reads, recorded writes, and a manual
   onChanged trigger so a settings edit can be simulated exactly like the popup. */
function storage(w, stored = {}) {
  const data = JSON.parse(JSON.stringify(stored));
  const listeners = [];
  const writes = [];
  const opened = [];
  let failing = false;
  w.chrome = {
    runtime: { getManifest: () => ({ version: manifest.version }) },
    tabs: { create: ({ url }) => { opened.push(url); return Promise.resolve({ url }); } },
    storage: {
      local: {
        get: key => Promise.resolve(key == null ? JSON.parse(JSON.stringify(data)) : (key in data ? { [key]: data[key] } : {})),
        set: object => {
          if (failing) return Promise.reject(new Error('storage failure'));
          writes.push(JSON.parse(JSON.stringify(object)));
          Object.assign(data, object);
          return Promise.resolve();
        }
      },
      onChanged: { addListener: listener => listeners.push(listener) }
    }
  };
  return {
    data, writes, opened,
    changed: (value, area = 'local', key = KEY) => listeners.forEach(listener => listener({ [key]: { newValue: value } }, area)),
    fail: value => { failing = value; }
  };
}
const page = (markup, url = 'https://portal.ubreakifix.net/') =>
  new JSDOM(markup, { url, runScripts: 'outside-only', pretendToBeVisual: true });

test('settings fall back to defaults, keep known keys only, and clamp the numbers', async t => {
  const dom = page('<!doctype html><p>');
  t.after(() => dom.window.close());
  dom.window.eval(settingsScript);
  const S = dom.window.UBIFPlusSettings;
  const defaults = await S.get();
  assert.deepEqual(JSON.parse(JSON.stringify(defaults)), {
    search: true, board: true, scanner: true, columns: true, support: true, hideHomeCalendar: false,
    searchDebounceMs: 350, searchMinChars: 3, searchHotkey: true,
    boardRefreshSec: 60, boardIncludeTomorrow: false,
    searchCustomers: true, searchWorkOrders: true, searchItems: true, searchClaims: true, searchSerials: true, searchNewTab: false,
    scannerOpenLinks: true, scannerSearch: true, scannerReceiving: true, scannerOEMFocus: true, scannerOEMConfirm: true,
    columnsWorkorders: true, columnsArrivals: true, supportDesktopNotifications: true, supportUnreadBadge: true,
    supportMessagePreview: true, boardAutoRefresh: true, boardDragDrop: true, boardShowEmpty: true
  });
  const next = await S.set({ searchDebounceMs: 5, searchMinChars: 99, boardRefreshSec: 1e6, columns: false, theme: 'dark' });
  assert.equal(next.searchDebounceMs, 100, 'debounce floor');
  assert.equal(next.searchMinChars, 10, 'minimum-character ceiling');
  assert.equal(next.boardRefreshSec, 600, 'refresh ceiling');
  assert.equal(next.columns, false);
  assert.equal('theme' in next, false, 'unknown keys are dropped');
  assert.deepEqual(JSON.parse(JSON.stringify(await S.get())), JSON.parse(JSON.stringify(next)));
});

test('settings live in a single storage key and reload from it', async t => {
  const dom = page('<!doctype html><p>');
  t.after(() => dom.window.close());
  const s = storage(dom.window);
  dom.window.eval(settingsScript);
  await dom.window.UBIFPlusSettings.set({ board: false, searchMinChars: 5 });
  assert.equal(s.writes.length, 1);
  assert.deepEqual(Object.keys(s.writes[0]), [KEY]);
  assert.equal(s.writes[0][KEY].board, false);
  dom.window.eval(settingsScript);
  const reloaded = await dom.window.UBIFPlusSettings.get();
  assert.equal(reloaded.board, false, 'a fresh module reads the saved value');
  assert.equal(reloaded.searchMinChars, 5);
  assert.equal(reloaded.search, true, 'unset keys keep their defaults');
});

test('saved settings reach subscribers and unsubscribe stops them', async t => {
  const dom = page('<!doctype html><p>');
  t.after(() => dom.window.close());
  const s = storage(dom.window);
  dom.window.eval(settingsScript);
  const S = dom.window.UBIFPlusSettings;
  const defaults = await S.get();
  const seen = [];
  const off = S.subscribe(value => seen.push(value));
  s.changed({ ...defaults, columns: false });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].columns, false);
  s.changed({ ...defaults, boardRefreshSec: 1 }, 'sync');
  s.changed({ ...defaults, board: false }, 'local', 'ubif-plus.columns.v1.All');
  assert.equal(seen.length, 1, 'other areas and keys are ignored');
  s.changed({ ...defaults, boardRefreshSec: 1 });
  assert.equal(seen[1].boardRefreshSec, 15, 'incoming values are clamped too');
  off();
  s.changed({ ...defaults, board: false });
  assert.equal(seen.length, 2, 'unsubscribed');
});

test('a failed write rejects and leaves the stored value alone', async t => {
  const dom = page('<!doctype html><p>');
  t.after(() => dom.window.close());
  const s = storage(dom.window, { [KEY]: { search: true } });
  dom.window.eval(settingsScript);
  const S = dom.window.UBIFPlusSettings;
  await S.get();
  s.fail(true);
  await assert.rejects(S.set({ search: false }), /storage failure/);
  s.fail(false);
  assert.equal((await S.get()).search, true, 'the rejected value is not remembered');
});

test('the toolbar button opens a popup wired to every settings key', async t => {
  assert.equal(manifest.action.default_popup, 'popup.html');
  assert.equal(manifest.permissions.includes('storage'), true);
  assert.equal(manifest.content_scripts[1].js[0], 'settings.js', 'settings load before the consumers');
  const dom = new JSDOM(popupHtml, { url: 'chrome-extension://abcdef/popup.html', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  assert.deepEqual([...doc.querySelectorAll('script')].map(node => node.getAttribute('src')), ['settings.js', 'popup.js']);
  dom.window.eval(settingsScript);
  const controls = [...doc.querySelectorAll('[data-key]')];
  const keys = controls.map(node => node.dataset.key);
  assert.equal(new Set(keys).size, keys.length, 'no control shares a key');
  assert.deepEqual([...keys].sort(), Object.keys(dom.window.UBIFPlusSettings.defaults).sort());
  const links = [...doc.querySelectorAll('footer a')].map(a => a.href);
  assert.ok(links.includes('https://github.com/dotjarden/Ubif-nextgen-plus/issues'), 'feature request target');
  assert.ok(links.some(href => href.includes('buymeacoffee.com/jarden')), 'buy me a coffee target');
});

test('the popup shows saved settings and writes every edit back', async t => {
  const dom = new JSDOM(popupHtml, { url: 'chrome-extension://abcdef/popup.html', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window, doc = w.document;
  const s = storage(w, { [KEY]: { search: false, searchDebounceMs: 5000 } });
  w.eval(settingsScript);
  w.eval(popupScript);
  await tick(w);
  assert.equal(doc.querySelector('[data-key=search]').checked, false, 'stored value shown');
  assert.equal(doc.querySelector('[data-key=board]').checked, true, 'unset feature defaults to on');
  assert.equal(doc.querySelector('[data-key=searchDebounceMs]').value, '2000', 'stored value clamped on read');
  assert.equal(doc.getElementById('ubif-version').textContent, `v${manifest.version}`);
  const board = doc.querySelector('[data-key=board]');
  board.checked = false;
  board.dispatchEvent(new w.Event('change'));
  await tick(w);
  assert.equal(s.writes.at(-1)[KEY].board, false, 'written immediately, no save button');
  assert.match(doc.getElementById('ubif-status').textContent, /Saved/);
  const refresh = doc.querySelector('[data-key=boardRefreshSec]');
  refresh.value = '5';
  refresh.dispatchEvent(new w.Event('change'));
  await tick(w);
  assert.equal(s.writes.at(-1)[KEY].boardRefreshSec, 15, 'out-of-range input clamped before storing');
  s.fail(true);
  doc.querySelector('[data-key=columns]').checked = false;
  doc.querySelector('[data-key=columns]').dispatchEvent(new w.Event('change'));
  await tick(w);
  assert.match(doc.getElementById('ubif-status').textContent, /Could not save/);
  // Both footer buttons open a new tab instead of navigating the popup.
  const links = [...doc.querySelectorAll('footer a')];
  links.forEach(link => link.click());
  assert.deepEqual(s.opened, [
    'https://github.com/dotjarden/Ubif-nextgen-plus/issues',
    'https://www.buymeacoffee.com/jarden'
  ]);
});

test('universal search follows its settings and switches itself off live', async t => {
  const dom = page('<header><div class="components-header-searchbox"><button>Search</button></div></header>');
  t.after(() => dom.window.close());
  const w = dom.window;
  const calls = [];
  w.fetch = async path => { calls.push(path); return { ok: true, status: 200, json: async () => [] }; };
  const s = storage(w, { [KEY]: { searchDebounceMs: 100, searchMinChars: 6 } });
  w.eval(settingsScript);
  w.eval(searchModel);
  w.eval(searchScript);
  await tick(w, 60);
  const input = w.document.querySelector('#ubif-universal-search input');
  assert.ok(input, 'mounted with the stored settings');
  input.value = 'abcd';
  input.dispatchEvent(new w.Event('input'));
  await tick(w, 250);
  assert.equal(calls.length, 0, 'below the configured minimum nothing is requested');
  input.value = 'abcdef';
  input.dispatchEvent(new w.Event('input'));
  await tick(w, 250);
  assert.ok(calls.length > 0, 'searched on the configured 100 ms delay, not the 350 ms default');
  const defaults = await w.UBIFPlusSettings.get();
  s.changed({ ...defaults, search: false });
  assert.equal(w.document.querySelector('#ubif-universal-search'), null, 'field removed without a reload');
  assert.equal(w.document.querySelector('.components-header-searchbox > button').hasAttribute('data-ubif-native-search'), false, 'portal search restored');
  s.changed({ ...defaults, search: true });
  assert.equal(w.document.querySelectorAll('#ubif-universal-search').length, 1, 'field returns when re-enabled');
  s.changed({ ...defaults, searchHotkey: false });
  const blocked = new w.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true });
  w.document.dispatchEvent(blocked);
  assert.equal(blocked.defaultPrevented, false, 'hotkey off while its setting is off');
  s.changed({ ...defaults, searchHotkey: true });
  const reenabled = new w.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true });
  w.document.dispatchEvent(reenabled);
  assert.equal(reenabled.defaultPrevented, true, 'hotkey honors its setting');
});

test('scan handling follows the scanner setting', async t => {
  const dom = page('<input value="existing note"><textarea>previous</textarea><button>Save</button>', 'https://portal.ubreakifix.net/repair/workorders');
  t.after(() => dom.window.close());
  const w = dom.window;
  let apply;
  const context = vm.createContext({
    window: { setTimeout: w.setTimeout.bind(w), addEventListener: w.addEventListener.bind(w), dispatchEvent: w.dispatchEvent.bind(w), location: { get pathname() { return w.location.pathname; }, assign: href => navigations.push(href) } },
    document: w.document,
    MutationObserver: w.MutationObserver, URL: w.URL, Event: w.Event, CustomEvent: w.CustomEvent,
    HTMLInputElement: w.HTMLInputElement, HTMLTextAreaElement: w.HTMLTextAreaElement,
    UBIFPlusSettings: { defaults: { scanner: true }, get: () => Promise.resolve({ scanner: false }), subscribe: fn => { apply = fn; return () => {}; } }
  });
  const navigations = [];
  vm.runInContext(scannerScript, context);
  await tick(w);
  let time = 100;
  const key = (value, delay = 10) => {
    time += delay;
    const event = new w.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true });
    Object.defineProperty(event, 'timeStamp', { value: time });
    w.document.body.dispatchEvent(event);
    return event;
  };
  const scan = value => { for (const char of value) key(char); return key('Enter'); };
  assert.equal(scan('30787644').defaultPrevented, false, 'stored setting arrives before any scan');
  assert.deepEqual(navigations, []);
  apply({ scanner: true });
  assert.equal(scan('30787645').defaultPrevented, true, 'enabled live');
  assert.deepEqual(navigations, ['/repair/workorder/30787645']);
  apply({ scanner: false });
  assert.equal(scan('30787646').defaultPrevented, false, 'disabled live again');
  assert.equal(navigations.length, 1);
});

test('the Update Today tab follows the board settings', async t => {
  const dom = page('<main><nav role="tablist"><button role="tab" aria-selected="true">All</button><button role="tab">Ready for pickup</button></nav><div id="filters">Native filters</div><section><table><thead><tr><th data-column-id="woId">WO</th></tr></thead></table></section></main>', 'https://portal.ubreakifix.net/repair/workorders');
  const w = dom.window, doc = w.document;
  t.after(() => { w.dispatchEvent(new w.Event('pagehide')); dom.window.close(); });
  w.fetch = async () => ({ ok: true, status: 200, json: async () => ({ workOrders: [] }) });
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const s = storage(w, { [KEY]: { board: false, boardIncludeTomorrow: true } });
  w.eval(settingsScript);
  w.eval(boardModel);
  w.eval(boardScript);
  await tick(w);
  assert.equal(doc.querySelector('#ubif-update-today-tab'), null, 'tab removed while the feature is off');
  const defaults = await w.UBIFPlusSettings.get();
  s.changed({ ...defaults, board: true, boardIncludeTomorrow: true });
  assert.equal(doc.querySelectorAll('#ubif-update-today-tab').length, 1, 'tab returns without a reload');
  doc.querySelector('#ubif-update-today-tab').click();
  const tomorrow = doc.querySelector('#ubif-update-today-board').shadowRoot.querySelector('input[type=checkbox]');
  assert.equal(tomorrow.checked, true, 'the stored default checks Include tomorrow');
  s.changed({ ...defaults, board: false });
  assert.equal(doc.querySelector('#ubif-update-today-tab'), null, 'removed again when switched off');
});

test('column work follows the columns setting', async t => {
  const table = '<table><thead><tr><th data-column-id="nextUpdate">Next update</th><th data-column-id="woId">WO #</th></tr></thead><tbody><tr><td><a href="/repair/workorder/demo">date</a></td><td><a href="/repair/workorder/demo">10001234</a></td></tr></tbody></table>';
  const dom = page(`<body><div role="tab" aria-selected="true">All (3)</div><main>${table}</main></body>`, 'https://portal.ubreakifix.net/repair/workorders?tab=All');
  const w = dom.window;
  t.after(() => { w.dispatchEvent(new w.Event('pagehide')); dom.window.close(); });
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const s = storage(w, { [KEY]: { columns: false } });
  w.eval(settingsScript);
  columnScripts.forEach(code => w.eval(code));
  await tick(w, 80);
  assert.equal(w.document.querySelector('#ubif-plus-columns'), null, 'no Columns control while the feature is off');
  const defaults = await w.UBIFPlusSettings.get();
  s.changed({ ...defaults, columns: true });
  await tick(w, 80);
  assert.ok(w.document.querySelector('#ubif-plus-columns'), 'control appears without a reload');
  s.changed({ ...defaults, columns: true, columnsWorkorders: false });
  await tick(w, 80);
  assert.equal(w.document.querySelector('#ubif-plus-columns'), null, 'workorder-specific toggle restores the native table');
  s.changed({ ...defaults, columns: true, columnsWorkorders: true });
  await tick(w, 80);
  assert.ok(w.document.querySelector('#ubif-plus-columns'), 'workorder controls can be re-enabled independently');
  s.changed({ ...defaults, columns: false });
  await tick(w, 80);
  assert.equal(w.document.querySelector('#ubif-plus-columns'), null, 'control removed again');
});

test('settings navigation, search, dependencies, reset and external edits stay in sync', async t => {
  const dom = new JSDOM(popupHtml, { url: 'chrome-extension://abcdef/popup.html#scanner', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window, doc = w.document;
  const s = storage(w, { [KEY]: { scannerOEMConfirm: false, search: false } });
  let opened = false;
  w.chrome.runtime.openOptionsPage = () => { opened = true; };
  w.eval(settingsScript); w.eval(popupScript); await tick(w);
  assert.equal(doc.querySelector('#scanner').hidden, false);
  assert.equal(doc.querySelector('#search').hidden, true);
  assert.equal(doc.querySelector('[data-key=scannerSearch]').disabled, true);
  const filter = doc.querySelector('#settings-search');
  filter.value = 'notification'; filter.dispatchEvent(new w.Event('input'));
  assert.equal(doc.querySelector('#support').hidden, false);
  assert.equal(doc.querySelector('#scanner').hidden, true);
  filter.value = 'no such setting'; filter.dispatchEvent(new w.Event('input'));
  assert.equal(doc.querySelector('#no-results').hidden, false);
  doc.querySelector('[data-section=scanner]').click();
  assert.equal(filter.value, '');
  assert.equal(doc.querySelector('#scanner').hidden, false);
  doc.querySelector('[data-reset=scanner]').click(); await tick(w);
  assert.equal(s.data[KEY].scannerOEMConfirm, true);
  assert.equal(s.data[KEY].search, false, 'section reset preserves unrelated preferences');
  s.changed({ ...s.data[KEY], scannerReceiving: false });
  assert.equal(doc.querySelector('[data-key=scannerOEMConfirm]').disabled, true);
  assert.equal(doc.querySelector('[data-key=scannerOpenLinks]').disabled, false);
  s.fail(true);
  const control = doc.querySelector('[data-key=scannerOpenLinks]');
  control.checked = false; control.dispatchEvent(new w.Event('change')); await tick(w);
  assert.equal(control.checked, true, 'failed writes restore the displayed saved value');
  doc.querySelector('#open-settings').click();
  assert.equal(opened, true);
  assert.equal(manifest.options_ui.page, 'popup.html');
});

test('disabled search categories make no requests and new-tab preference reaches results', async t => {
  const dom = page('<header><div class="components-header-searchbox"><button>Search</button></div></header>');
  t.after(() => dom.window.close());
  const w = dom.window, calls = [];
  w.fetch = async path => { calls.push(path); return { ok: true, json: async () => [{ itemNumber: '123', name: 'Part' }] }; };
  const s = storage(w, { [KEY]: { searchCustomers: false, searchWorkOrders: false, searchClaims: false, searchSerials: false, searchNewTab: true } });
  w.eval(settingsScript); w.eval(searchModel); w.eval(searchScript); await tick(w);
  w.UBIFPlusSearchUI.run('123456'); await tick(w);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /available-parts/);
  assert.equal(w.document.querySelector('#ubif-search-results a').target, '_blank');
  s.changed({ ...s.data[KEY], searchItems: false }); await tick(w);
  assert.equal(calls.length, 1, 'switching all categories off cancels further search');
  assert.match(w.document.querySelector('#ubif-search-results').textContent, /All search categories are off/);
});

test('board preferences hide empty lanes, disable dragging, and stop periodic refresh', async t => {
  const dom = page('<main><nav role="tablist"><button role="tab">Ready for pickup</button></nav><table><thead><tr><th data-column-id="woId">WO</th></tr></thead></table></main>', 'https://portal.ubreakifix.net/repair/workorders');
  const w = dom.window;
  t.after(() => w.close());
  const timers = new Set();
  let apply;
  const interval = w.setInterval.bind(w);
  const clear = w.clearInterval.bind(w);
  w.setInterval = (fn, delay) => { const id = interval(fn, delay); if (delay >= 15000) timers.add(id); return id; };
  w.clearInterval = id => { timers.delete(id); clear(id); };
  w.UBIFPlusSettings = { get: () => Promise.resolve({ board: true, boardAutoRefresh: false, boardShowEmpty: false, boardDragDrop: false }), subscribe: fn => { apply = fn; } };
  w.fetch = async () => ({ ok: true, json: async () => ({ workOrders: [{ workorderId: 12345, workorderStatusId: 2, nextUpdate: '2000-01-01T12:00:00', customer: { fullName: 'Test' } }], rowCount: 1 }) });
  w.eval(boardModel); w.eval(boardScript); await tick(w);
  w.document.querySelector('#ubif-update-today-tab').click(); await tick(w);
  const root = w.document.querySelector('#ubif-update-today-board').shadowRoot;
  assert.equal(root.querySelectorAll('.lane').length, 1);
  assert.equal(root.querySelector('.card').draggable, false);
  assert.equal(timers.size, 0);
  apply({ board: true, boardAutoRefresh: true, boardShowEmpty: true, boardDragDrop: true });
  assert.ok(root.querySelectorAll('.lane').length > 1);
  assert.equal(root.querySelector('.card').draggable, true);
  assert.equal(timers.size, 1);
});

test('Updates and help supports navigation, search, external links and explicit extension reload', async t => {
  const dom = new JSDOM(popupHtml, { url: 'chrome-extension://abcdef/popup.html#updates', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window, doc = w.document;
  const s = storage(w);
  let reloads = 0;
  w.chrome.runtime.reload = () => { reloads++; };
  w.eval(settingsScript); w.eval(popupScript); await tick(w);
  assert.equal(doc.querySelector('#updates').hidden, false);
  assert.equal(doc.querySelector('#preview-note').hidden, true);
  assert.equal(reloads, 0, 'opening settings never reloads the extension');
  doc.querySelector('#reload-extension').click();
  assert.equal(reloads, 1);
  const links = [...doc.querySelectorAll('#updates [data-external]')];
  links.forEach(link => link.click());
  assert.deepEqual(s.opened, links.map(link => link.href));
  const search = doc.querySelector('#settings-search');
  search.value = 'git'; search.dispatchEvent(new w.Event('input'));
  assert.equal(doc.querySelector('#updates').hidden, false);
  assert.equal(doc.querySelector('#no-results').hidden, true);
});

test('localhost preview cannot reload the installed extension', async t => {
  const dom = new JSDOM(popupHtml, { url: 'http://localhost/extension/popup.html#updates', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  dom.window.eval(settingsScript); dom.window.eval(popupScript); await tick(dom.window);
  assert.equal(dom.window.document.querySelector('#reload-extension').disabled, true);
  assert.equal(dom.window.document.querySelector('#preview-note').hidden, false);
});
