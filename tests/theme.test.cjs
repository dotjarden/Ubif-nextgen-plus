const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');

const read = name => fs.readFileSync(`${__dirname}/../extension/${name}`, 'utf8');
const settingsScript = read('settings.js');
const themeScript = read('theme.js');
const vendorScript = read('vendor/darkreader.js');
const manifest = JSON.parse(read('manifest.json'));
const KEY = 'ubif-plus.settings.v1';
const HINT = 'ubif-plus.dark-hint';
const tick = (w, ms = 40) => new Promise(resolve => w.setTimeout(resolve, ms));

function storage(w, stored = {}) {
  const data = JSON.parse(JSON.stringify(stored));
  const listeners = [];
  w.chrome = {
    storage: {
      local: {
        get: key => Promise.resolve(key in data ? { [key]: data[key] } : {}),
        set: object => { Object.assign(data, JSON.parse(JSON.stringify(object))); return Promise.resolve(); }
      },
      onChanged: { addListener: listener => listeners.push(listener) }
    }
  };
  return { changed: value => listeners.forEach(listener => listener({ [KEY]: { newValue: value } }, 'local')) };
}

/* Records what theme.js asks of the engine. */
function engine(w) {
  const calls = [];
  w.DarkReader = {
    enable: (theme, fixes) => calls.push(['enable', theme, fixes]),
    disable: () => calls.push(['disable']),
    setFetchMethod: () => {}
  };
  return calls;
}

function systemScheme(w, dark) {
  const query = { matches: dark, listeners: [], addEventListener: (type, fn) => query.listeners.push(fn) };
  w.matchMedia = () => query;
  return value => { query.matches = value; query.listeners.forEach(fn => fn()); };
}

const page = () => new JSDOM('<!doctype html><head></head><body><p>Portal</p>', {
  url: 'https://portal.ubreakifix.net/repair/workorders', runScripts: 'outside-only', pretendToBeVisual: true
});

test('the theme loads at document_start in the isolated world, after settings and the engine', () => {
  const entry = manifest.content_scripts[1];
  assert.deepEqual(entry.js, ['settings.js', 'vendor/darkreader.js', 'theme.js']);
  assert.equal(entry.run_at, 'document_start');
  assert.equal(entry.world, undefined, 'isolated world: the page never sees the engine');
});

test('the vendored engine matches the pinned package and leaves chrome.runtime alone', t => {
  let vendor;
  try { vendor = require('../scripts/vendor-darkreader.cjs'); vendor.build(); }
  catch { t.skip('darkreader devDependency not installed'); return; }
  const pinned = require('../package.json').devDependencies.darkreader;
  assert.match(pinned, /^\d+\.\d+\.\d+$/, 'exact version');
  assert.equal(vendorScript, vendor.build(), 'run npm run vendor after changing the darkreader version');
  assert.match(vendorScript, new RegExp(`^/\\* Dark Reader ${pinned.replace(/\./g, '\\.')} `));

  const dom = page();
  t.after(() => dom.window.close());
  const w = dom.window;
  const sendMessage = () => Promise.resolve('reply');
  const addListener = () => {};
  w.chrome = { runtime: { sendMessage, onMessage: { addListener } }, dom: {} };
  w.eval(vendorScript);
  assert.equal(typeof w.DarkReader.enable, 'function');
  assert.equal(w.chrome.runtime.sendMessage, sendMessage, 'support.js keeps the real sendMessage and its promise');
  assert.equal(w.chrome.runtime.onMessage.addListener, addListener);
});

test('dark mode follows the settings record and updates the live theme', async t => {
  const dom = page();
  t.after(() => dom.window.close());
  const w = dom.window;
  const s = storage(w, { [KEY]: { darkMode: true, darkBrightness: 90, darkContrast: 110, darkSepia: 10 } });
  const calls = engine(w);
  w.eval(settingsScript);
  w.eval(themeScript);
  await tick(w);
  assert.equal(calls.length, 1);
  const [, theme, fixes] = calls[0];
  assert.deepEqual({ ...theme }, { mode: 1, brightness: 90, contrast: 110, sepia: 10, grayscale: 0 });
  assert.equal(fixes.disableStyleSheetsProxy, true, 'no main-world stylesheet patching');
  assert.equal(w.localStorage.getItem(HINT), '1', 'next load starts dark');

  const on = { ...w.UBIFPlusSettings.defaults, darkMode: true, darkBrightness: 90, darkContrast: 110, darkSepia: 10 };
  s.changed({ ...on, darkBrightness: 120 });
  await tick(w);
  assert.equal(calls.length, 2);
  assert.equal(calls[1][1].brightness, 120, 'a change re-applies without a reload');
  s.changed({ ...on, darkBrightness: 120, board: false });
  await tick(w);
  assert.equal(calls.length, 2, 'unrelated settings do not restyle the page');

  s.changed({ ...on, darkMode: false });
  await tick(w);
  assert.deepEqual(calls.at(-1), ['disable']);
  assert.equal(w.localStorage.getItem(HINT), null);
  s.changed({ ...on, darkMode: false, board: false });
  await tick(w);
  assert.equal(calls.filter(([name]) => name === 'disable').length, 1, 'disabled only once');
});

