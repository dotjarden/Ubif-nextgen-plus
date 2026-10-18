const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');

const read = name => fs.readFileSync(`${__dirname}/../extension/${name}`, 'utf8');
const optionsHtml = read('options.html');
const scripts = ['settings.js', 'note-templates.js', 'hotkey-model.js', 'message-model.js', 'message-ui.js', 'whats-new.js', 'settings-ui.js', 'options.js', 'settings-editors.js'].map(read);
const KEY = 'ubif-plus.settings.v1';
const tick = (w, ms = 40) => new Promise(resolve => w.setTimeout(resolve, ms));
const plain = value => JSON.parse(JSON.stringify(value));

function storage(w, stored = {}) {
  const data = plain(stored), listeners = [], opened = [];
  const fire = changes => listeners.forEach(fn => fn(changes, 'local'));
  w.chrome = {
    runtime: { getManifest: () => ({ version: '9.9.9' }), getURL: path => `chrome-extension://abcdef/${path}` },
    tabs: { create: ({ url }) => { opened.push(url); return Promise.resolve({ url }); } },
    storage: {
      local: {
        get: key => Promise.resolve(key == null ? plain(data) : key in data ? { [key]: plain(data[key]) } : {}),
        set: object => { Object.assign(data, plain(object)); fire(Object.fromEntries(Object.keys(object).map(k => [k, { newValue: plain(object[k]) }]))); return Promise.resolve(); },
        remove: keys => { const list = [].concat(keys); for (const k of list) delete data[k]; fire(Object.fromEntries(list.map(k => [k, { newValue: undefined }]))); return Promise.resolve(); }
      },
      onChanged: { addListener: fn => listeners.push(fn), removeListener() {} }
    }
  };
  return { data, opened };
}

