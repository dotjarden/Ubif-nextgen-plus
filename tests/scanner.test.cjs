const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const script = fs.readFileSync(`${__dirname}/../extension/scanner.js`, 'utf8');
function boot(t) {
  const dom = new JSDOM('<input value="existing note"><textarea>previous text</textarea><button>Save</button>', { url: 'https://portal.ubreakifix.net/repair/workorders' });
  const observers = [];
  class Observer extends dom.window.MutationObserver {
    constructor(callback) { super(callback); observers.push(this); }
  }
  t.after(() => { observers.forEach(observer => observer.disconnect()); dom.window.close(); });
  const w = dom.window, navigations = [];
  const context = vm.createContext({ window: { setTimeout: w.setTimeout.bind(w), addEventListener: w.addEventListener.bind(w), dispatchEvent: w.dispatchEvent.bind(w), location: { get pathname() { return w.location.pathname; }, assign: href => navigations.push(href) } }, document: w.document, MutationObserver: Observer, URL: w.URL, Event: w.Event, CustomEvent: w.CustomEvent, HTMLInputElement: w.HTMLInputElement, HTMLTextAreaElement: w.HTMLTextAreaElement });
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

function showOEM(b, validate = true) {
  const dialog = b.w.document.createElement('section');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'Scan OEM Serial');
  dialog.innerHTML = '<input type="text"><button disabled>Confirm</button><button>Cancel</button>';
  b.w.document.body.append(dialog);
  const input = dialog.querySelector('input'), confirm = dialog.querySelector('button');
  let confirmed = 0;
  confirm.addEventListener('click', () => { confirmed++; dialog.remove(); });
  b.w.addEventListener('scanDetected', e => {
    if (!dialog.isConnected) return;
    // Model the observed portal handler, including React's deferred render.
    b.w.setTimeout(() => {
      input.value = e.detail.scan;
      confirm.disabled = !validate || !/^[0-9A-Za-z]{14,22}$/.test(e.detail.scan);
    }, 0);
  });
  return { dialog, input, confirm, get confirmed() { return confirmed; } };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 20));
test('OEM popup focuses on each opening and scan Enter confirms once after native validation', async t => {
  const b = boot(t); receive(b);
  for (let i = 0; i < 2; i++) {
    const modal = showOEM(b);
    await settle();
    assert.equal(b.w.document.activeElement, modal.input);
    b.scan('ABC1234567890123', { target: modal.input });
    assert.equal(modal.confirmed, 0);
    await settle();
    assert.equal(modal.confirmed, 1);
  }
  assert.deepEqual(b.navigations, []);
});
test('invalid OEM scans stay open and unrelated updates do not steal focus', async t => {
  const b = boot(t); receive(b);
  const modal = showOEM(b);
  await settle();
  b.scan('INVALID', { target: modal.input });
  await settle();
  assert.equal(modal.confirmed, 0);
  assert.equal(modal.confirm.disabled, true);
  const cancel = modal.dialog.querySelectorAll('button')[1];
  cancel.focus();
  modal.dialog.append(b.w.document.createElement('span'));
  await settle();
  assert.equal(b.w.document.activeElement, cancel);
});
test('OEM confirmation requires native enablement and is canceled on navigation', async t => {
  const b = boot(t); receive(b);
  const modal = showOEM(b);
  await settle();
  b.scan('ABC1234567890123', { target: modal.input });
  b.w.history.pushState({}, '', '/repair/workorders');
  await settle();
  assert.equal(modal.confirmed, 0);
});

test('OEM scans cannot confirm while the portal keeps Confirm disabled', async t => {
  const b = boot(t); receive(b);
  const modal = showOEM(b, false);
  await settle();
  b.scan('ABC1234567890123', { target: modal.input });
  await settle();
  assert.equal(modal.confirmed, 0);
  assert.equal(modal.dialog.isConnected, true);
});

/* Universal search: anything that is neither a work order nor a portal link
   becomes a query for the search field instead of being dropped. */
function withSearch(b) {
  const queries = [];
  b.context.UBIFPlusSearchUI = { run: value => { queries.push(value); return true; } };
  return queries;
}
test('a non-work-order scan hands its query to universal search and never navigates', t => {
  const b = boot(t), queries = withSearch(b);
  assert.equal(b.scan('4902567890123').defaultPrevented, true, 'the terminator is consumed so the panel stays open');
  b.scan('SN-8842-A');
  b.scan('Jane Smith');
  assert.deepEqual(queries, ['4902567890123', 'SN-8842-A', 'Jane Smith']);
  assert.deepEqual(b.navigations, [], 'a barcode never navigates');
  assert.equal(b.scan('30787644').defaultPrevented, true, 'work orders still navigate');
  assert.deepEqual(queries, ['4902567890123', 'SN-8842-A', 'Jane Smith'], 'a work order never reaches search');
  assert.deepEqual(b.navigations, ['/repair/workorder/30787644']);
});
test('prose and short values are left to the portal, never to search', t => {
  const b = boot(t), queries = withSearch(b);
  for (const value of ['the quick brown fox', 'a b c d', '1234', 'https://evil.example/x', '   ']) {
    assert.equal(b.scan(value).defaultPrevented, false, value);
  }
  assert.deepEqual(queries, []);
  assert.deepEqual(b.navigations, []);
});
test('a portal QR for any other route opens that route instead of becoming a query', t => {
  const b = boot(t), queries = withSearch(b);
  b.scan('/check-in/arrivals');
  b.scan('https://portal.ubreakifix.net/boh/inventory/purchase-orders/UBFPO000100345');
  b.scan('portal.ubreakifix.net/repair/workorders?tab=Waiting');
  assert.deepEqual(b.navigations, [
    '/check-in/arrivals',
    '/boh/inventory/purchase-orders/UBFPO000100345',
    '/repair/workorders?tab=Waiting'
  ]);
  assert.deepEqual(queries, []);
});
test('without a working search field the portal keeps the keystrokes', t => {
  const b = boot(t);
  assert.equal(b.scan('4902567890123').defaultPrevented, false, 'no search UI is installed');
  b.context.UBIFPlusSearchUI = { run: () => false };
  assert.equal(b.scan('4902567890123').defaultPrevented, false, 'search refused the query');
  assert.deepEqual(b.navigations, []);
});
