const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const script = fs.readFileSync(`${__dirname}/../extension/imei-copy.js`, 'utf8');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
// Portal's device card: <p class="text">IMEI: 350166280848735</p>, rendered as separate text nodes.
const card = '<main><div class="device-card"><div class="details"><p class="text">IMEI:<!-- --> <!-- -->350166280848735</p><p class="text">Serial: R5CR1234</p></div></div></main>';
function boot(t, { path = '/repair/workorder/500089742', html = card, settings } = {}) {
  const dom = new JSDOM(html, { url: `https://portal.ubreakifix.net${path}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, copied = [], observers = [];
  // Stop observing before teardown so closing the window cannot schedule a scan.
  const NativeObserver = w.MutationObserver;
  w.MutationObserver = class extends NativeObserver { constructor(fn) { super(fn); observers.push(this); } };
  w.requestAnimationFrame = fn => w.setTimeout(fn, 0);
  t.after(() => { observers.forEach(o => o.disconnect()); dom.window.close(); });
  Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async text => { copied.push(text); } } });
  let apply;
  if (settings) w.UBIFPlusSettings = { get: async () => settings, subscribe: fn => { apply = fn; } };
  w.eval(script);
  return { w, copied, apply: next => apply(next) };
}

test('a copy button follows the IMEI and copies only the digits', async t => {
  const { w, copied } = boot(t); await wait(40);
  const buttons = w.document.querySelectorAll('button[data-ubif-imei-copy]');
  assert.equal(buttons.length, 1, 'only the IMEI line, not the serial');
  assert.equal(buttons[0].parentElement.className, 'text');
  let cardClicks = 0; w.document.querySelector('.device-card').addEventListener('click', () => cardClicks++);
  buttons[0].click(); await wait(5);
  assert.deepEqual(copied, ['350166280848735']);
  assert.equal(cardClicks, 0, 'the device card editor never opens');
  assert.equal(buttons[0].hasAttribute('data-copied'), true);
  assert.equal(buttons[0].title, 'Copied');
});

test('re-renders keep one button and follow a changed IMEI', async t => {
  const { w } = boot(t); await wait(40);
  const line = w.document.querySelector('.details .text');
  line.append(''); await wait(40);
  assert.equal(w.document.querySelectorAll('button[data-ubif-imei-copy]').length, 1);
  line.replaceChildren('IMEI: 356789012345678'); await wait(40);
  const buttons = w.document.querySelectorAll('button[data-ubif-imei-copy]');
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].getAttribute('data-ubif-imei-copy'), '356789012345678');
});

test('only work order pages, never N/A or text that merely mentions an IMEI', async t => {
  assert.equal(boot(t, { path: '/boh/inventory' }).w.document.querySelector('button[data-ubif-imei-copy]'), null);
  const { w } = boot(t, { html: '<p>IMEI: N/A</p><p>IMEI: 350166280848735 · Ready for work</p><textarea>IMEI: 350166280848735</textarea>' }); await wait(40);
  assert.equal(w.document.querySelector('button[data-ubif-imei-copy]'), null);
});

test('the setting removes and restores the buttons live', async t => {
  const { w, apply } = boot(t, { settings: { workorderImeiCopy: false } }); await wait(40);
  assert.equal(w.document.querySelector('button[data-ubif-imei-copy]'), null);
  apply({ workorderImeiCopy: true }); await wait(40);
  assert.equal(w.document.querySelectorAll('button[data-ubif-imei-copy]').length, 1);
  apply({ workorderImeiCopy: false }); await wait(40);
  assert.equal(w.document.querySelector('button[data-ubif-imei-copy]'), null);
});