async function options(hash = '', stored = {}) {
  const dom = new JSDOM(optionsHtml, { url: `chrome-extension://abcdef/options.html${hash}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const s = storage(w, stored);
  for (const script of scripts) w.eval(script);
  await tick(w);
  return { dom, w, doc: w.document, ...s };
}

test('saved layouts and remembered store emails are listed and can be reset', async t => {
  const page = await options('#columns', {
    'ubif-plus.columns.v1.All': { v: 3, order: ['a', 'b', 'c', 'd'], hidden: ['d'] },
    'ubif-plus.columns.v1.arrivals.Upcoming': { v: 3, order: ['x', 'y'], hidden: [] },
    'ubif-plus.samsung.store-emails.v1': { 878: 'manchester@ubreakifix.com' }
  });
  t.after(() => page.dom.window.close());
  const layouts = page.doc.getElementById('layout-summary');
  assert.match(layouts.textContent, /Arrivals · Upcoming · 2 of 2 columns shown/);
  assert.match(layouts.textContent, /Workorders · All · 3 of 4 columns shown/);
  [...layouts.querySelectorAll('button')].find(b => /Workorders · All/.test(b.getAttribute('aria-label'))).click();
  await tick(page.w);
  assert.equal('ubif-plus.columns.v1.All' in page.data, false);
  assert.doesNotMatch(page.doc.getElementById('layout-summary').textContent, /Workorders · All/);
  const emails = page.doc.getElementById('store-emails');
  assert.match(emails.textContent, /Store #878 · manchester@ubreakifix\.com/);
  emails.querySelector('button').click();
  await tick(page.w);
  assert.deepEqual(page.data['ubif-plus.samsung.store-emails.v1'], {});
});

test('export collects the whole setup and import checks every part', async t => {
  const page = await options('#backup', {
    [KEY]: { search: false },
    'ubif-plus.hotkeys.v1': { 'samsung.gd': 'alt+g' },
    'ubif-plus.note-templates.v1': { version: 1, overrides: { oop: 'My OOP' } },
    'ubif-plus.columns.v1.All': { v: 3, order: ['a'], hidden: [] },
    'unrelated.key': 'kept out'
  });
  t.after(() => page.dom.window.close());
  let exported = null;
  page.w.URL.createObjectURL = blob => { exported = blob; return 'blob:x'; };
  page.w.URL.revokeObjectURL = () => {};
  page.w.Blob = Blob; // jsdom's Blob cannot be read back
  page.doc.getElementById('export-settings').click();
  await tick(page.w);
  const file = JSON.parse(await exported.text());
  assert.equal(file.app, 'ubif-nextgen-plus');
  assert.equal(file.version, '9.9.9');
  assert.deepEqual(Object.keys(file.data).sort(), [KEY, 'ubif-plus.columns.v1.All', 'ubif-plus.hotkeys.v1', 'ubif-plus.note-templates.v1'].sort());

  const incoming = { app: 'ubif-nextgen-plus', data: {
    [KEY]: { search: true, board: false, searchMinChars: 99, bogus: 1 },
    'ubif-plus.hotkeys.v1': { 'template.oop': 'alt+o', 'samsung.gd': 'ctrl+c' },
    'ubif-plus.samsung.store-emails.v1': { 550: 'newington@ubreakifix.com', nope: 'x' },
    'ubif-plus.columns.v1.<script>': { order: [] },
    'something.else': 'ignored'
  } };
  let asked = '';
  page.w.confirm = text => { asked = text; return true; };
  const input = page.doc.getElementById('import-file');
  Object.defineProperty(input, 'files', { value: [{ name: 'setup.json', text: async () => JSON.stringify(incoming) }], configurable: true });
  input.dispatchEvent(new page.w.Event('change'));
  await tick(page.w, 80);
  assert.match(asked, /settings, shortcuts, store emails/);
  assert.equal(page.data[KEY].board, false);
  assert.equal(page.data[KEY].searchMinChars, 10, 'settings are clamped on import');
  assert.equal('bogus' in page.data[KEY], false);
  assert.deepEqual(page.data['ubif-plus.hotkeys.v1'], { 'template.oop': 'alt+o' }, 'refused combinations are dropped');
  assert.deepEqual(page.data['ubif-plus.samsung.store-emails.v1'], { 550: 'newington@ubreakifix.com' });
  assert.equal('ubif-plus.columns.v1.<script>' in page.data, false);
  assert.equal('something.else' in page.data, false);
  assert.match(page.doc.getElementById('backup-status').textContent, /Imported/);

  Object.defineProperty(input, 'files', { value: [{ name: 'x.json', text: async () => '{"app":"other"}' }], configurable: true });
  input.dispatchEvent(new page.w.Event('change'));
  await tick(page.w);
  assert.match(page.doc.getElementById('backup-status').textContent, /not a UBIF NextGen Plus setup/);
});

test('reset everything only touches what was chosen', async t => {
  const page = await options('#reset-all', {
    [KEY]: { search: false },
    'ubif-plus.hotkeys.v1': { 'samsung.gd': 'alt+g' },
    'ubif-plus.columns.v1.All': { v: 3, order: ['a'], hidden: [] },
    'ubif-plus.message-templates.v1': { v: 1 }
  });
  t.after(() => page.dom.window.close());
  const dialog = page.doc.getElementById('reset-dialog');
  page.doc.getElementById('reset-everything').click();
  assert.equal(dialog.hasAttribute('open'), true);
  const form = dialog.querySelector('form');
  form.elements.hotkeys.checked = true;
  dialog.returnValue = 'reset';
  dialog.dispatchEvent(new page.w.Event('close'));
  await tick(page.w, 80);
  assert.equal(page.data[KEY].search, true, 'settings reset');
  assert.deepEqual(page.data['ubif-plus.hotkeys.v1'], {});
  assert.ok(page.data['ubif-plus.columns.v1.All'], 'layouts kept unless chosen');
  assert.ok(page.data['ubif-plus.message-templates.v1'], 'message templates are never reset here');
});

test('the Templates page edits customer messages with an example customer', async t => {
  const page = await options('#templates/messages');
  t.after(() => page.dom.window.close());
  assert.equal(page.doc.getElementById('group-templates').hidden, false);
  assert.equal(page.doc.getElementById('tab-messages').getAttribute('aria-selected'), 'true');
  await tick(page.w, 60);
  const root = page.doc.getElementById('message-editor').shadowRoot;
  assert.ok(root, 'the chat editor is mounted');
  assert.equal(root.querySelector('.workspace').hidden, false, 'the library is open');
  page.doc.getElementById('tab-notes').click();
  assert.equal(page.doc.getElementById('templates-notes').hidden, false);
  assert.equal(page.doc.getElementById('templates-messages').hidden, true);
});

test('Portal features open settings at the right card through the worker', async () => {
  const listeners = [], created = [];
  const chrome = {
    runtime: { getURL: path => `chrome-extension://abcdef/${path}`, onMessage: { addListener: fn => listeners.push(fn) } },
    tabs: { create: async options => { created.push(options.url); return {}; }, onRemoved: { addListener() {} } },
    storage: { session: {} }, notifications: {}, action: { setBadgeBackgroundColor() {} }
  };
  new Function('chrome', 'importScripts', read('background.js'))(chrome, name => new Function(read(name))());
  const send = (message, url) => new Promise(resolve => { for (const fn of listeners) if (fn(message, { url, tab: { id: 1 } }, resolve) === true) return; resolve(undefined); });
  assert.deepEqual(await send({ type: 'ubif-plus-open-settings', hash: '#templates/notes' }, 'https://portal.ubreakifix.net/repair/workorder/1'), { ok: true });
  await send({ type: 'ubif-plus-open-settings', hash: 'javascript:alert(1)' }, 'https://portal.ubreakifix.net/');
  assert.deepEqual(await send({ type: 'ubif-plus-open-settings', hash: '#samsung' }, 'https://example.com/'), { ok: false });
  assert.deepEqual(created, ['chrome-extension://abcdef/options.html#templates/notes', 'chrome-extension://abcdef/options.html'], 'odd links fall back to the page itself');
});

test('the slash key focuses search and Enter opens the first result', async t => {
  const page = await options();
  t.after(() => page.dom.window.close());
  page.doc.body.dispatchEvent(new page.w.KeyboardEvent('keydown', { key: '/', bubbles: true }));
  const search = page.doc.getElementById('settings-search');
  assert.equal(page.doc.activeElement, search);
  search.value = 'gd version'; search.dispatchEvent(new page.w.Event('input'));
  search.dispatchEvent(new page.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(page.doc.getElementById('group-workorders').hidden, false);
  assert.equal(page.doc.querySelector('[data-key=samsungGdVersion]').closest('.row').hasAttribute('data-flash'), true);
});
