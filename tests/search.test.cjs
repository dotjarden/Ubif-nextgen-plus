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
