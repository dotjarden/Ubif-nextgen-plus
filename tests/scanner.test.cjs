const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const script = fs.readFileSync(`${__dirname}/../extension/scanner.js`, 'utf8');
function boot(t) {
  const dom = new JSDOM('<input value="existing note"><textarea>previous text</textarea><button>Save</button>', { url: 'https://portal.ubreakifix.net/repair/workorders' });
  t.after(() => dom.window.close());
  const w = dom.window, navigations = [];
  const context = vm.createContext({ window: { addEventListener: w.addEventListener.bind(w), dispatchEvent: w.dispatchEvent.bind(w), location: { get pathname() { return w.location.pathname; }, assign: href => navigations.push(href) } }, document: w.document, URL: w.URL, Event: w.Event, CustomEvent: w.CustomEvent, HTMLInputElement: w.HTMLInputElement, HTMLTextAreaElement: w.HTMLTextAreaElement });
  vm.runInContext(script, context);
  let time = 100;
  function key(key, target = w.document.body, delay = 10, extras = {}) {
    time += delay;
    const event = new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extras });
    Object.defineProperty(event, 'timeStamp', { value: time });
    target.dispatchEvent(event);
    return event;
  }
  function scan(value, { target = w.document.body, delay = 10, suffix = 'Enter' } = {}) {
    for (const char of value) {
      const e = key(char, target, delay);
      // jsdom does not implement the browser's default text insertion.
      if (!e.defaultPrevented && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        target.setRangeText(char, target.selectionStart, target.selectionEnd, 'end');
        target.dispatchEvent(new w.Event('input', { bubbles: true }));
      }
    }
    return key(suffix, target, delay);
  }
  return { w, navigations, context, scan, key };
}
test('opens a numeric work-order scan from any portal route without a search header', t => {
  const b = boot(t);
  assert.equal(b.scan('30787644').defaultPrevented, true);
  assert.deepEqual(b.navigations, ['/repair/workorder/30787644']);
  b.w.history.pushState({}, '', '/customer/123');
  b.scan('30787645', { target: b.w.document.querySelector('button'), suffix: 'Tab' });
  assert.equal(b.navigations[1], '/repair/workorder/30787645');
});
test('accepts portal work-order URL formats and strips query/fragment', t => {
  const b = boot(t);
  for (const value of ['https://portal.ubreakifix.net/repair/workorder/30787644?foo=bar#detail', 'portal.ubreakifix.net/repair/workorder/30787644', '/repair/workorder/30787644']) b.scan(value);
  assert.deepEqual(b.navigations, Array(3).fill('/repair/workorder/30787644'));
});
test('preserves ordinary typing, unknown barcodes, external URLs, IMEIs, and stale bursts', t => {
  const b = boot(t);
  assert.equal(b.scan('30787644', { delay: 100 }).defaultPrevented, false);
  assert.equal(b.scan('30787644', { delay: 50 }).defaultPrevented, false);
  for (const value of ['1234', '00000', '123456789012345', 'I-1234567890', 'https://evil.example/repair/workorder/30787644', 'https://portal.ubreakifix.net.evil.example/repair/workorder/30787644', 'https://user@portal.ubreakifix.net/repair/workorder/30787644']) assert.equal(b.scan(value).defaultPrevented, false);
  for (const char of '30787644') b.key(char);
  assert.equal(b.key('Enter', undefined, 100).defaultPrevented, false);
  assert.deepEqual(b.navigations, []);
});
test('restores focused form values and selections and prevents Enter/Tab reaching portal handlers', t => {
  const b = boot(t);
  for (const target of b.w.document.querySelectorAll('input, textarea')) {
    target.focus(); target.setSelectionRange(2, 5);
    const before = target.value;
    let submitted = false, restored = false;
    target.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Tab') submitted = true; });
    target.addEventListener('input', () => { if (target.value === before) restored = true; });
    b.scan('30787644', { target, suffix: target.tagName === 'INPUT' ? 'Enter' : 'Tab' });
    assert.equal(target.value, before);
    assert.equal(target.selectionStart, 2); assert.equal(target.selectionEnd, 5);
    assert.equal(restored, true); assert.equal(submitted, false);
  }
  assert.equal(b.navigations.length, 2);
});
test('ignores modified/composing/repeated keys and resets on interaction or focus changes', t => {
  const b = boot(t);
  for (const extras of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { repeat: true }]) {
    for (const char of '30787644') b.key(char, undefined, 10, extras);
    b.key('Enter');
  }
  for (const char of '30787644') b.key(char);
  b.w.dispatchEvent(new b.w.Event('blur')); b.key('Enter');
  for (const char of '30787644') b.key(char);
  b.w.document.body.dispatchEvent(new b.w.Event('pointerdown', { bubbles: true })); b.key('Enter');
  for (const char of '30787644') b.key(char);
  b.key('Enter', b.w.document.querySelector('button'));
  assert.deepEqual(b.navigations, []);
});
test('reinjection installs only one scanner handler', t => {
  const b = boot(t);
  vm.runInContext(script, b.context);
  b.scan('30787644');
  assert.equal(b.navigations.length, 1);
});

function receive(b) {
  b.w.history.pushState({}, '', '/boh/inventory/purchase-orders/UBFPO000100345/receive');
  const container = b.w.document.createElement('main');
  container.dataset.testid = 'po-receive-container';
  b.w.document.body.append(container);
  const scans = [];
  b.w.addEventListener('scanDetected', e => scans.push(e.detail.scan));
  return { container, scans };
}
test('repeated receiving scans reach the native handler once without clicking and never navigate', t => {
  const b = boot(t), { scans } = receive(b);
  for (const suffix of ['Enter', 'Tab']) {
    assert.equal(b.scan('638911-1234567890', { suffix }).defaultPrevented, true);
  }
  b.scan('30787644');
  assert.deepEqual(scans, ['638911-1234567890', '638911-1234567890', '30787644']);
  assert.deepEqual(b.navigations, []);
});
test('receiving restores a focused field and blocks its submit handler', t => {
  const b = boot(t), { scans } = receive(b), target = b.w.document.querySelector('input');
  target.setSelectionRange(2, 5);
  let submitted = false;
  target.addEventListener('keydown', e => { if (e.key === 'Enter') submitted = true; });
  b.scan('638911-1234567890', { target });
  assert.equal(target.value, 'existing note');
  assert.equal(target.selectionStart, 2);
  assert.equal(target.selectionEnd, 5);
  assert.equal(submitted, false);
  assert.equal(scans.length, 1);
});
test('receiving preserves manual input, loading states, and native dialog scans', t => {
  const b = boot(t), { container, scans } = receive(b);
  assert.equal(b.scan('638911-1234567890', { delay: 100 }).defaultPrevented, false);
  const dialog = b.w.document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  b.w.document.body.append(dialog);
  assert.equal(b.scan('30787644').defaultPrevented, false);
  dialog.remove();
  container.remove();
  assert.equal(b.scan('30787644').defaultPrevented, false);
  assert.deepEqual(scans, []);
  assert.deepEqual(b.navigations, []);
});
test('SPA navigation resets pending scans and restores work-order routing outside receive', t => {
  const b = boot(t), { scans } = receive(b);
  for (const c of '30787644') b.key(c);
  b.w.history.pushState({}, '', '/repair/workorders');
  assert.equal(b.key('Enter').defaultPrevented, false);
  b.scan('30787644');
  assert.deepEqual(scans, []);
  assert.deepEqual(b.navigations, ['/repair/workorder/30787644']);
});