test('dark mode stays off by default and never touches the engine', async t => {
  const dom = page();
  t.after(() => dom.window.close());
  const w = dom.window;
  storage(w);
  const calls = engine(w);
  w.eval(settingsScript);
  w.eval(themeScript);
  await tick(w);
  assert.deepEqual(calls, []);
  assert.equal(w.document.getElementById('ubif-plus-dark-guard'), null);
});

test('"only when my device uses dark mode" tracks the system scheme', async t => {
  const dom = page();
  t.after(() => dom.window.close());
  const w = dom.window;
  storage(w, { [KEY]: { darkMode: true, darkModeFollowSystem: true } });
  const calls = engine(w);
  const setSystem = systemScheme(w, false);
  w.eval(settingsScript);
  w.eval(themeScript);
  setSystem(true); // changes before the settings load are ignored
  setSystem(false);
  await tick(w);
  assert.deepEqual(calls, [], 'light system: portal stays light');
  setSystem(true);
  assert.equal(calls.at(-1)[0], 'enable');
  setSystem(false);
  assert.deepEqual(calls.at(-1), ['disable']);
});

test('a saved dark preference paints a dark background until the engine applies', async t => {
  const dom = page();
  t.after(() => dom.window.close());
  const w = dom.window;
  w.localStorage.setItem(HINT, '1');
  storage(w, { [KEY]: { darkMode: true } });
  engine(w);
  w.eval(settingsScript);
  w.eval(themeScript);
  const guard = w.document.getElementById('ubif-plus-dark-guard');
  assert.ok(guard, 'guard inserted synchronously');
  assert.match(guard.textContent, /background: #181a1b/);
  await tick(w, 120);
  assert.equal(w.document.getElementById('ubif-plus-dark-guard'), null, 'guard removed once the engine is on');
});

test('a stale hint is cleared when dark mode was turned off elsewhere', async t => {
  const dom = page();
  t.after(() => dom.window.close());
  const w = dom.window;
  w.localStorage.setItem(HINT, '1');
  storage(w, { [KEY]: { darkMode: false } });
  const calls = engine(w);
  w.eval(settingsScript);
  w.eval(themeScript);
  await tick(w, 120);
  assert.deepEqual(calls, []);
  assert.equal(w.document.getElementById('ubif-plus-dark-guard'), null);
  assert.equal(w.localStorage.getItem(HINT), null);
});

const pixels = (count, rgba) => Uint8ClampedArray.from({ length: count * 4 }, (_, i) => rgba[i % 4]);
const join = (...parts) => Uint8ClampedArray.from(parts.flatMap(part => [...part]));

test('images are classified: one-color icons, dark logos, and everything else left alone', t => {
  const dom = page();
  t.after(() => dom.window.close());
  const w = dom.window;
  storage(w); engine(w);
  w.eval(settingsScript);
  w.eval(themeScript);
  const { classifyImage } = w.UBIFPlusTheme;
  const clear = pixels(60, [0, 0, 0, 0]);
  assert.equal(classifyImage(join(clear, pixels(40, [0, 0, 0, 255]))), 'mono', 'black icon');
  assert.equal(classifyImage(join(clear, pixels(40, [128, 128, 128, 255]))), 'mono', 'grey outline device icon');
  assert.equal(classifyImage(join(clear, pixels(28, [0, 0, 0, 255]), pixels(12, [130, 36, 207, 255]))), 'invert', 'black wordmark with a purple accent');
  assert.equal(classifyImage(pixels(100, [0, 0, 0, 255])), '', 'opaque dark photo');
  assert.equal(classifyImage(join(clear, pixels(40, [255, 255, 255, 255]))), '', 'already light');
  assert.equal(classifyImage(join(clear, pixels(40, [200, 200, 200, 255]))), '', 'light grey is readable already');
  assert.equal(classifyImage(join(clear, pixels(40, [130, 36, 207, 255]))), '', 'brand purple stays');
  assert.equal(classifyImage(clear), '', 'blank image');
});

test('dark images are inverted while dark mode is on and restored when it is off', async t => {
  const dom = page();
  t.after(() => dom.window.close());
  const w = dom.window, doc = w.document;
  const s = storage(w, { [KEY]: { darkMode: true } });
  engine(w);
  const art = {
    'logo.svg': join(pixels(60, [0, 0, 0, 0]), pixels(30, [10, 10, 10, 255]), pixels(10, [130, 36, 207, 255])),
    'device.svg': join(pixels(80, [0, 0, 0, 0]), pixels(20, [128, 128, 128, 255])),
    'photo.jpg': pixels(100, [40, 40, 40, 255])
  };
  w.HTMLCanvasElement.prototype.getContext = function () {
    let drawn = null;
    return { drawImage: img => { drawn = img.getAttribute('src'); }, getImageData: () => ({ data: art[drawn] }) };
  };
  const image = src => {
    const img = doc.createElement('img');
    img.setAttribute('src', src);
    Object.defineProperties(img, { complete: { value: true }, naturalWidth: { value: 120 }, naturalHeight: { value: 40 } });
    return img;
  };
  const logo = doc.body.appendChild(image('logo.svg'));
  const device = doc.body.appendChild(image('device.svg'));
  const photo = doc.body.appendChild(image('photo.jpg'));
  w.eval(settingsScript);
  w.eval(themeScript);
  await tick(w);
  assert.equal(logo.getAttribute('data-ubif-plus-invert'), 'invert');
  assert.equal(device.getAttribute('data-ubif-plus-invert'), 'mono', 'table device icon turns light');
  assert.equal(photo.hasAttribute('data-ubif-plus-invert'), false);
  const style = doc.getElementById('ubif-plus-dark-images');
  assert.match(style.textContent, /=invert\] \{ filter: invert\(1\) hue-rotate\(180deg\)/);
  assert.match(style.textContent, /=mono\] \{ filter: brightness\(0\) invert\(0\.84\)/);
  assert.equal(style.media, 'screen', 'printing is unchanged');

  const later = doc.body.appendChild(image('logo.svg'));
  await tick(w);
  assert.equal(later.getAttribute('data-ubif-plus-invert'), 'invert', 'images added later are checked');

  s.changed({ ...w.UBIFPlusSettings.defaults, darkMode: false });
  await tick(w);
  assert.equal(doc.querySelectorAll('[data-ubif-plus-invert]').length, 0);
  assert.equal(doc.getElementById('ubif-plus-dark-images'), null);
});

test('dimmed mode and grayscale reach the engine; dimmed skips icon inversion', async t => {
  const dom = page();
  t.after(() => dom.window.close());
  const w = dom.window;
  const s = storage(w, { [KEY]: { darkMode: true, darkDimmed: true, darkGrayscale: 40 } });
  const calls = engine(w);
  w.eval(settingsScript);
  w.eval(themeScript);
  await tick(w);
  assert.equal(calls[0][1].mode, 0, 'dimmed');
  assert.equal(calls[0][1].grayscale, 40);
  assert.equal(w.document.getElementById('ubif-plus-dark-images'), null, 'no icon inversion on a dimmed page');
  assert.equal(w.localStorage.getItem(HINT), 'dim', 'the reload guard paints the dimmed background');
  s.changed({ ...w.UBIFPlusSettings.defaults, darkMode: true, darkGrayscale: 40 });
  await tick(w);
  assert.equal(calls.at(-1)[1].mode, 1);
  assert.ok(w.document.getElementById('ubif-plus-dark-images'));
  assert.equal(w.localStorage.getItem(HINT), '1');
});

test('the reload guard uses the dimmed background when dimmed was last used', async t => {
  const dom = page();
  t.after(() => dom.window.close());
  const w = dom.window;
  w.localStorage.setItem(HINT, 'dim');
  storage(w, { [KEY]: { darkMode: true, darkDimmed: true } });
  engine(w);
  w.eval(settingsScript);
  w.eval(themeScript);
  assert.match(w.document.getElementById('ubif-plus-dark-guard').textContent, /#dcdad7/);
});
