const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const model = fs.readFileSync(`${__dirname}/../extension/search-model.js`, 'utf8');
const script = fs.readFileSync(`${__dirname}/../extension/search.js`, 'utf8');
const content = fs.readFileSync(`${__dirname}/../extension/label.js`, 'utf8');
const adapter = fs.readFileSync(`${__dirname}/../extension/label-page.js`, 'utf8');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const ok = data => ({ ok: true, json: async () => data });
const empty = path => ok(path === '/api/workorders' ? { workOrders: [] } : (path.includes('upcoming-arrivals') || path.includes('/arrivals?')) ? { data: [] } : []);
function boot(t) {
  const dom = new JSDOM('<header><div class="components-header-searchbox"></div></header>', { url: 'https://portal.ubreakifix.net/', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.postMessage = data => w.setTimeout(() => w.dispatchEvent(new w.MessageEvent('message', { source: w, data })), 0);
  return w;
}
// A stand-in for Portal's dymo-connect-framework global.
function dymo(w, { printers = [{ name: 'DYMO LabelWriter 450', isConnected: true }], fail = false } = {}) {
  const prints = [];
  w.dymo = { label: { framework: {
    getLabelWriterPrinters: () => printers,
    openLabelXml: xml => ({ print(name, params, set) { if (fail) throw new Error('offline'); prints.push({ name, xml, records: JSON.parse(set) }); } }),
    LabelSetBuilder: class { constructor() { this.records = []; } addRecord() { const r = {}; this.records.push(r); return { setText: (k, v) => { r[k] = v; } }; } toString() { return JSON.stringify(this.records); } }
  } } };
  return prints;
}
const rowsFor = (w, record, query) => w.UBIFPlusSearch.rows({ kind: 'serial' }, record, query);

test('available serial results carry the full SKU-serial and product name; others do not', t => {
  const w = boot(t); w.eval(model);
  const available = { ItemNumber: '400559', ProductName: 'iPhone 13 Screen', SerialStatus: 'Available' };
  assert.deepEqual({ ...rowsFor(w, { ...available, SerialNumber: '400559-0000003979' }, '400559-0000003979')[0].reprint }, { serial: '400559-0000003979', text: 'iPhone 13 Screen' });
  assert.equal(rowsFor(w, available, 'I-0000003979')[0].reprint.serial, '400559-0000003979', 'I- shorthand expands to the SKU');
  assert.equal(rowsFor(w, available, 'S-400559-0000003979')[0].reprint.serial, '400559-0000003979');
  assert.equal(rowsFor(w, { ...available, SerialStatus: 'Sold' }, '400559-0000003979')[0].reprint, undefined);
  assert.equal(rowsFor(w, { ...available, ItemNumber: 'BB0001' }, 'I-0000003979')[0].reprint, undefined, 'never the buyback SKU');
  assert.equal(rowsFor(w, { ...available, ProductName: ' ' }, '400559-0000003979')[0].reprint, undefined);
});

test('the adapter prints once on the first connected LabelWriter with Portal’s default label', async t => {
  const w = boot(t); const prints = dymo(w); w.eval(adapter);
  const results = []; w.addEventListener('message', e => { if (e.data.type === 'label-print-result') results.push(e.data); });
  const request = { source: 'ubif-plus', type: 'label-print-request', id: 'a', serial: '400559-0000003979', text: 'iPhone 13 Screen' };
  w.dispatchEvent(new w.MessageEvent('message', { source: w, data: request }));
  w.dispatchEvent(new w.MessageEvent('message', { source: w, data: request }));
  await wait(5);
  assert.equal(prints.length, 1, 'a repeated request id never reprints');
  assert.equal(prints[0].name, 'DYMO LabelWriter 450');
  assert.deepEqual(prints[0].records, [{ TEXT: 'iPhone 13 Screen', BARCODE: '400559-0000003979' }]);
  assert.match(prints[0].xml, /30330 Return Address/);
  assert.equal(results[0].state, 'printed');
});

test('the adapter reports a missing or disconnected printer and print failures', async t => {
  for (const [options, pattern] of [[{ printers: [] }, /No label printer/], [{ printers: [{ name: 'X', isConnected: false }] }, /No label printer/], [{ fail: true }, /could not print/]]) {
    const w = boot(t); const prints = dymo(w, options); w.eval(adapter);
    let result; w.addEventListener('message', e => { if (e.data.type === 'label-print-result') result = e.data; });
    w.dispatchEvent(new w.MessageEvent('message', { source: w, data: { source: 'ubif-plus', type: 'label-print-request', id: 'b', serial: '1-2', text: 'T' } }));
    await wait(5);
    assert.equal(prints.length, 0); assert.equal(result.state, 'error'); assert.match(result.message, pattern);
  }
});

test('Print label beside an available serial prints and writes Portal’s action log', async t => {
  const w = boot(t); const prints = dymo(w); const posts = [];
  w.fetch = async (path, init) => {
    if (init?.method === 'POST' && path.includes('create-log')) { posts.push(JSON.parse(init.body)); return ok({}); }
    return path.includes('/boh/inventory/') ? ok({ ItemNumber: '400559', SerialNumber: '400559-0000003979', ProductName: 'iPhone 13 Screen', SerialStatus: 'Available' }) : empty(path);
  };
  w.eval(adapter); w.eval(content); w.eval(model); w.eval(script);
  const input = w.document.querySelector('#ubif-universal-search input');
  input.value = '400559-0000003979'; input.dispatchEvent(new w.Event('input'));
  input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await wait(25);
  const buttons = w.document.querySelectorAll('.ubif-label-action');
  assert.equal(buttons.length, 1);
  assert.equal(w.document.querySelector('.ubif-buyback-action'), null, 'available stock has no buyback button');
  buttons[0].click(); buttons[0].click();
  await wait(25);
  assert.equal(prints.length, 1, 'a double click prints once');
  assert.deepEqual(posts, [{ ActionType: 'ReprintLabel', ActionLog: 'Reprinted label for part 400559-0000003979' }]);
  assert.match(w.document.querySelector('.ubif-label-status').textContent, /DYMO LabelWriter 450/);
  assert.equal(w.location.pathname, '/', 'printing never navigates');
});

test('the label setting removes the buttons live', async t => {
  const w = boot(t); let apply;
  w.UBIFPlusSettings = { get: async () => ({ search: true, searchLabels: false }), subscribe: fn => { apply = fn; } };
  w.fetch = async path => path.includes('/boh/inventory/') ? ok({ ItemNumber: '400559', SerialNumber: '400559-0000003979', ProductName: 'Screen', SerialStatus: 'Available' }) : empty(path);
  w.eval(model); w.eval(script); await wait(5);
  const input = w.document.querySelector('#ubif-universal-search input');
  input.value = '400559-0000003979'; input.dispatchEvent(new w.Event('input'));
  input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await wait(25);
  assert.equal(w.document.querySelector('.ubif-label-action'), null);
  apply({ search: true, searchLabels: true }); await wait(25);
  assert.equal(w.document.querySelectorAll('.ubif-label-action').length, 1);
});
