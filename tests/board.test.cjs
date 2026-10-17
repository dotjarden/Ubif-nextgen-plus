const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const model = fs.readFileSync(`${__dirname}/../extension/board-model.js`, 'utf8');
const ui = fs.readFileSync(`${__dirname}/../extension/board.js`, 'utf8');
const context = vm.createContext({ Date, AbortController, setTimeout, clearTimeout, TypeError });
vm.runInContext(model, context);
const M = context.UBIFPlusBoard;
const copy = x => JSON.parse(JSON.stringify(x));
const base = () => ({ workorderId: 10001234, programId: 20001, workorderStatusId: 9, nextUpdate: '2026-10-08T16:00:00.000Z', updatedAt: '2026-10-08T10:00:00Z', CustomerDevice: { customerId: 42 } });
function server(overrides = {}) {
  let order = base(); const calls = []; const notes = [];
  async function fetch(path, options) {
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ path, method: options.method, body, credentials: options.credentials });
    let result;
    if (overrides.handle) result = await overrides.handle(path, options, body);
    if (result !== undefined) return result;
    if (path === '/api/workorders') result = { workOrders: [{ ...order, customer: { fullName: 'Taylor Reed' }, deviceCatalog: { name: 'Phone' } }], rowCount: 1 };
    else if (path === `/api/workorder/${order.workorderId}`) result = { workorder: order };
    else if (path.includes('/fields') || path.endsWith('/status')) { order = { ...order, ...body, updatedAt: new Date().toISOString() }; result = order; }
    else if (path.startsWith('/api/program-attributes/')) result = {};
    else if (path.includes('/workorder-audit-trail/')) result = [{ workorderStatusId: 9 }];
    else if (path.includes('/reset-audit-trail/')) result = [];
    else if (path === '/api/note') { notes.unshift({ ...body, noteId: notes.length + 1 }); result = notes[0]; }
    else if (path.startsWith('/api/note?')) result = { notes, total: notes.length };
    else throw new Error(`Unexpected URL ${path}`);
    return { ok: true, status: 200, json: async () => copy(result) };
  }
  return { fetch, calls, get order() { return copy(order); }, set order(value) { order = value; }, notes };
}
test('due queue includes overdue and all today, excludes tomorrow, closed and undated; optional tomorrow', () => {
  const now = new Date(2026, 9, 8, 10);
  const row = date => ({ workorderStatusId: 9, nextUpdate: date });
  assert.equal(M.due(row('2026-10-07T10:00'), now), true);
  assert.equal(M.due(row('2026-10-08T23:59'), now), true);
  assert.equal(M.due(row('2026-10-09T00:00'), now), false);
  assert.equal(M.due(row('2026-10-09T23:59'), now, true), true);
  assert.equal(M.due(row('2026-10-10T00:00'), now, true), false);
  assert.equal(M.due(row(''), now), false);
  assert.equal(M.due(row('bad'), now), false);
  assert.equal(M.due({ ...row('2026-10-08'), workorderStatusId: 15 }, now), false);
  assert.equal(M.due(row('2026-10-08'), now), true);
});
test('date/time round trips locally, supports later dates, and rejects invalid values', () => {
  assert.equal(M.localInput(M.toISO('2026-11-18T14:35')), '2026-11-18T14:35');
  assert.equal(M.nextDate(2, new Date(2026, 9, 31, 11)), '2026-11-02T11:00');
  assert.throws(() => M.toISO('2026-02-30T12:00'), /valid/);
  assert.throws(() => M.toISO(''), /Choose/);
});
test('loads every page and rejects repeated or incomplete pagination', async () => {
  const calls = [];
  const api = M.createAPI(async (_, options) => {
    const body = JSON.parse(options.body); calls.push(body);
    return { ok: true, json: async () => ({ workOrders: [{ ...base(), workorderId: body.page }], rowCount: 3 }) };
  });
  assert.equal((await api.list()).length, 3);
  assert.deepEqual(calls.map(c => c.page), [1, 2, 3]);
  assert.equal(calls[0].isCrossStoreSearch, false);
  assert.equal(calls[0].primaryFilter, 'Active');
  const broken = M.createAPI(async () => ({ ok: true, json: async () => ({ workOrders: [base()], rowCount: 3 }) }));
  await assert.rejects(broken.list(), /pagination/);
});
test('reschedules without any status change and verifies date persisted', async () => {
  const s = server(); const api = M.createAPI(s.fetch);
  const saved = await api.schedule(s.order, '2026-12-01T14:30');
  assert.equal(saved.workorderStatusId, 9);
  assert.equal(M.localInput(saved.nextUpdate), '2026-12-01T14:30');
  assert.deepEqual(s.calls.map(c => c.method), ['GET', 'PATCH', 'GET']);
  assert.deepEqual(Object.keys(s.calls[1].body).sort(), ['nextUpdate', 'workorderId']);
  assert(s.calls.every(c => c.credentials === 'same-origin'));
});
test('stale order prevents all writes', async () => {
  const s = server(); const snapshot = s.order; s.order = { ...snapshot, workorderStatusId: 10 };
  await assert.rejects(M.createAPI(s.fetch).schedule(snapshot, '2026-10-20T12:00'), /changed in Portal/);
  assert.equal(s.calls.filter(c => c.method !== 'GET').length, 0);
});
test('manual move saves status, resets completed audit steps, and attaches note to correct order', async () => {
  const s = server(); const api = M.createAPI(s.fetch);
  const saved = await api.move(s.order, 3, '2026-10-20T12:00', 'Part arrives on October 20.');
  assert.equal(saved.workorderStatusId, 3);
  assert.deepEqual(s.calls.filter(c => c.method !== 'GET').map(c => c.path), ['/api/workorder/10001234/status', '/api/workorder/reset-audit-trail/10001234', '/api/note']);
  assert.equal(s.notes[0].customerId, 42); assert.equal(s.notes[0].workorderId, 10001234);
  assert.equal(s.notes[0].noteTag, 'awaiting_item'); assert.equal(s.notes[0].noteType, 2);
});
test('native workflow transitions and invalid note are rejected before writing', async () => {
  const s = server(); const api = M.createAPI(s.fetch);
  await assert.rejects(api.move(s.order, 13, '2026-10-20T12:00', 'Ready'), /native Portal/);
  await assert.rejects(api.move(s.order, 3, '2026-10-20T12:00', ''), /10 non-space/);
  assert.equal(s.calls.filter(c => c.method !== 'GET').length, 0);
  assert.equal(M.canMove(13, 8), false); assert.equal(M.canMove(12, 3), false);
});
test('partial move failure is explicit and does not retry or falsely roll status back', async () => {
  const s = server({ handle: async path => path === '/api/note' ? { ok: false, status: 500, json: async () => ({}) } : undefined });
  await assert.rejects(M.createAPI(s.fetch).move(s.order, 3, '2026-10-20T12:00', 'Parts ordered.'), /Status was saved.*follow-up/);
  assert.equal(s.order.workorderStatusId, 3); assert.equal(s.calls.filter(c => c.path === '/api/note').length, 1);
});
test('note writes and reads round trip; cross-order notes fail closed', async () => {
  const s = server(); const api = M.createAPI(s.fetch);
  await api.addNote(s.order, '<img src=x onerror=alert(1)>');
  assert.equal((await api.notes(10001234))[0].noteText, '<img src=x onerror=alert(1)>');
  s.notes[0].workorderId = 99999999;
  await assert.rejects(api.notes(10001234), /unexpected notes/);
});
test('authentication errors are actionable; no retries for an uncertain write', async () => {
  const s = server({ handle: async (path, options) => {
    if (options.method === 'PATCH') throw new TypeError('offline');
  } });
  await assert.rejects(M.createAPI(s.fetch).schedule(s.order, '2026-10-20T12:00'), /outcome is unknown/);
  assert.equal(s.calls.filter(c => c.method === 'PATCH').length, 1);
  const api = M.createAPI(async () => ({ ok: false, status: 403, json: async () => ({}) }));
  await assert.rejects(api.list(), /session or permissions/);
});
const flush = () => new Promise(r => setTimeout(r, 30));
async function boot(t, overrides = {}) {
  const dom = new JSDOM('<!doctype html><main><h1>Workorders</h1><nav role="tablist"><button role="tab" aria-selected="true">All</button><button role="tab">Ready for pickup</button></nav><div id="filters">Native filters</div><section id="table"><table><thead><tr><th data-column-id="woId">WO</th></tr></thead></table></section></main>', { url: 'https://portal.ubreakifix.net/repair/workorders', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const w = dom.window; const s = server(overrides); s.order = { ...s.order, nextUpdate: '2020-01-01T12:00:00Z' };
  w.fetch = s.fetch;
  if (overrides.settings) w.UBIFPlusSettings = overrides.settings;
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.show = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  w.eval(model); w.eval(ui); await flush();
  return { w, s, root: w.document.querySelector('#ubif-update-today-board') };
}
test('tab is last beside Ready for pickup, toggles board and restores native DOM without duplicate mounting', async t => {
  const { w } = await boot(t); const d = w.document;
  assert.equal(d.querySelector('[role=tablist]').lastElementChild.textContent, 'Update Today');
  const table = d.querySelector('table'); d.querySelector('#ubif-update-today-tab').click(); await flush();
  const root = d.querySelector('#ubif-update-today-board');
  assert.equal(root.hidden, false); assert.equal(root.shadowRoot.querySelectorAll('.card').length, 1);
  assert.equal(d.querySelector('#filters').hasAttribute('data-ubif-board-hidden'), true);
  w.eval(ui); assert.equal(d.querySelectorAll('#ubif-update-today-tab').length, 1);
  d.querySelector('[role=tab]').click(); await flush();
  assert.equal(root.hidden, true); assert.equal(d.querySelectorAll('[data-ubif-board-hidden]').length, 0); assert.equal(d.querySelector('table'), table);
  w.history.pushState({}, '', '/check-in/arrivals'); await new Promise(r => setTimeout(r, 450));
  assert.equal(d.querySelector('#ubif-update-today-tab'), null);
});
test('card keyboard action loads its notes safely and saves update without changing status', async t => {
  const { w, s } = await boot(t); s.notes.push({ noteId: 1, workorderId: 10001234, noteText: '<script>bad()</script>', noteType: 2 });
  w.document.querySelector('#ubif-update-today-tab').click(); await flush();
  const root = w.document.querySelector('#ubif-update-today-board').shadowRoot;
  root.querySelector('.card button').click(); await flush();
  assert.equal(root.querySelector('dialog').open, true);
  assert.equal(root.querySelector('.notes script'), null); assert.match(root.querySelector('.notes').textContent, /<script>/);
  root.querySelector('[type=datetime-local]').value = '2026-12-01T15:20';
  [...root.querySelectorAll('button')].find(n => n.textContent === 'Save update time').click(); await flush();
  assert.equal(s.order.workorderStatusId, 9); assert.equal(M.localInput(s.order.nextUpdate), '2026-12-01T15:20');
  assert.match(root.querySelector('dialog [role=status]').textContent, /saved/);
});
test('failed list refresh keeps previously loaded board and shows error', async t => {
  const { w, s } = await boot(t);
  w.document.querySelector('#ubif-update-today-tab').click(); await flush();
  const root = w.document.querySelector('#ubif-update-today-board').shadowRoot;
  s.order = { ...s.order, workorderId: 0 };
  [...root.querySelectorAll('button')].find(n => n.textContent === 'Refresh').click(); await flush();
  assert.equal(root.querySelectorAll('.card').length, 1); assert.match(root.querySelector('.status').textContent, /last sync/);
});

test('ISP workflow is blocked before a manual override', async () => {
  const s = server({ handle: async path => path.startsWith('/api/program-attributes/') ? { ok: true, json: async () => ({ UseISP: true }) } : undefined });
  await assert.rejects(M.createAPI(s.fetch).move(s.order, 3, '2026-10-20T12:00', 'Part ordered.'), /native Portal workflow/);
  assert.equal(s.calls.filter(c => c.method !== 'GET').length, 0);
});

test('dragging stages a move without a write; saving is explicit', async t => {
  const { w, s } = await boot(t);
  w.document.querySelector('#ubif-update-today-tab').click(); await flush();
  const root = w.document.querySelector('#ubif-update-today-board').shadowRoot;
  const dataTransfer = { setData() {}, effectAllowed: '', dropEffect: '' };
  function drag(node, type) { const event = new w.Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(event, 'dataTransfer', { value: dataTransfer }); node.dispatchEvent(event); }
  drag(root.querySelector('.card'), 'dragstart'); drag(root.querySelector('[data-status="3"]'), 'dragover'); drag(root.querySelector('[data-status="3"]'), 'drop'); await flush();
  assert.equal(root.querySelector('dialog').open, true);
  assert.equal(root.querySelector('select').value, '3');
  assert.equal(s.calls.some(c => ['PATCH', 'PUT'].includes(c.method)), false);
});

test('unknown note outcome blocks duplicate save until explicit order/notes refresh', async t => {
  const { w } = await boot(t, { handle: async (path, options) => {
    if (path === '/api/note' && options.method === 'POST') { const error = new Error('timeout'); error.name = 'AbortError'; throw error; }
  } });
  w.document.querySelector('#ubif-update-today-tab').click(); await flush();
  const root = w.document.querySelector('#ubif-update-today-board').shadowRoot;
  root.querySelector('.card button').click(); await flush();
  const buttons = text => [...root.querySelectorAll('button')].find(n => n.textContent === text);
  root.querySelector('[aria-label="New work order note"]').value = 'A fictional test note.';
  buttons('Add note to Portal').click(); await flush();
  assert.equal(buttons('Add note to Portal').disabled, true);
  assert.match(root.querySelector('dialog [role=status]').textContent, /outcome is unknown/);
  root.querySelector('[aria-label="Refresh order / notes"]').click(); await flush();
  assert.equal(buttons('Add note to Portal').disabled, false);
  assert.equal(root.querySelector('[aria-label="New work order note"]').value, 'A fictional test note.');
});

test('modal retains order context and stages one scheduling action without writing', async t => {
  const { w, s } = await boot(t);
  w.document.querySelector('#ubif-update-today-tab').click(); await flush();
  const root = w.document.querySelector('#ubif-update-today-board').shadowRoot;
  root.querySelector('.card button').click(); await flush();
  assert.equal(root.querySelector('#ubif-board-order-title').textContent, 'Taylor Reed');
  assert.match(root.querySelector('#ubif-board-order-context').textContent, /10001234/);
  assert.equal(root.querySelector('.order-device').textContent, 'Phone');
  const actions = root.querySelector('.schedule-actions');
  const shown = () => [...actions.querySelectorAll('button')].filter(n => !n.classList.contains('hidden')).map(n => n.textContent);
  assert.deepEqual(shown(), ['Save update time']);
  const select = root.querySelector('[aria-label="Move to status"]');
  const reason = root.querySelector('[aria-label="Reason for status change"]');
  select.value = '3'; select.dispatchEvent(new w.Event('change'));
  assert.deepEqual(shown(), ['Save status + update time']);
  assert.equal(reason.closest('label').classList.contains('hidden'), false);
  reason.value = 'Parts arrive next week.';
  select.value = ''; select.dispatchEvent(new w.Event('change'));
  assert.deepEqual(shown(), ['Save update time']);
  assert.equal(reason.closest('label').classList.contains('hidden'), true);
  select.value = '3'; select.dispatchEvent(new w.Event('change'));
  assert.equal(reason.value, 'Parts arrive next week.');
  assert.equal(s.calls.some(c => ['POST', 'PATCH', 'PUT'].includes(c.method) && c.path !== '/api/workorders'), false);
});

test('quick-date selection clears on manual edit and refresh without losing note drafts', async t => {
  const { w } = await boot(t);
  w.document.querySelector('#ubif-update-today-tab').click(); await flush();
  const root = w.document.querySelector('#ubif-update-today-board').shadowRoot;
  root.querySelector('.card button').click(); await flush();
  const date = root.querySelector('[type=datetime-local]');
  const chip = root.querySelector('.chips button');
  chip.click();
  assert.equal(chip.getAttribute('aria-pressed'), 'true');
  assert.equal(date.value, M.nextDate(1));
  date.value = '2026-12-01T15:20'; date.dispatchEvent(new w.Event('input'));
  assert.equal(chip.getAttribute('aria-pressed'), 'false');
  chip.click();
  root.querySelector('[aria-label="New work order note"]').value = 'Keep this unsent note.';
  root.querySelector('[aria-label="Refresh order / notes"]').click(); await flush();
  assert.equal(chip.getAttribute('aria-pressed'), 'false');
  assert.equal(root.querySelector('[aria-label="New work order note"]').value, 'Keep this unsent note.');
});

test('messages keep Update Today drafts intact and return to the modal when native chat closes', async t => {
  const { w } = await boot(t);
  w.document.querySelector('#ubif-update-today-tab').click(); await flush();
  const root = w.document.querySelector('#ubif-update-today-board').shadowRoot;
  root.querySelector('.card button').click(); await flush();
  const note = root.querySelector('[aria-label="New work order note"]'); note.value = 'Unsent board draft';
  const dialog = root.querySelector('dialog');
  root.querySelector('[aria-label="View and send customer messages"]').click();
  const send = data => w.dispatchEvent(new w.MessageEvent('message', { source: w, data: { source: 'ubif-plus', ...data } }));
  send({ type: 'board-chat-result', requestId: dialog.dataset.messageRequest, error: '' });
  assert.equal(dialog.dataset.messaging, 'true');
  assert.equal(note.value, 'Unsent board draft');
  send({ type: 'message-context', open: false });
  assert.equal(dialog.dataset.messaging, undefined);
  assert.equal(dialog.open, true);
  assert.equal(note.value, 'Unsent board draft');
});

test('Include tomorrow saves through shared settings and restores on load', async t => {
  const writes = [];
  const settings = { get: async () => ({ board: true, boardIncludeTomorrow: true }), subscribe() {}, set: async patch => writes.push(patch) };
  const { w } = await boot(t, { settings });
  w.document.querySelector('#ubif-update-today-tab').click(); await flush();
  const root = w.document.querySelector('#ubif-update-today-board');
  const checkbox = root.shadowRoot.querySelector('.toolbar input[type=checkbox]');
  assert.equal(checkbox.checked, true);
  checkbox.click(); await flush();
  assert.equal(writes[0].boardIncludeTomorrow, false);
});

test('cards show overdue times in the error colour, open from anywhere, and empty statuses become drop targets', async t => {
  const { w } = await boot(t);
  w.document.querySelector('#ubif-update-today-tab').click(); await flush();
  const root = w.document.querySelector('#ubif-update-today-board').shadowRoot;
  const card = root.querySelector('.card');
  assert.equal(card.querySelector('.badge'), null, 'no redundant Overdue label on a board of due orders');
  assert.equal(card.querySelector('.due').classList.contains('overdue'), true);
  assert.match(root.querySelector('.status').textContent, /^1 order · Synced/);
  const strip = root.querySelector('.empty-lanes');
  assert.ok(strip.querySelector('.lane[data-status="2"][data-target]'), 'empty droppable statuses sit above the board');
  assert.equal(root.querySelector('.lanes .lane[data-empty]'), null, 'the board itself only holds statuses with orders');
  card.querySelector('.customer').click(); await flush();
  assert.equal(root.querySelector('dialog').open, true);
});

test('an overdue update time is suggested forward and notes show their links', async t => {
  const { w, s } = await boot(t);
  s.notes.push({ noteId: 1, workorderId: 10001234, noteType: 2, noteText: 'please check the original [work order](https://portal.ubif.net/pos/workorder/30190129) or javascript:alert(1)' });
  w.document.querySelector('#ubif-update-today-tab').click(); await flush();
  const root = w.document.querySelector('#ubif-update-today-board').shadowRoot;
  root.querySelector('.card button').click(); await flush();
  const date = root.querySelector('[type=datetime-local]');
  assert.ok(date.value > M.localInput(new Date()), 'the 2020 time is not offered again');
  assert.match(root.querySelector('.date-hint').textContent, /^Was due/);
  assert.equal([...root.querySelectorAll('.chips button')].find(n => n.textContent === 'In 2 days').getAttribute('aria-pressed'), 'true');
  const links = [...root.querySelectorAll('.notes a')];
  assert.deepEqual(links.map(a => [a.textContent, a.getAttribute('href'), a.target]), [['work order', 'https://portal.ubif.net/pos/workorder/30190129', '_blank']]);
  assert.match(root.querySelector('.notes').textContent, /javascript:alert\(1\)/, 'other text stays plain');
  assert.equal(root.activeElement, root.querySelector('#ubif-board-order-title'), 'focus starts on the title, not Close');
});

test('Cmd/Ctrl+Enter adds the note being written', async t => {
  const { w, s } = await boot(t);
  w.document.querySelector('#ubif-update-today-tab').click(); await flush();
  const root = w.document.querySelector('#ubif-update-today-board').shadowRoot;
  root.querySelector('.card button').click(); await flush();
  const note = root.querySelector('[aria-label="New work order note"]');
  note.value = 'Called customer about the parts ETA';
  note.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }));
  await flush();
  assert.equal(s.notes[0].noteText, 'Called customer about the parts ETA');
});

