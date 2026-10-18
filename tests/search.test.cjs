const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const model = fs.readFileSync(`${__dirname}/../extension/search-model.js`, 'utf8');
const script = fs.readFileSync(`${__dirname}/../extension/search.js`, 'utf8');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function boot(t, fetcher, markup = '<header><div class="components-header-searchbox"><button>Search</button></div></header>') {
  const dom = new JSDOM(markup, { url: 'https://portal.ubreakifix.net/', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  dom.window.fetch = fetcher;
  dom.window.eval(model); dom.window.eval(script);
  return dom.window;
}
function enter(w, value) {
  const input = w.document.querySelector('#ubif-universal-search input');
  input.value = value;
  input.dispatchEvent(new w.Event('input'));
  input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  return input;
}
const ok = data => ({ ok: true, json: async () => data });
const empty = path => ok(path === '/api/workorders' ? { workOrders: [] } : (path.includes('upcoming-arrivals') || path.includes('/arrivals?')) ? { data: [] } : []);

test('plans all applicable categories and never sends an unfiltered workorder request', t => {
  const w = boot(t, async () => ok([]));
  const plan = w.UBIFPlusSearch.plan;
  assert.equal(plan('ab').length, 0);
  assert.equal(plan('a'.repeat(201)).length, 0);
  assert.equal(plan('12345').filter(r => r.category === 'Work orders').length, 1);
  assert.equal(plan('123456').length, 5);
  assert.equal(plan('I-1234567890').find(r => r.kind === 'serial').path, '/api/boh/inventory/I-1234567890?includeQuarantineInfo=false&includeSalvageInfo=false');
  assert.equal(plan('Jane & Jack').find(r => r.kind === 'customers').path, '/api/customers?searchTerm=Jane%20%26%20Jack');
  assert.ok(plan('Jane Smith').filter(r => r.body).every(r => r.body.claimNumber));
});

test('one field searches concurrently, retains successful results and reports partial failures', async t => {
  const calls = [];
  const w = boot(t, async (path, init) => {
    calls.push({ path, init });
    if (path.includes('/customers?')) return ok([{ id: 7, fullName: '<img src=x onerror=alert(1)>', clientId: 1 }]);
    if (path.includes('available-parts')) return { ok: false, status: 500 };
    return empty(path);
  });
  enter(w, '123456'); await wait(25);
  assert.equal(calls.length, 6);
  assert.ok(calls.every(c => c.init.credentials === 'same-origin'));
  const panel = w.document.querySelector('#ubif-search-results');
  assert.match(panel.textContent, /Some searches could not finish/);
  assert.match(panel.textContent, /<img src=x/);
  assert.equal(panel.querySelector('img'), null);
  assert.match(panel.querySelector('a').getAttribute('href'), /^\/customer\/7\?/);
  assert.equal(w.document.querySelector('.components-header-searchbox > button').hasAttribute('data-ubif-native-search'), true);
});

test('late results cannot replace a newer query and clearing cancels requests', async t => {
  let finish;
  const w = boot(t, path => path.includes('old') ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(path.includes('/customers?') ? ok([{ id: 9, fullName: 'New Person' }]) : empty(path)));
  enter(w, 'old');
  enter(w, 'new'); await wait(20);
  finish(ok([{ id: 1, name: 'Old item', itemNumber: 'old' }])); await wait(20);
  assert.match(w.document.querySelector('#ubif-search-results').textContent, /New Person/);
  assert.doesNotMatch(w.document.querySelector('#ubif-search-results').textContent, /Old item/);
  w.document.querySelector('#ubif-search-clear').click();
  assert.equal(w.document.querySelectorAll('#ubif-search-results a').length, 0);
});

test('the clear button only exists while there is text, and never beside the browser\'s own', async t => {
  const w = boot(t, async () => ok([]));
  const root = w.document.querySelector('#ubif-universal-search');
  const input = root.querySelector('input');
  const clear = root.querySelector('#ubif-search-clear');
  const css = [...w.document.querySelectorAll('style')].map(node => node.textContent).join('');
  assert.match(css, /#ubif-universal-search input::-webkit-search-cancel-button/, 'the native clear button is suppressed');
  assert.match(css, /#ubif-universal-search:not\(\[data-ubif-empty\]\) input \{ padding-right:34px; \}/, 'text only reserves room for the clear button');
  assert.match(css, /#ubif-search-clear\[hidden\] \{ display:none; \}/);
  assert.equal(clear.hidden, true, 'an empty field has no clear button');
  assert.equal(root.hasAttribute('data-ubif-empty'), true, 'the placeholder keeps the full width');
  enter(w, 'Jane'); await wait(20);
  assert.equal(clear.hidden, false, 'text makes it appear');
  assert.equal(root.hasAttribute('data-ubif-empty'), false);
  clear.click();
  assert.equal(input.value, '');
  assert.equal(clear.hidden, true, 'clearing hides it again');
  assert.equal(root.hasAttribute('data-ubif-empty'), true);
});

test('a result under the pointer survives a rebuild, which waits for the click', async t => {
  const w = boot(t, async () => ok([{ id: 7, fullName: 'Ali Ahmad', clientId: 1 }]));
  enter(w, 'ali'); await wait(30);
  const panel = w.document.querySelector('#ubif-search-results');
  const link = panel.querySelector('a');
  assert.ok(link, 'a result is on screen');
  link.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true }));
  // A late category response rebuilds the panel through changed(); typing forces
  // the same rebuild path while the press is still down.
  const input = w.document.querySelector('#ubif-universal-search input');
  input.value = 'ali2'; input.dispatchEvent(new w.Event('input'));
  assert.equal(panel.querySelector('a'), link, 'the pressed row is still the row on screen');
  w.dispatchEvent(new w.MouseEvent('pointerup'));
  await wait(20);
  assert.notEqual(panel.querySelector('a'), link, 'the rebuild lands once the click has been dispatched');
});

test('a missed release never keeps the panel frozen', async t => {
  const w = boot(t, async () => ok([{ id: 7, fullName: 'Ali Ahmad', clientId: 1 }]));
  enter(w, 'ali'); await wait(30);
  const panel = w.document.querySelector('#ubif-search-results');
  const input = w.document.querySelector('#ubif-universal-search input');
  const link = panel.querySelector('a');
  link.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true }));
  // The release never arrives: the pointer left the window mid-drag.
  input.value = 'ali2'; input.dispatchEvent(new w.Event('input'));
  assert.equal(panel.querySelector('a'), link, 'held while the press is live');
  await wait(1100);
  assert.notEqual(panel.querySelector('a'), link, 'the press expires on its own');
  // And a press outside the panel ends it straight away.
  enter(w, 'ali'); await wait(30);
  assert.ok(panel.querySelector('a'), 'results are back');
  panel.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true }));
  input.value = 'ali3'; input.dispatchEvent(new w.Event('input'));
  assert.ok(panel.querySelector('a'), 'still held');
  w.document.body.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true }));
  await wait(20);
  assert.equal(panel.querySelector('a'), null, 'an outside press flushes the backlog');
});

