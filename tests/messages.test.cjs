const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const read = name => fs.readFileSync(`${__dirname}/../extension/${name}`, 'utf8');
const KEY = 'ubif-plus.message-templates.v1';
const flush = w => new Promise(resolve => w.setTimeout(resolve, 30));
function boot(t, options = {}) {
  const dom = new JSDOM(options.html || '<body><aside data-message-sidebar><h2>Messages</h2><textarea aria-label="Message"></textarea><button id="send">Send</button></aside></body>', {
    url: options.url || 'https://portal.ubreakifix.net/repair/workorder/301', runScripts: 'outside-only', pretendToBeVisual: true
  });
  t.after(() => { dom.window.dispatchEvent(new dom.window.Event('pagehide')); dom.window.close(); });
  const w = dom.window, writes = [], calls = [];
  w.chrome = { storage: { local: {
    get: async () => ({ [KEY]: options.templates, 'ubif-plus.rt-templates.v1': options.seeded !== false }),
    set: async value => { if (options.failSave) throw new Error('failed'); writes.push(JSON.parse(JSON.stringify(value))); }
  } } };
  w.fetch = async url => {
    calls.push(url);
    if (url.endsWith('/arrival')) return { ok: !!options.arrival, json: async () => options.arrival };
    if (options.fetch) return options.fetch(url);
    return { ok: true, json: async () => ({ workorder: {
      workorderId: Number(url.split('/').pop()), customer: { fullName: 'Alex Smith', primaryEmail: 'alex@example.test' },
      customerDevice: { deviceName: 'Pixel 9' }, workorderStatusName: 'Ready for pickup', appointment: '2026-10-12T14:00:00Z'
    } }) };
  };
  if (options.settings) w.UBIFPlusSettings = options.settings;
  w.eval(read('message-model.js')); w.eval(read('message-ui.js')); w.eval(read('messages.js'));
  const root = () => w.document.querySelector('[data-ubif-message-templates]')?.shadowRoot;
  const click = label => { const node = [...root().querySelectorAll('button')].find(n => n.textContent === label); assert.ok(node, label); node.click(); };
  const choose = id => {
    const row = w.UBIFPlusMessageModel.sanitize(options.templates).find(t => t.id === id) || writes.at(-1)?.[KEY].find(t => t.id === id);
    assert.ok(row, id);
    let node = root().querySelector(`[aria-label="Use ${row.name}"]`);
    if (!node) { click('Templates'); node = root().querySelector(`[aria-label="Use ${row.name}"]`); }
    node.click();
  };
  return { w, root, click, choose, writes, calls };
}
test('renders real fields, fallbacks, blanks and invalid placeholders without recursive substitution', t => {
  const { w } = boot(t), M = w.UBIFPlusMessageModel;
  const values = M.data({ customer: { fullName: 'Sam Reed', email: 'sam@example.test' }, customerDevice: { deviceName: 'iPhone' }, workorderId: 301 });
  assert.equal(values['customer.firstName'], 'Sam');
  assert.equal(values['device.name'], 'iPhone');
  const result = M.render('Hi {{customer.firstName|there}}: {{device.model|your device}} {{appointment.date}}', values);
  assert.equal(result.text, 'Hi Sam: your device ');
  assert.deepEqual(Array.from(result.missing), ['device.model', 'appointment.date']);
  assert.equal(M.render('{{customer.name}}', { 'customer.name': '{{device.name}}' }).text, '{{device.name}}');
  assert.deepEqual(Array.from(M.render('{{secret}} {{device.name').unknown), ['secret', 'Invalid placeholder']);
  assert.equal(M.data({ appointment: { date: '2026-10-12T14:00:00Z' } })['appointment.date'].length > 0, true);
  assert.equal(M.data({})['appointment.date'], '');
});
test('compact shortcuts fill the native composer without sending or saving customer data', async t => {
  const { w, root, choose, writes, calls } = boot(t); await flush(w);
  assert.ok(root().querySelector('#template-workspace').hidden);
  assert.equal(root().querySelectorAll('.shortcut').length, 2);
  assert.equal(root().querySelector('textarea'), null, 'no duplicate message box');
  let inputs = 0, sends = 0;
  w.document.querySelector('aside > textarea').addEventListener('input', () => inputs++);
  w.document.querySelector('#send').onclick = () => sends++;
  choose('pickup'); assert.match(w.document.querySelector('aside > textarea').value, /Alex.*Pixel 9/);
  assert.equal(inputs, 1); assert.equal(sends, 0); assert.equal(writes.length, 0);
  assert.deepEqual(calls, ['/api/workorder/301', '/api/workorder/301/arrival']);
});
test('existing drafts are preserved until Add or Replace is chosen', async t => {
  const { w, root, click, choose } = boot(t); await flush(w);
  const input = w.document.querySelector('aside > textarea'); input.value = 'Existing draft';
  choose('pickup'); assert.equal(input.value, 'Existing draft'); click('Add to draft');
  assert.match(input.value, /^Existing draft\n\nHi Alex/);
  choose('pickup'); click('Replace draft'); assert.match(input.value, /^Hi Alex/);
  assert.doesNotMatch(input.value, /Existing draft/); assert.equal(root().querySelector('#template-workspace').hidden, true);
});
test('visual editor saves reusable chips, custom alternate text, edits, copies and restores deletion', async t => {
  const { w, root, click, writes } = boot(t); await flush(w); click('Templates'); click('+ New template');
  root().querySelector('#template-name').value = 'Custom';
  root().querySelector('#template-body').textContent = 'Hello '; click('+ First name');
  const token = root().querySelector('[data-field="customer.firstName"]'); assert.equal(token.textContent, 'First name');
  assert.doesNotMatch(root().querySelector('#template-body').textContent, /customer.firstName|\{\{/);
  token.click(); root().querySelector('#field-fallback').value = 'friend'; click('Done'); click('Save template'); await flush(w);
  const saved = writes[0][KEY].find(t => t.name === 'Custom'); assert.equal(saved.body, 'Hello {{customer.firstName|friend}}');
  assert.doesNotMatch(JSON.stringify(writes), /Alex|Pixel|example.test/);
  root().querySelector('[aria-label="Edit Custom"]').click();
  root().querySelector('#template-body').textContent = 'Updated '; click('+ Device'); click('Save template'); await flush(w);
  root().querySelector('[aria-label="Use Custom"]').click(); assert.equal(w.document.querySelector('aside > textarea').value, 'Updated Pixel 9');
  click('Templates'); root().querySelector('[aria-label="Edit Custom"]').click(); click('Make a copy');
  assert.equal(root().querySelector('#template-name').value, 'Custom copy'); click('Save template'); await flush(w);
  root().querySelector('[aria-label="Edit Custom"]').click(); click('Delete template'); await flush(w);
  assert.equal(writes.at(-1)[KEY].some(t => t.id === saved.id), false); click('Undo'); await flush(w);
  assert.equal(writes.at(-1)[KEY].some(t => t.id === saved.id), true);
  const restored = boot(t, { templates: writes.at(-1)[KEY] }); await flush(restored.w);
  restored.choose(saved.id); assert.equal(restored.w.document.querySelector('aside > textarea').value, 'Updated Pixel 9');
});
test('missing data uses alternate text and asks for required details only at use time', async t => {
  const { w, root, click, choose } = boot(t, { fetch: async () => ({ ok: false }) }); await flush(w);
  choose('pickup'); assert.match(w.document.querySelector('aside > textarea').value, /Hi there, your device/);
  w.document.querySelector('aside > textarea').value = ''; choose('appointment');
  assert.equal(w.document.querySelector('aside > textarea').value, '');
  click('Use template'); assert.match(root().querySelector('[role=status]').textContent, /Add the missing/);
  const input = root().querySelector('[data-missing-field="appointment.date"]'); input.value = 'Tomorrow at 10 AM'; input.dispatchEvent(new w.Event('input'));
  click('Use template'); assert.match(w.document.querySelector('aside > textarea').value, /Tomorrow at 10 AM/);
});
test('failed saves keep visual edits and invalid details are blocked', async t => {
  const { w, root, click } = boot(t, { failSave: true }); await flush(w); click('Templates'); click('+ New template');
  root().querySelector('#template-name').value = 'Retry'; root().querySelector('#template-body').textContent = '{{unknown}}';
  click('Save template'); assert.match(root().querySelector('[role=status]').textContent, /unrecognized/);
  root().querySelector('#template-body').textContent = 'Hello'; click('Save template'); await flush(w);
  assert.equal(root().querySelector('#template-body').textContent, 'Hello'); assert.match(root().querySelector('[role=status]').textContent, /Couldn’t save/);
});
test('detail chips insert at the caret, replace selected text and leave the caret after the chip', async t => {
  const { w, root, click, writes } = boot(t); await flush(w); click('Templates'); click('+ New template');
  root().querySelector('#template-name').value = 'Cursor insertion';
  const editor = root().querySelector('#template-body'); editor.textContent = 'Hello , your device is ready.';
  let range = w.document.createRange(); range.setStart(editor.firstChild, 6); range.collapse(true);
  root().getSelection = () => ({ rangeCount: 1, getRangeAt: () => range, removeAllRanges() {}, addRange: r => { range = r; } });
  editor.dispatchEvent(new w.Event('keyup'));
  const firstName = root().querySelector('[aria-label="Add First name"]');
  firstName.dispatchEvent(new w.Event('pointerdown', { cancelable: true })); firstName.click();
  assert.equal(editor.querySelector('[data-field]').nextSibling, range.startContainer);
  assert.equal(range.startOffset, 1, 'caret sits immediately after the chip');
  const suffix = editor.lastChild;
  range = w.document.createRange(); range.setStart(suffix, 7); range.setEnd(suffix, 13);
  editor.dispatchEvent(new w.Event('keyup')); click('+ Device'); click('Save template'); await flush(w);
  assert.equal(writes[0][KEY].at(-1).body, 'Hello {{customer.firstName|there}}, your {{device.name|your device}} is ready.');
});
test('shadow-tree caret survives clicking out before choosing a detail in Chrome', async t => {
  const { w, root, click, writes } = boot(t); await flush(w); click('Templates'); click('+ New template');
  const name = root().querySelector('#template-name'); name.value = 'Shadow caret';
  const editor = root().querySelector('#template-body'); editor.textContent = 'Hello , your repair is ready.';
  const hostRange = w.document.createRange(); hostRange.selectNode(root().host);
  let composed = [{ startContainer: editor.firstChild, startOffset: 6, endContainer: editor.firstChild, endOffset: 6 }];
  let restored;
  root().getSelection = undefined;
  w.document.getSelection = () => ({
    rangeCount: 1, getRangeAt: () => hostRange,
    getComposedRanges: options => { assert.equal(options.shadowRoots[0], root()); return composed; },
    removeAllRanges() {}, addRange: range => { restored = range.cloneRange(); }
  });
  editor.dispatchEvent(new w.Event('keyup'));
  // By the time blur fires the document selection may already be elsewhere.
  composed = []; name.focus(); editor.dispatchEvent(new w.Event('blur'));
  const chip = root().querySelector('[aria-label="Add First name"]');
  const down = new w.MouseEvent('mousedown', { cancelable: true });
  chip.dispatchEvent(down); assert.equal(down.defaultPrevented, true); chip.click();
  assert.equal(restored.startContainer, editor.querySelector('[data-field]').nextSibling);
  assert.equal(restored.startOffset, 1);
  click('Save template'); await flush(w);
  assert.equal(writes[0][KEY].at(-1).body, 'Hello {{customer.firstName|there}}, your repair is ready.');
});
test('composed selection replaces selected text and repeated details keep their position', async t => {
  const { w, root, click, writes } = boot(t); await flush(w); click('Templates'); click('+ New template');
  root().querySelector('#template-name').value = 'Selected detail';
  const editor = root().querySelector('#template-body'); editor.textContent = 'Your old device is ready.';
  let ranges = [{ startContainer: editor.firstChild, startOffset: 5, endContainer: editor.firstChild, endOffset: 15 }];
  root().getSelection = undefined;
  w.document.getSelection = () => ({
    rangeCount: 0, getComposedRanges: () => ranges,
    removeAllRanges() {}, addRange: range => { ranges = [range.cloneRange()]; }
  });
  // Direct activation captures the current selection before focus changes.
  click('+ Device'); ranges = []; root().querySelector('#template-name').focus(); click('+ Work order number');
  click('Save template'); await flush(w);
  assert.equal(writes[0][KEY].at(-1).body, 'Your {{device.name|your device}}{{workorder.number}} is ready.');
});
test('navigation rejects old responses and templates always use the selected order', async t => {
  const responses = {};
  const { w, root, choose, click } = boot(t, { fetch: url => new Promise(resolve => responses[url] = resolve) }); await flush(w);
  choose('pickup'); assert.equal(w.document.querySelector('aside > textarea').value, '');
  assert.match(root().querySelector('[role=status]').textContent, /Loading customer details/);
  responses['/api/workorder/301']({ ok: true, json: async () => ({ workorder: { workorderId: 301, customer: { fullName: 'First Customer' } } }) }); await flush(w);
  assert.match(w.document.querySelector('aside > textarea').value, /Hi First/);
  w.document.querySelector('aside > textarea').value = '';
  w.history.pushState({}, '', '/repair/workorder/302'); choose('pickup'); await flush(w);
  assert.equal(w.document.querySelector('aside > textarea').value, '');
  w.history.pushState({}, '', '/repair/workorder/303'); w.dispatchEvent(new w.Event('popstate')); await flush(w);
  responses['/api/workorder/302']({ ok: true, json: async () => ({ workorder: { workorderId: 302, customer: { fullName: 'Wrong Customer' } } }) });
  responses['/api/workorder/303']({ ok: true, json: async () => ({ workorder: { workorderId: 303, customer: { fullName: 'Correct Customer' } } }) }); await flush(w);
  choose('pickup'); assert.match(w.document.querySelector('aside > textarea').value, /Correct/); assert.doesNotMatch(w.document.querySelector('aside > textarea').value, /Wrong/);
});
test('unrelated sidebar and support widget composers are not enhanced', async t => {
  const { w, root } = boot(t); await flush(w);
  w.document.querySelector('aside').removeAttribute('data-message-sidebar'); w.document.querySelector('h2').textContent = 'Notes'; await flush(w);
  assert.equal(root(), undefined);
});
const nativeHTML = '<body><div id="native-chat"><header><span>Arrival Customer</span></header><div class="chat-panel-job-list"></div><form><div><textarea></textarea><button aria-label="Send message" type="submit">Send</button></div></form></div></body>';
const publish = (w, data) => w.dispatchEvent(new w.MessageEvent('message', { source: w, data: { source: 'ubif-plus', type: 'message-context', ...data } }));
test('actual shared React ChatPanel markup mounts without a Messages title and uses Arrivals data', async t => {
  const { w, root, calls, click, choose } = boot(t, { html: nativeHTML, url: 'https://portal.ubreakifix.net/check-in/arrivals' });
  publish(w, { open: true, customerId: '81', key: '81::arrival-1', record: { customer: { fullName: 'Arrival Customer', primaryEmail: 'arrival@example.test' }, customerDevice: { deviceName: 'Galaxy S25' }, appointment: 'Oct 12, 2026 at 10:00 AM' } });
  await flush(w); assert.ok(root(), 'real form structure is recognized'); choose('pickup');
  assert.match(w.document.querySelector('form textarea').value, /Arrival.*Galaxy S25/);
  assert.equal(w.document.querySelector('form').previousElementSibling.hasAttribute('data-ubif-message-templates'), true);
  assert.match(w.document.querySelector('form textarea').value, /Arrival.*Galaxy S25/);
  assert.deepEqual(calls, [], 'Arrivals does not request an unrelated work order');
  w.document.querySelector('form textarea').value = ''; choose('appointment'); assert.match(w.document.querySelector('form textarea').value, /Oct 12/);
  publish(w, { open: true, customerId: '82', key: '82::arrival-2', record: { customer: { fullName: 'Other Person' } } }); await flush(w);
  w.document.querySelector('form textarea').value = ''; choose('pickup'); assert.match(w.document.querySelector('form textarea').value, /Other/); assert.doesNotMatch(w.document.querySelector('form textarea').value, /Arrival|Oct 12/);
});
test('one template click resolves the workorder linked arrival automatically', async t => {
  let resolveOrder;
  const templates = [{ id: 'all', name: 'Appointment details', body: '{{customer.name}} / {{device.name}} / {{device.model}} / {{device.issues}} / {{appointment.date}} / {{customer.email}}' }];
  const { w, root, choose, calls } = boot(t, {
    templates,
    fetch: () => new Promise(resolve => { resolveOrder = resolve; }),
    arrival: { workorderId: 301, customer: { fullName: 'Alex Smith', primaryEmail: 'alex@example.test' }, customerDevice: { deviceName: 'Pixel 9', modelName: 'Pixel 9 Pro' }, deviceIssues: [{ name: 'Screen' }], appointment: '2026-10-12T14:00:00Z', store: { storeTimeZone: 'America/New_York' } }
  });
  await flush(w); choose('all');
  assert.equal(w.document.querySelector('aside > textarea').value, '');
  assert.equal(root().querySelector('[data-missing-field]'), null);
  resolveOrder({ ok: true, json: async () => ({ workorder: { workorderId: 301, CustomerDevice: { DeviceCatalog: { name: 'Pixel 9', DeviceModel: { modelNumber: 'Pixel 9 Pro' } }, CustomerDatum: { firstName: 'Alex', lastName: 'Smith' } } } }) });
  await flush(w);
  const draft = w.document.querySelector('aside > textarea').value;
  assert.match(draft, /Alex Smith \/ Pixel 9 \/ Pixel 9 Pro \/ Screen \/.*10:00 AM \/ alex@example.test/);
  assert.equal(root().querySelector('[data-missing-field]'), null);
  assert.deepEqual(calls, ['/api/workorder/301', '/api/workorder/301/arrival']);
});
test('linked arrival from a different workorder never supplies template details', async t => {
  const { w, root, choose } = boot(t, { fetch: async () => ({ ok: true, json: async () => ({ workorder: { workorderId: 301 } }) }), arrival: { workorderId: 999, appointment: '2026-10-12T14:00:00Z', customer: { fullName: 'Wrong Customer' } } });
  await flush(w); choose('appointment');
  assert.equal(w.document.querySelector('aside > textarea').value, '');
  assert.ok(root().querySelector('[data-missing-field="appointment.date"]'));
  assert.doesNotMatch(root().textContent, /Wrong Customer/);
});
test('customer contact details come from the selected workorder customer API', async t => {
  const templates = [{ id: 'contact', name: 'Contact', body: '{{customer.name}} / {{customer.phone}} / {{customer.email}}' }];
  const { w, choose, calls } = boot(t, { templates, fetch: async url => ({ ok: true, json: async () => url.startsWith('/api/customers/')
    ? { customerData: { customerId: 81, givenName: 'Alex', familyName: 'Smith' }, customer: { canSms: true }, primaryEmailAddress: 'alex@example.test', primaryPhoneNumber: '5550101' }
    : { workorder: { workorderId: 301, clientId: 2, CustomerDevice: { customerId: 81 } } } }) });
  await flush(w); choose('contact');
  assert.equal(w.document.querySelector('aside > textarea').value, 'Alex Smith / 5550101 / alex@example.test');
  assert.deepEqual(calls, ['/api/workorder/301', '/api/workorder/301/arrival', '/api/customers/81?clientId=2']);
});
test('late arrival context completes the original template click without asking again', async t => {
  const { w, root, choose } = boot(t, { html: nativeHTML, url: 'https://portal.ubreakifix.net/check-in/arrivals' });
  const customer = { fullName: 'Arrival Customer' };
  publish(w, { open: true, customerId: '81', key: '81::arrival-1', record: { customer } });
  await flush(w); choose('appointment');
  assert.ok(root().querySelector('[data-missing-field="appointment.date"]'));
  publish(w, { open: true, customerId: '81', key: '81::arrival-1', record: { customer, appointment: '2026-10-12T14:00:00Z' } });
  await flush(w);
  assert.equal(root().querySelector('[data-missing-field]'), null);
  assert.match(w.document.querySelector('form textarea').value, /Hi Arrival.*Oct 12/);
});
test('mounted arrival recovery reaches the native composer through the real bridge', async t => {
  const { w, root, choose } = boot(t, { html: nativeHTML.replace('<body>', '<body><div data-testid="customer-device-card" id="arrival-card"></div>'), url: 'https://portal.ubreakifix.net/check-in/arrivals' });
  // jsdom omits MessageEvent.source; reproduce the browser's same-window
  // postMessage contract so the content script's source guard stays active.
  w.postMessage = data => w.queueMicrotask(() => w.dispatchEvent(new w.MessageEvent('message', { source: w, data })));
  let listener;
  const state = { open: true, chat: { customerId: 81, customerName: 'Arrival Customer' } };
  w.System = { resolve: id => id, get: () => ({ store: { getState: () => state, subscribe: fn => { listener = fn; } }, selectChatPanelOpen: s => s.open, selectChatPanelData: s => s.chat }) };
  w.eval(read('messages-page.js')); await flush(w); choose('appointment');
  assert.ok(root().querySelector('[data-missing-field="appointment.date"]'));
  // React's card arrives after chat opened. No click is dispatched.
  w.document.querySelector('#arrival-card').__reactFiber$fixture = { memoizedProps: {}, return: { memoizedProps: {
    arrival: { arrivalId: 123, customer: { customerId: 81, fullName: 'Arrival Customer' }, customerDevice: { modelName: 'iPhone 16 Plus Black' }, appointment: '2026-10-12T17:00:00Z' }, store: { storeTimeZone: 'America/New_York' }
  } } };
  listener(); await flush(w);
  assert.equal(root().querySelector('[data-missing-field]'), null);
  assert.match(w.document.querySelector('form textarea').value, /Hi Arrival.*Oct 12.*1:00 PM/);
  assert.equal(root().querySelector('#template-workspace').hidden, true);
});
test('Portal-disabled SMS still offers template management but prevents insertion', async t => {
  const { w, root, click, choose } = boot(t, { html: nativeHTML.replace('<textarea>', '<textarea disabled readonly>') }); await flush(w);
  assert.ok(root()); choose('pickup');
  assert.equal(w.document.querySelector('form textarea').value, '');
  assert.match(root().querySelector('[role=status]').textContent, /Messaging is disabled/);
});
test('shared Workorders chat uses the selected chat order, not a different route order', async t => {
  const { w, root, choose, calls } = boot(t, { html: nativeHTML, fetch: async url => ({ ok: true, json: async () => ({ workorder: { workorderId: 401, CustomerDevice: { customerId: 81, DeviceCatalog: { name: 'iPhone 17' } } } }) }) });
  publish(w, { open: true, customerId: '81', key: '81:401:1', record: { workorderId: '401', customer: { fullName: 'Selected Customer' } } });
  await flush(w); choose('pickup'); assert.match(w.document.querySelector('form textarea').value, /Selected.*iPhone 17/);
  assert.deepEqual(calls, ['/api/workorder/401', '/api/workorder/401/arrival']);
});
test('main-world bridge reads shared chat state and Arrivals card props without dispatching', t => {
  const dom = new JSDOM('<body><div data-testid="customer-device-card"><button aria-label="chat panel">Messages</button></div></body>', { url: 'https://portal.ubreakifix.net/check-in/arrivals', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window, sent = [], state = { open: true, chat: { customerId: 81, customerName: 'Arrival Customer', customerPhone: '5550101' } };
  let listener;
  w.System = { resolve: id => id, get: () => ({ store: { getState: () => state, subscribe: fn => { listener = fn; }, dispatch: () => assert.fail('no writes') }, selectChatPanelOpen: s => s.open, selectChatPanelData: s => s.chat }) };
  w.postMessage = value => sent.push(value);
  const button = w.document.querySelector('button');
  button.__reactFiber$fixture = { memoizedProps: {}, return: { memoizedProps: { customer: { customerId: 81, firstName: 'Arrival', lastName: 'Customer', primaryEmail: 'a@example.test', passcode: 'never-forward' }, device: { model: 'Galaxy S25', issues: ['Screen'] }, time: 'Oct 12, 10 AM' } } };
  w.eval(read('messages-page.js')); button.click(); listener();
  const value = sent.at(-1); assert.equal(value.record.customerDevice.deviceName, 'Galaxy S25'); assert.equal(value.record.appointment, 'Oct 12, 10 AM');
  assert.doesNotMatch(JSON.stringify(value), /never-forward|passcode/);
  const card = button.__reactFiber$fixture.return;
  card.memoizedProps.time = '';
  card.return = { memoizedProps: { arrival: { customer: { customerId: 81, fullName: 'Arrival Customer', primaryEmail: 'a@example.test' }, customerDevice: { deviceName: 'Galaxy S25', modelName: 'Galaxy S25 Ultra', passcode: 'never-forward' }, deviceIssues: [{ name: 'Screen' }], appointment: '2026-10-12T14:00:00Z', passcode: 'never-forward' }, store: { storeTimeZone: 'America/New_York' } } };
  button.click(); listener();
  const raw = sent.at(-1).record;
  assert.equal(raw.appointment, '2026-10-12T14:00:00Z');
  assert.equal(raw.customerDevice.modelName, 'Galaxy S25 Ultra');
  assert.deepEqual(Array.from(raw.deviceIssues), ['Screen']);
  assert.doesNotMatch(JSON.stringify(raw), /never-forward|passcode/);
  state.chat = { customerId: 82, customerName: 'Different Customer' }; listener(); assert.equal(sent.at(-1).record.customerDevice, undefined);
  state.open = false; listener(); assert.equal(sent.at(-1).open, false);
});
test('already-open chat reads the matching mounted arrival and tracks appointment changes', t => {
  const dom = new JSDOM('<body><div data-testid="customer-device-card"></div><div data-testid="customer-device-card" hidden></div></body>', { url: 'https://portal.ubreakifix.net/check-in/arrivals', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window, sent = [], state = { open: true, chat: { customerId: 81, customerName: 'Arrival Customer' } };
  let listener;
  w.System = { resolve: id => id, get: () => ({ store: { getState: () => state, subscribe: fn => { listener = fn; }, dispatch: () => assert.fail('no writes') }, selectChatPanelOpen: s => s.open, selectChatPanelData: s => s.chat }) };
  w.postMessage = value => sent.push(value);
  const arrival = { arrivalId: 123, customer: { customerId: 81, fullName: 'Arrival Customer', primaryEmail: 'a@example.test' }, customerDevice: { deviceName: 'iPhone 16 Plus', modelName: 'iPhone 16 Plus Black', passcode: 'never-forward' }, deviceIssues: [{ name: 'Cracked Front Glass' }], appointment: '2026-10-12T17:00:00Z' };
  const cards = w.document.querySelectorAll('[data-testid="customer-device-card"]');
  cards[0].__reactFiber$fixture = { memoizedProps: {}, return: { memoizedProps: { arrival, store: { storeTimeZone: 'America/New_York' } } } };
  cards[1].__reactFiber$fixture = { memoizedProps: { arrival: { ...arrival, arrivalId: 999, appointment: 'Wrong appointment' } } };
  // No launcher click: this reproduces the open arrival in the screenshot.
  w.eval(read('messages-page.js'));
  assert.equal(sent.at(-1).record.appointment, '2026-10-12T17:00:00Z');
  assert.equal(sent.at(-1).record.customerDevice.modelName, 'iPhone 16 Plus Black');
  assert.doesNotMatch(JSON.stringify(sent), /never-forward|passcode|Wrong appointment/);
  arrival.appointment = '2026-10-13T17:00:00Z'; listener();
  assert.equal(sent.at(-1).record.appointment, arrival.appointment);
  arrival.appointment = ''; listener();
  assert.equal(sent.at(-1).record.appointment, '');
  state.chat = { customerId: 82, customerName: 'Other Customer' }; listener();
  assert.equal(sent.at(-1).record.appointment, undefined);
});

test('RT templates seed existing libraries once and preserve customized templates', async t => {
  const { w, writes } = boot(t, { seeded: false, templates: [{ id: 'custom', name: 'Custom', body: 'Saved text' }] });
  await flush(w);
  const saved = writes[0];
  assert.equal(saved['ubif-plus.rt-templates.v1'], true);
  assert.equal(saved[KEY][0].body, 'Saved text');
  assert.deepEqual(saved[KEY].slice(1).map(t => t.id), ['rt-iphone', 'rt-android']);
  const M = w.UBIFPlusMessageModel;
  const values = { 'employee.firstName': 'Jordan', 'appointment.date': 'Oct 15 at 10 AM' };
  assert.match(M.render(saved[KEY][1].body, values).text, /This is Jordan.*Oct 15 at 10 AM.*Stolen Protection/);
  assert.doesNotMatch(M.render(saved[KEY][2].body, values).text, /Stolen Protection/);
});

test('template host returns to the composer after Portal inserts a refreshed conversation', async t => {
  const { w, root } = boot(t, { html: '<aside data-message-sidebar><h2>Messages</h2><div id="history">Old conversation</div><form><textarea></textarea><button aria-label="Send message">Send</button></form></aside>' });
  await flush(w);
  const panel = w.document.querySelector('aside'), host = root().host, form = panel.querySelector('form');
  const refreshed = w.document.createElement('div'); refreshed.textContent = 'New message'; form.before(refreshed);
  await flush(w);
  assert.equal(host.nextElementSibling, form);
  assert.equal(refreshed.nextElementSibling, host);
  assert.equal(panel.querySelectorAll('[data-ubif-message-templates]').length, 1);
});

test('message settings hide shortcuts and remove the template UI live', async t => {
  let apply;
  const { w, root } = boot(t, { settings: { subscribe: fn => { apply = fn; }, get: async () => ({ messages: true, messageShortcuts: false, employeeFirstName: 'Jordan' }) } });
  await flush(w);
  assert.equal(root().querySelectorAll('.shortcut').length, 0);
  apply({ messages: false }); await flush(w);
  assert.equal(root(), undefined);
});