test('Messages toggles Portal conversation and closing the editor closes it too', async t => {
  const { w } = await boot(t);
  w.document.querySelector('#ubif-update-today-tab').click(); await flush();
  const root = w.document.querySelector('#ubif-update-today-board').shadowRoot;
  root.querySelector('.card button').click(); await flush();
  const posted = [];
  w.addEventListener('message', event => { if (event.data?.source === 'ubif-plus') posted.push(event.data); });
  const send = data => w.dispatchEvent(new w.MessageEvent('message', { source: w, data: { source: 'ubif-plus', ...data } }));
  const dialog = root.querySelector('dialog');
  const button = root.querySelector('[aria-label="View and send customer messages"]');
  button.click();
  send({ type: 'board-chat-result', requestId: dialog.dataset.messageRequest, error: '' });
  assert.equal(button.textContent, 'Hide messages');
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  button.click(); await flush();
  assert.deepEqual(posted.filter(p => p.type === 'board-chat-close').map(p => p.workorderId), ['10001234']);
  send({ type: 'message-context', open: false });
  assert.equal(button.textContent, 'Messages');
  // Reopen, then close the editor: its conversation goes with it.
  button.click();
  send({ type: 'board-chat-result', requestId: dialog.dataset.messageRequest, error: '' });
  root.querySelector('.close').click(); await flush();
  assert.equal(posted.filter(p => p.type === 'board-chat-close').length, 2);
  assert.equal(dialog.open, false);
});