test('the field has one state — open in the header — and focus changes nothing', async t => {
  const w = boot(t, async () => ok([]));
  const root = w.document.querySelector('#ubif-universal-search');
  const input = root.querySelector('input');
  const css = [...w.document.querySelectorAll('style')].map(node => node.textContent).join('');
  assert.match(css, /#ubif-universal-search \{ position:relative; width:100%; min-width:0; max-width:480px;/, 'one width, no collapsed variant');
  assert.match(css, /components-header-searchbox:has\(> #ubif-universal-search\) \{ flex:1 1 auto; min-width:0; max-width:480px; margin-inline-end:16px; \}/, 'the field takes the header\'s spare space, up to the width it opens at, and never touches UBIF support');
  assert.doesNotMatch(css, /data-ubif-expanded/, 'no collapsed/expanded duality');
  assert.equal(input.placeholder, 'Search everything…');
  input.dispatchEvent(new w.FocusEvent('focus'));
  assert.equal(root.hasAttribute('data-ubif-expanded'), false, 'focusing adds no state');
  assert.equal(input.placeholder, 'Search everything…');
  input.dispatchEvent(new w.FocusEvent('focusout', { bubbles: true, relatedTarget: w.document.body }));
  assert.equal(root.hasAttribute('data-ubif-expanded'), false, 'blurring changes no state');
  assert.equal(input.placeholder, 'Search everything…');
});

test('debounces typing, supports keyboard dismissal, and mounts after SPA header replacement', async t => {
  let count = 0;
  const w = boot(t, async path => { count++; return empty(path); });
  const input = w.document.querySelector('#ubif-universal-search input');
  for (const value of ['J', 'Ja', 'Jan', 'Jane']) { input.value = value; input.dispatchEvent(new w.Event('input')); }
  await wait(400); assert.equal(count, 2);
  input.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(w.document.querySelector('#ubif-search-results').hidden, true);
  w.document.querySelector('header').innerHTML = '<div class="components-header-searchbox"><div><div class="search-field"><input></div><div>Native categories</div></div></div>';
  await wait(10);
  assert.equal(w.document.querySelectorAll('#ubif-universal-search').length, 1);
  assert.equal(input.value, '');
  w.eval(script);
  assert.equal(w.document.querySelectorAll('#ubif-universal-search').length, 1);
});

test('maps business customers, arrivals, items and serial results to observed portal routes', t => {
  const w = boot(t, async () => ok([]));
  const rows = w.UBIFPlusSearch.rows;
  assert.equal(rows({ kind: 'customers' }, [{ id: 4, customerTypeId: 2 }], 'test')[0].href, '/admin/business-clients/4');
  assert.equal(rows({ kind: 'arrivals' }, { data: [{ arrivalId: 5 }] }, 'test')[0].href, '/check-in/arrivals/5');
  assert.equal(rows({ kind: 'items' }, [{ itemNumber: 'A/B' }], 'test')[0].href, '/boh/inventory/store-products/A%2FB');
  assert.equal(rows({ kind: 'serial' }, { ItemNumber: '123' }, 'I-1234567890')[0].href, '/boh/inventory/store-products/123');
  assert.throws(() => rows({ kind: 'customers' }, { error: true }, 'test'));
});

test('a unique customer includes their arrivals with plain appointment/arrival labels', async t => {
  const w = boot(t, async path => {
    if (path.startsWith('/api/customers?')) return ok([{ id: 42, fullName: 'Alex Example' }]);
    if (path.startsWith('/api/customers/42/arrivals?')) return ok({ data: [
      { arrivalId: 81, customer: { fullName: 'Alex Example' }, appointment: '2026-10-12T13:00:00' },
      { arrivalId: 82, customer: { fullName: 'Alex Example' }, appointment: null }
    ] });
    return empty(path);
  });
  enter(w, 'Alex'); await wait(25);
  const panel = w.document.querySelector('#ubif-search-results');
  assert.deepEqual([...panel.querySelectorAll('.ubif-result-label')].map(el => el.textContent), ['Appointment', 'Arrival']);
  assert.equal(panel.querySelector('a[href="/check-in/arrivals/81"] .ubif-result-label').tagName, 'SPAN');
  assert.match(panel.textContent, /3 results/);
});

test('buyback buttons sit beside item and sold serial links and bind their own result', async t => {
  const w = boot(t, async path => path.includes('available-parts') ? ok([{ itemNumber: '12345', name: 'Screen' }, { itemNumber: '99999', name: 'Battery' }]) : path.includes('/boh/inventory/') ? ok({ ItemNumber: '12345', ProductName: 'Sold screen', SerialStatus: 'Sold' }) : empty(path));
  const starts = []; w.UBIFPlusBuyback = { cancel() {}, start: (row, node) => starts.push({ row, node }) };
  enter(w, 'I-1234567890'); await wait(25);
  const buttons = [...w.document.querySelectorAll('.ubif-buyback-action')]; assert.equal(buttons.length, 3);
  for (const button of buttons) {
    assert.equal(button.parentElement.querySelector('a').contains(button), false);
    assert.match(button.parentElement.querySelector('a').href, /store-products/);
  }
  buttons[1].click(); buttons[2].click();
  assert.equal(starts[0].row.sku, '99999');
  assert.equal(starts[1].row.sku, '12345'); assert.equal(starts[1].row.serial, 'I-1234567890');
  assert.equal(starts[1].node, buttons[2].parentElement);
  assert.equal(w.location.pathname, '/');
});
test('serial results reserved to a work order get a buyback button; unattached ones do not', t => {
  const w = boot(t, async () => ok([]));
  const rows = (record, query = '12345-1234567890') => w.UBIFPlusSearch.rows({ kind: 'serial' }, record, query)[0];
  assert.equal(rows({ ItemNumber: '12345', SerialStatus: 'Reserved', WorkOrderId: 56789 }).buyback.serial, '12345-1234567890');
  assert.equal(rows({ ItemNumber: '12345', SerialStatus: 'Reserved' }).buyback, undefined);
  assert.equal(rows({ ItemNumber: '12345', SerialStatus: 'Available', WorkOrderId: 56789 }).buyback, undefined);
});
test('buyback setting removes buttons live while normal result links stay available', async t => {
  const dom = new JSDOM('<header><div class="components-header-searchbox"></div></header>', { url: 'https://portal.ubreakifix.net/', runScripts: 'outside-only' });
  t.after(() => dom.window.close()); const w = dom.window; let apply;
  w.UBIFPlusSettings = { get: async () => ({ search: true, searchBuyback: false }), subscribe: fn => { apply = fn; } };
  w.fetch = async path => path.includes('available-parts') ? ok([{ itemNumber: '12345', name: 'Screen' }]) : empty(path);
  w.eval(model); w.eval(script); await wait(5); enter(w, 'screen'); await wait(20);
  assert.equal(w.document.querySelector('.ubif-buyback-action'), null);
  assert.equal(w.document.querySelectorAll('#ubif-search-results a').length, 1);
  apply({ search: true, searchBuyback: true }); await wait(20);
  assert.equal(w.document.querySelectorAll('.ubif-buyback-action').length, 1);
  apply({ search: true, searchBuyback: false }); await wait(20);
  assert.equal(w.document.querySelector('.ubif-buyback-action'), null);
});
test('remaining category responses preserve the inline serial chooser and newer queries cancel it', async t => {
  let finishCustomer;
  const w = boot(t, async path => {
    if (path.includes('/customers?') && path.includes('screen')) return new Promise(resolve => { finishCustomer = resolve; });
    if (path.includes('available-parts')) return ok([{ itemNumber: '12345', name: 'Screen' }]);
    if (path.includes('/store-products/')) return ok({ value: [{ SerialNumber: '12345-1111111111', SerialStatus: 'Sold' }, { SerialNumber: '12345-2222222222', SerialStatus: 'Sold' }], '@odata.count': 2 });
    return empty(path);
  });
  w.eval(fs.readFileSync(`${__dirname}/../extension/buyback.js`, 'utf8'));
  enter(w, 'screen'); await wait(20); w.document.querySelector('.ubif-buyback-action').click(); await wait(20);
  const chooser = w.document.querySelector('#ubif-buyback'); assert.equal(chooser.querySelectorAll('li button').length, 2);
  finishCustomer(ok([])); await wait(20);
  assert.equal(w.document.querySelector('#ubif-buyback'), chooser);
  assert.equal(chooser.closest('.ubif-result-row').querySelector('a').textContent.includes('Screen'), true);
  enter(w, 'battery'); await wait(20); assert.equal(w.document.querySelector('#ubif-buyback'), null);
});

test('native inline tags show status, source, program and claim within the result and turn off live', async t => {
  let apply;
  const dom = new JSDOM('<header><div class="components-header-searchbox"></div></header>', { url: 'https://portal.ubreakifix.net', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.UBIFPlusSettings = { get: async () => ({ search: true, searchInlineTags: true }), subscribe: fn => { apply = fn; } };
  w.fetch = async path => path === '/api/workorders' ? ok({ workOrders: [{ workorderId: 123456, customer: { fullName: 'Alex Smith' }, clientId: 3, deviceCatalog: {name: 'iPhone 16'}, workorderStatusName: 'Ready for pickup', programName: 'Asurion Mobility', source: 'Remote Tech', claimNumber: 'CL123' }] }) : empty(path);
  w.eval(model); w.eval(script);
  enter(w, '123456'); await wait(25);
  const panel = w.document.querySelector('#ubif-search-results');
  assert.equal(panel.querySelectorAll('.ubif-search-filter').length, 0);
  const row = panel.querySelector('a[href="/repair/workorder/123456"]');
  assert.deepEqual([...row.querySelectorAll('.ubif-result-tag')].map(n => n.textContent), ['AT&T', 'Asurion Mobility', 'Remote Tech', 'Ready for pickup', 'Claim CL123']);
  assert.equal(row.querySelector('[data-tone=green]').textContent, 'Ready for pickup');
  assert.equal(row.querySelector('[data-tone=purple]').textContent, 'Asurion Mobility');
  assert.equal(row.querySelector('small').textContent, 'iPhone 16');
  apply({ search: true, searchInlineTags: false }); await wait(25);
  assert.equal(panel.querySelectorAll('.ubif-result-tag').length, 0);
  assert.ok(panel.querySelector('a[href="/repair/workorder/123456"]'));
});
