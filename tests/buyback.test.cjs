const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const content = fs.readFileSync('extension/buyback.js', 'utf8');
const adapter = fs.readFileSync('extension/buyback-page.js', 'utf8');
const KEY = 'ubif-plus.buyback-intent';
function boot(t, path = '/boh/inventory/store-products/12345', html = '<div data-testid="store-product-container"></div>') {
  const dom = new JSDOM(html, { url: `https://portal.ubreakifix.net${path}`, runScripts: 'outside-only', virtualConsole: new VirtualConsole() });
  const observers = [];
  t.after(() => { observers.forEach(o => o.disconnect()); dom.window.close(); });
  const w = dom.window; w.AbortController = AbortController;
  const NativeObserver = w.MutationObserver;
  w.MutationObserver = class extends NativeObserver { constructor(fn) { super(fn); observers.push(this); } };
  w.postMessage = data => w.setTimeout(() => w.dispatchEvent(new w.MessageEvent('message', { source: w, data })), 0);
  return w;
}
const flush = async w => { for (let i = 0; i < 5; i++) await new Promise(r => w.setTimeout(r, 0)); };
const response = data => ({ ok: true, json: async () => data });
function start(w, result = { sku: '12345' }) {
  const row = w.document.querySelector('[data-testid=store-product-container]');
  w.UBIFPlusBuyback.start(result, row);
}
const inventory = (serial, status = 'Sold') => ({ SerialNumber: serial, SerialStatus: status });
function table(w, data) {
  const node = w.document.createElement('table');
  node.__reactFiber$fixture = { memoizedProps: { data }, return: null };
  w.document.body.append(node); return node;
}
function request(w, overrides = {}) {
  const data = { source: 'ubif-plus', type: 'buyback-print-request', id: 'intent-1', sku: '12345', serial: '12345-1234567890', order: '56789', ...overrides };
  w.dispatchEvent(new w.MessageEvent('message', { source: w, data }));
}
test('SKU shortcut completes pagination and offers only sold serials', async t => {
  const w = boot(t), paths = [];
  w.fetch = async path => {
    paths.push(path);
    return response(paths.length === 1 ? { value: [inventory('12345-1111111111'), inventory('12345-2222222222', 'Available')], '@odata.count': 3 } : { value: [inventory('12345-3333333333')], '@odata.count': 3 });
  };
  w.eval(content); start(w); await flush(w);
  assert.equal(paths.length, 2); assert.match(paths[1], /page=2/);
  assert.deepEqual([...w.document.querySelectorAll('#ubif-buyback li button')].map(b => b.textContent), ['Print 12345-1111111111', 'Print 12345-3333333333']);
  assert.equal(w.sessionStorage.getItem(KEY), null);
});
test('single sold serial is revalidated and binds an intent to its own SKU and work order', async t => {
  const w = boot(t), paths = [];
  w.fetch = async path => {
    paths.push(path);
    return response(path.includes('/inventory?') ? { value: [inventory('12345-1234567890')], '@odata.count': 1 } : { ItemNumber: '12345', SerialStatus: 'Sold', SalesOrderNumber: 'SO-1', WorkOrderId: 56789 });
  };
  // jsdom cannot navigate; the prepared same-tab intent is the navigation boundary.
  w.eval(content); start(w); await flush(w);
  const intent = JSON.parse(w.sessionStorage.getItem(KEY));
  assert.equal(intent.order, '56789'); assert.equal(intent.sku, '12345'); assert.equal(intent.serial, '12345-1234567890');
  assert.match(paths[1], /boh\/inventory\/12345-1234567890\?/);
});
test('no sold inventory, missing sale, changed SKU, and session errors never prepare printing', async t => {
  for (const detail of [null, { ItemNumber: '12345', SerialStatus: 'Sold', WorkOrderId: 56789 }, { ItemNumber: '99999', SerialStatus: 'Sold', SalesOrderNumber: 'SO-1', WorkOrderId: 56789 }, { ItemNumber: '12345', SerialStatus: 'Available', SalesOrderNumber: 'SO-1', WorkOrderId: 56789 }, { ItemNumber: '12345', SerialStatus: 'Reserved' }, 'unauthorized']) {
    const w = boot(t);
    w.fetch = async path => detail === 'unauthorized' ? { ok: false, status: 403 } : response(path.includes('/inventory?') ? { value: detail ? [inventory('12345-1234567890')] : [], '@odata.count': detail ? 1 : 0 } : detail);
    w.eval(content); start(w); await flush(w);
    assert.equal(w.sessionStorage.getItem(KEY), null);
    assert.equal(w.document.querySelector('#ubif-buyback button').disabled, false);
    assert.match(w.document.querySelector('#ubif-buyback p').textContent, /No sold|not attached|permissions/);
  }
});
test('a serial reserved to a work order opens that work order to print', async t => {
  const w = boot(t);
  w.fetch = async () => response({ ItemNumber: '12345', SerialStatus: 'Reserved', WorkOrderId: 56789 });
  w.eval(content); w.location.assign = () => {}; start(w, { sku: '12345', serial: '12345-1234567890' }); await flush(w);
  const intent = JSON.parse(w.sessionStorage.getItem(KEY));
  assert.equal(intent.order, '56789'); assert.equal(intent.serial, '12345-1234567890');
});
test('navigation discards an in-flight search result lookup', async t => {
  const w = boot(t); let resolve;
  w.fetch = () => new Promise(r => { resolve = r; });
  w.eval(content); start(w);
  w.history.pushState({}, '', '/boh/inventory/store-products/99999');
  w.document.querySelector('[data-testid]').append(w.document.createElement('span')); await flush(w);
  resolve(response({ value: [inventory('12345-1234567890')], '@odata.count': 1 })); await flush(w);
  assert.equal(w.document.querySelectorAll('#ubif-buyback').length, 0);
  assert.equal(w.sessionStorage.getItem(KEY), null);
});
test('native adapter runs exactly the matching action once, preserving serial prefix and disabled guards', t => {
  const w = boot(t, '/repair/workorder/56789', ''); let calls = 0, wrong = 0;
  const action = { id: 'print_buyback_label', isDisabled: true, onPress: () => { calls++; } };
  table(w, [{ item: { subtext: '12345-1234567890' }, actions: [action] }, { item: { subtext: '99999-1234567890' }, actions: [{ ...action, isDisabled: false, onPress: () => { wrong++; } }] }]);
  w.eval(adapter); request(w); assert.equal(calls, 0);
  action.isDisabled = false;
  request(w, { serial: 'I-1234567890' }); request(w); assert.equal(calls, 1); assert.equal(wrong, 0);
  request(w, { id: 'other', order: '99999' }); assert.equal(calls, 1);
  request(w, { id: 'prefixed', serial: 'S-12345-1234567890' }); assert.equal(calls, 2);
});
test('ambiguous cart lines and stale React fibers cannot print', t => {
  const w = boot(t, '/repair/workorder/56789', ''); let calls = 0;
  const row = () => ({ item: { subtext: '12345-1234567890' }, actions: [{ id: 'print_buyback_label', onPress: () => { calls++; } }] });
  const node = table(w, [row(), row()]); w.eval(adapter); request(w); assert.equal(calls, 0);
  const old = { memoizedProps: { data: [row()] }, return: null };
  const current = { memoizedProps: { data: [] }, return: null };
  old.stateNode = { current }; old.alternate = current; node.__reactFiber$fixture = old;
  request(w, { id: 'next' }); assert.equal(calls, 0);
});
test('workorder resume consumes intent and invokes Portal once, even across reloads', async t => {
  const w = boot(t, '/repair/workorder/56789', ''); let calls = 0;
  table(w, [{ item: { subtext: '12345-1234567890' }, actions: [{ id: 'print_buyback_label', onPress: () => { calls++; } }] }]);
  w.sessionStorage.setItem(KEY, JSON.stringify({ id: 'print-once', sku: '12345', serial: '12345-1234567890', order: '56789', created: Date.now() }));
  w.eval(adapter); w.eval(content); await flush(w);
  assert.equal(calls, 1); assert.equal(w.sessionStorage.getItem(KEY), null);
  assert.match(w.document.querySelector('#ubif-buyback').textContent, /requested/);
  w.eval(content); await flush(w); assert.equal(calls, 1);
});
test('expired or wrong-route intents are consumed without printing', async t => {
  for (const intent of [{ order: '56789', created: Date.now() - 120000 }, { order: '99999', created: Date.now() }]) {
    const w = boot(t, '/repair/workorder/56789', ''); let calls = 0;
    table(w, [{ item: { subtext: '12345-1234567890' }, actions: [{ id: 'print_buyback_label', onPress: () => { calls++; } }] }]);
    w.sessionStorage.setItem(KEY, JSON.stringify({ id: 'expired', sku: '12345', serial: '12345-1234567890', ...intent }));
    w.eval(adapter); w.eval(content); await flush(w); assert.equal(calls, 0); assert.equal(w.sessionStorage.getItem(KEY), null);
  }
});
test('partial or repeated inventory pages never offer an incomplete serial selection', async t => {
  const w = boot(t);
  w.fetch = async () => response({ value: [inventory('12345-1234567890')], '@odata.count': 3 });
  w.eval(content); start(w); await flush(w);
  assert.equal(w.sessionStorage.getItem(KEY), null); assert.equal(w.document.querySelectorAll('li button').length, 0);
  assert.match(w.document.querySelector('#ubif-buyback p').textContent, /all inventory pages/);
});
test('cancel stops pending workorder polling before its native action becomes available', async t => {
  const w = boot(t, '/repair/workorder/56789', ''); let calls = 0;
  w.sessionStorage.setItem(KEY, JSON.stringify({ id: 'cancel', sku: '12345', serial: '12345-1234567890', order: '56789', created: Date.now() }));
  w.eval(adapter); w.eval(content); await flush(w); w.document.querySelector('#ubif-buyback button').click();
  table(w, [{ item: { subtext: '12345-1234567890' }, actions: [{ id: 'print_buyback_label', onPress: () => { calls++; } }] }]);
  await new Promise(r => w.setTimeout(r, 550)); assert.equal(calls, 0); assert.equal(w.sessionStorage.getItem(KEY), null);
});
test('a native print exception is consumed and cannot automatically reprint', t => {
  const w = boot(t, '/repair/workorder/56789', ''); let calls = 0;
  table(w, [{ item: { subtext: '12345-1234567890' }, actions: [{ id: 'print_buyback_label', onPress: () => { calls++; throw new Error('printer'); } }] }]);
  w.eval(adapter); request(w); request(w); assert.equal(calls, 1);
});

