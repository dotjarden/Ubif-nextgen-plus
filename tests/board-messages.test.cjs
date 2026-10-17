const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const adapter = fs.readFileSync(`${__dirname}/../extension/messages-page.js`, 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 30));
function boot(t, options = {}) {
  const dom = new JSDOM('<section id="ubif-update-today-board"></section>', { url: 'https://portal.ubreakifix.net/repair/workorders', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window, root = w.document.querySelector('section').attachShadow({ mode: 'open' });
  root.innerHTML = '<dialog open data-workorder-id="301" data-message-request="request-1"></dialog>';
  const dialog = root.querySelector('dialog'), calls = [], dispatched = [], replies = [];
  const state = { open: !!options.existing, chat: options.existing || {} };
  const module = {
    store: { getState: () => state, subscribe() {}, dispatch(action) { dispatched.push(action); if (action.type === 'data') state.chat = action.payload; else state.open = action.payload; } },
    selectChatPanelData: s => s.chat, selectChatPanelOpen: s => s.open,
    setChatPanelData: payload => ({ type: 'data', payload }), setChatPanelOpen: payload => ({ type: 'open', payload })
  };
  w.System = { resolve: name => name, get: () => module };
  w.fetch = async (path, init) => {
    calls.push([path, init?.method || 'GET']);
    if (options.fetch) return options.fetch(path);
    return { ok: true, json: async () => path.startsWith('/api/workorder/')
      ? { workorder: { workorderId: 301, CustomerDevice: { customerId: 81 } } }
      : { customer: { fullName: 'Test Customer', primaryPhoneNumber: '5550100000', canSms: 0, canCall: 1 }, workorders: [{ workorderId: 301, deviceName: 'Test device' }] } };
  };
  w.addEventListener('message', event => { if (event.data?.type === 'board-chat-result') replies.push(event.data); });
  w.eval(adapter);
  const launch = () => w.dispatchEvent(new w.MessageEvent('message', { source: w, data: { source: 'ubif-plus', type: 'board-chat-open', workorderId: '301', requestId: 'request-1' } }));
  return { w, dialog, launch, calls, dispatched, replies };
}
test('Update Today opens native messages using verified order/customer and preserves SMS preference', async t => {
  const b = boot(t); b.launch(); await tick();
  assert.deepEqual(b.calls.map(c => c[0]), ['/api/workorder/301', '/api/customer/recent-jobs/81']);
  assert.ok(b.calls.every(c => c[1] === 'GET'), 'launch never sends a customer message');
  assert.equal(b.dispatched[0].payload.customerId, 81);
  assert.equal(b.dispatched[0].payload.workorderId, '301');
  assert.equal(b.dispatched[0].payload.canSms, 0);
  assert.equal(b.dispatched[0].payload.recentJobs[0].jobType, 'workorder');
  assert.equal(b.dispatched[1].payload, true);
  assert.equal(b.replies[0].error, '');
});
test('launch cannot replace a different open conversation or discard its draft', async t => {
  const b = boot(t, { existing: { customerId: 82, workorderId: '302' } });
  b.launch(); await tick();
  assert.equal(b.dispatched.length, 0);
  assert.match(b.replies[0].error, /Close the current/);
});
test('stale or closed editor requests cannot open messages', async t => {
  const b = boot(t);
  b.dialog.open = false; b.launch(); await tick();
  assert.equal(b.calls.length, 0);
  b.dialog.open = true; b.launch(); b.dialog.dataset.messageRequest = 'different'; await tick();
  assert.equal(b.dispatched.length, 0);
});
test('closing from the editor closes only the conversation it opened', async t => {
  const close = (b, workorderId) => b.w.dispatchEvent(new b.w.MessageEvent('message', { source: b.w, data: { source: 'ubif-plus', type: 'board-chat-close', workorderId } }));
  const other = boot(t, { existing: { customerId: 82, workorderId: '302' } });
  close(other, '301');
  assert.equal(other.dispatched.length, 0, 'another order’s conversation stays open');
  const own = boot(t, { existing: { customerId: 81, workorderId: '301' } });
  close(own, '301');
  assert.deepEqual(own.dispatched, [{ type: 'open', payload: false }]);
});