test('notes kept on the order’s arrival or customer load with the order’s own notes', async () => {
  const s = server(); const api = M.createAPI(s.fetch);
  await api.addNote(s.order, 'Order note text');
  s.notes.push({ noteId: 77, workorderId: null, arrivalId: 5, noteType: 1, noteText: 'Arrival note' });
  const rows = await api.notes(10001234);
  assert.deepEqual(copy(rows.map(r => r.noteText)), ['Order note text', 'Arrival note']);
  s.notes.push({ noteId: 78, workorderId: 99999999, noteType: 2, noteText: 'Other order' });
  await assert.rejects(api.notes(10001234), /unexpected notes/, 'another order’s note still fails closed');
});

test('status and next update sit in the header, and saving shows on the button instead of a message bar', async t => {
  const { w } = await boot(t);
  w.document.querySelector('#ubif-update-today-tab').click(); await flush();
  const root = w.document.querySelector('#ubif-update-today-board').shadowRoot;
  root.querySelector('.card button').click(); await flush();
  const meta = root.querySelector('.dialog-head .head-meta');
  assert.match(meta.textContent, /Next update/);
  assert.equal(root.querySelector('.order-meta'), null, 'no separate status band');
  assert.equal(root.querySelector('.feedback').textContent, '', 'the bar stays empty without a problem');
  const save = [...root.querySelectorAll('button')].find(n => n.textContent === 'Save update time');
  save.click();
  assert.equal(save.classList.contains('busy'), true);
  assert.equal(save.textContent, 'Saving…');
  assert.equal(root.querySelector('.feedback').textContent, '');
  await flush();
  assert.equal(save.textContent, 'Saved');
  assert.equal(save.classList.contains('done'), true);
  assert.match(root.querySelector('dialog [role=status]').textContent, /saved/, 'still announced to screen readers');
});