test('product pages no longer mount a buyback panel', t => {
  const w = boot(t); w.eval(content); assert.equal(w.document.querySelector('#ubif-buyback'), null);
});
test('sold serial result prints its exact serial without looking up other inventory', async t => {
  const w = boot(t); const paths = [];
  w.fetch = async path => { paths.push(path); return response({ ItemNumber: '12345', SerialStatus: 'Sold', SalesOrderNumber: 'SO-1', WorkOrderId: 56789 }); };
  w.eval(content); start(w, { sku: '12345', serial: 'I-1234567890' }); await flush(w);
  assert.equal(paths.length, 1); assert.match(paths[0], /inventory\/I-1234567890\?/);
  assert.equal(JSON.parse(w.sessionStorage.getItem(KEY)).serial, 'I-1234567890');
});
test('turning the setting off cancels lookup and prevents late navigation', async t => {
  const w = boot(t); let apply, finish;
  w.UBIFPlusSettings = { get: async () => ({ search: true, searchBuyback: true }), subscribe: fn => { apply = fn; } };
  w.fetch = () => new Promise(r => { finish = r; });
  w.eval(content); await flush(w); start(w); apply({ search: true, searchBuyback: false });
  finish(response({ value: [inventory('12345-1234567890')], '@odata.count': 1 })); await flush(w);
  assert.equal(w.sessionStorage.getItem(KEY), null); assert.equal(w.document.querySelector('#ubif-buyback'), null);
  assert.equal(w.UBIFPlusBuyback.start({ sku: '12345' }, w.document.querySelector('[data-testid]')), false);
});
test('disabled persisted setting consumes a pending print without running it', async t => {
  const w = boot(t, '/repair/workorder/56789', ''); let calls = 0;
  w.UBIFPlusSettings = { get: async () => ({ searchBuyback: false }), subscribe: () => {} };
  table(w, [{ item: { subtext: '12345-1234567890' }, actions: [{ id: 'print_buyback_label', onPress: () => { calls++; } }] }]);
  w.sessionStorage.setItem(KEY, JSON.stringify({ id: 'disabled', sku: '12345', serial: '12345-1234567890', order: '56789', created: Date.now() }));
  w.eval(adapter); w.eval(content); await flush(w);
  assert.equal(calls, 0); assert.equal(w.sessionStorage.getItem(KEY), null);
});
