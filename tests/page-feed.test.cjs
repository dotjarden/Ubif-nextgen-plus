const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const pageScript = fs.readFileSync(`${__dirname}/../extension/page.js`, 'utf8');
const workorders = [{ workorderId: 301, workorderStatusName: 'Ready for work' }];

function boot({ useXhr = false, payload = { workOrders: workorders } } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://portal.ubreakifix.net/repair/workorders', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const seen = [];
  w.addEventListener('message', event => { if (event.data && event.data.source === 'ubif-plus') seen.push(event.data); });
  w.__fetchCalls = [];
  w.fetch = (input, init) => {
    w.__fetchCalls.push({ url: String(input), method: (init && init.method) || 'GET', body: init && init.body });
    return Promise.resolve({
      ok: true,
      clone: () => ({ json: async () => payload })
    });
  };
  if (useXhr) {
    w.XMLHttpRequest = class {
      constructor() { this.listeners = {}; }
      open(method, url) { this.meta = { method, url }; }
      send(body) { this.body = body; }
      addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
      finish(text) { this.responseText = text; (this.listeners.load || []).forEach(fn => fn()); }
    };
  }
  w.eval(pageScript);
  return { dom, w, seen };
}
const flush = w => new Promise(r => w.setTimeout(r, 20));

test('page script forwards the portal workorder response without issuing its own request', async t => {
  const { dom, w, seen } = boot(); t.after(() => dom.window.close());
  const body = JSON.stringify({ page: 1, tab: 'All' });
  await w.fetch('/api/workorders', { method: 'POST', body });
  await flush(w);
  assert.equal(w.__fetchCalls.length, 1, 'the portal still makes its own single request');
  assert.deepEqual(seen.map(m => m.type), ['workorders-request', 'workorders']);
  assert.deepEqual(seen[1].records, workorders);
});

test('other endpoints, GETs and failures are ignored', async t => {
  const { dom, w, seen } = boot(); t.after(() => dom.window.close());
  await w.fetch('/api/workorders', { method: 'GET' });
  await w.fetch('/api/notifications/stores/321', { method: 'POST', body: '{}' });
  w.fetch = () => Promise.reject(new Error('network down'));
  await w.fetch('/api/workorders', { method: 'POST', body: '{}' }).catch(() => {});
  await flush(w);
  assert.deepEqual(seen, []);
});

test('the XHR path reports request bodies and responses too', async t => {
  const { dom, w, seen } = boot({ useXhr: true }); t.after(() => dom.window.close());
  const xhr = new w.XMLHttpRequest();
  xhr.open('POST', '/api/workorders');
  xhr.send('{"tab":"Waiting"}');
  await flush(w);
  assert.deepEqual(seen.map(m => m.type), ['workorders-request']);
  xhr.finish(JSON.stringify({ workOrders: workorders }));
  await flush(w);
  assert.deepEqual(seen.map(m => m.type), ['workorders-request', 'workorders']);
  assert.equal(JSON.stringify(seen[1].records), JSON.stringify(workorders));
});

test('initialization is idempotent', async t => {
  const { dom, w, seen } = boot(); t.after(() => dom.window.close());
  const patched = w.fetch;
  w.eval(pageScript);
  assert.equal(w.fetch, patched, 'the fetch wrapper is installed once');
  await w.fetch('/api/workorders', { method: 'POST', body: '{}' });
  await flush(w);
  assert.equal(seen.filter(m => m.type === 'workorders').length, 1, 'records are forwarded once');
});

test('universal search requests do not contaminate the workorder column feed', async t => {
  const { dom, w, seen } = boot(); t.after(() => dom.window.close());
  await w.fetch('/api/workorders', { method: 'POST', body: '{"claimNumber":"123456"}', ubifPlusSearch: true });
  await flush(w);
  assert.equal(w.__fetchCalls.length, 1);
  assert.deepEqual(seen, []);
});

test('board pagination does not replace the native table feed', async t => {
  const { dom, w, seen } = boot(); t.after(() => dom.window.close());
  await w.fetch('/api/workorders', { method: 'POST', body: '{"page":2}', ubifPlusBoard: true });
  await flush(w);
  assert.deepEqual(seen, []);
});

const arrivals = [{ arrivalId: 500661184, customer: { fullName: 'Alajah Price' } }];

test('the upcoming-arrivals response reaches the content script with its URL', async t => {
  const { dom, w, seen } = boot({ payload: { data: arrivals, rowCount: 1 } }); t.after(() => dom.window.close());
  await w.fetch('/api/arrivals/upcoming-arrivals?page=1');
  await flush(w);
  assert.deepEqual(seen.map(m => m.type), ['arrivals-url', 'arrivals'], 'the URL is known before the records arrive');
  assert.equal(seen[0].url, '/api/arrivals/upcoming-arrivals?page=1');
  assert.deepEqual(seen[1].records, arrivals);
  assert.equal(seen[1].url, '/api/arrivals/upcoming-arrivals?page=1');
});

test('the XHR arrivals path forwards the URL and then the records', async t => {
  const { dom, w, seen } = boot({ useXhr: true }); t.after(() => dom.window.close());
  const xhr = new w.XMLHttpRequest();
  xhr.open('GET', '/api/arrivals/upcoming-arrivals?page=1');
  xhr.send();
  await flush(w);
  assert.deepEqual(seen.map(m => m.type), ['arrivals-url']);
  xhr.finish(JSON.stringify({ data: arrivals }));
  await flush(w);
  assert.deepEqual(seen.map(m => m.type), ['arrivals-url', 'arrivals']);
  assert.equal(seen[1].url, '/api/arrivals/upcoming-arrivals?page=1');
  // The records were parsed inside the page, so compare them across realms by shape.
  assert.equal(JSON.stringify(seen[1].records), JSON.stringify(arrivals));
});

test('other arrivals endpoints and non-GET calls stay out of the feed', async t => {
  const { dom, w, seen } = boot({ payload: { data: arrivals } }); t.after(() => dom.window.close());
  await w.fetch('/api/arrivals/some-other-report?page=1');
  await w.fetch('/api/arrivals/upcoming-arrivals?page=2', { method: 'POST' });
  await flush(w);
  assert.deepEqual(seen, []);
});
