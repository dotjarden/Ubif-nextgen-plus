const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');

const read = name => fs.readFileSync(`${__dirname}/../extension/${name}`, 'utf8');
const modelScript = read('samsung-model.js');
const portalScript = read('samsung.js');
const fillerScript = read('sprinklr.js');
const settingsScript = read('settings.js');
const backgroundScript = read('background.js');
const manifest = JSON.parse(read('manifest.json'));
const tick = (w, ms = 40) => new Promise(resolve => w.setTimeout(resolve, ms));
const until = async (w, check, ms = 3000) => {
  const deadline = Date.now() + ms;
  while (!check()) { if (Date.now() > deadline) throw new Error('timed out'); await tick(w, 20); }
};

const model = () => { const context = {}; new Function('globalThis', modelScript)(context); return context.UBIFPlusSamsung; };

/* Fictional order shaped like GET /api/workorder/:id. */
const order = (overrides = {}) => ({
  workorderId: 500089742, clientId: 1,
  CustomerDevice: { customerId: 77, imei: '350166280848735', DeviceCatalog: { name: 'Samsung Galaxy S21 5G Phantom Gray (none)' } },
  PartnerJob: { partnerJobId: 9, PartnerJobAttributes: [{ partnerJobAttributeTypeId: 12, value: '1' }, { partnerJobAttributeTypeId: 53, value: '4184243168' }] },
  ...overrides
});
const values = {
  email: 'alex.tech@ubreakifix.com', techName: 'Alex Tech', storeNumber: '878', storeEmail: 'manchesterct@ubreakifix.com',
  repairType: 'Store', gdVersion: '3.5.067', sku: 'Samsung Galaxy S21 5G Phantom Gray', gspn: '4184243168', workorder: '500089742', imei: '350166280848735'
};

test('the manifest loads the button on Portal and the filler only on Sprinklr forms', () => {
  const portal = manifest.content_scripts.find(entry => entry.js.includes('samsung.js'));
  assert.deepEqual(portal.matches, ['https://portal.ubreakifix.net/*']);
  assert.ok(portal.js.indexOf('samsung-model.js') < portal.js.indexOf('samsung.js'));
  const sprinklr = manifest.content_scripts.find(entry => entry.js.includes('sprinklr.js'));
  assert.deepEqual(sprinklr.matches, ['https://forms-prod.sprinklr.com/*']);
  assert.deepEqual(sprinklr.js, ['samsung-model.js', 'sprinklr.js']);
  assert.equal(manifest.permissions.includes('tabs'), false, 'opening a tab needs no tabs permission');
});

test('work order details come from the order record, with the GSPN ticket from the partner job', () => {
  const M = model();
  assert.deepEqual({ ...M.fromWorkorder(order()) }, {
    workorder: '500089742', imei: '350166280848735', sku: 'Samsung Galaxy S21 5G Phantom Gray', gspn: '4184243168'
  });
  assert.equal(M.isSamsung(order()), true);
  assert.equal(M.isSamsung(order({ PartnerJob: null, CustomerDevice: { DeviceCatalog: { name: 'iPhone 16 Pro' } } })), false);
  assert.equal(M.isSamsung(order({ PartnerJob: null, CustomerDevice: { DeviceCatalog: { name: 'Galaxy Tab S9' } } })), true);
  assert.equal(M.gspnFromNotes([{ noteText: 'Diagnosed.' }, { noteText: '<p>Alex created a GSPN ticket. Ticket no. 4184243168</p>' }]), '4184243168');
  assert.equal(M.gspnFromNotes([{ noteText: 'Called customer about ticket' }]), '');
});

test('store number and email are read from the Portal store name', () => {
  const M = model();
  assert.equal(M.storeNumber('Manchester CT #878', '12'), '878');
  assert.equal(M.storeNumber('550 Newington', ''), '550');
  assert.equal(M.storeNumber('Newington', '550'), '550', 'falls back to the store id');
  assert.equal(M.storeEmail('Manchester CT #878'), 'manchesterct@ubreakifix.com');
  assert.equal(M.storeEmail(''), '');
});

test('each form lists only the details it needs and refuses incomplete jobs', () => {
  const M = model();
  assert.deepEqual(M.keysFor('wer'), ['email', 'storeNumber', 'repairType', 'storeEmail', 'techName', 'workorder', 'imei']);
  assert.ok(M.keysFor('gd').includes('gdVersion') && M.keysFor('gd').includes('sku'));
  assert.ok(!M.keysFor('fenrir').includes('sku'));
  assert.deepEqual(M.missing('gd', { ...values, gspn: '', imei: '12' }), ['gspn', 'imei']);
  assert.deepEqual(M.missing('wer', { ...values, gspn: '' }), [], 'WER needs no GSPN ticket');
  assert.deepEqual(M.missing('gd', { ...values, email: 'nope', repairType: 'Mall' }), ['email', 'repairType']);
  assert.equal(M.job('gd', { ...values, gspn: '' }, false), null);
  assert.equal(M.job('other', values, false), null);
  const gd = M.job('gd', { ...values, extra: 'ignored' }, true);
  assert.equal(gd.autoSubmit, true);
  assert.equal('extra' in gd.values, false);
  assert.equal(M.job('fenrir', values, true).autoSubmit, false, 'Fenrir waits for its screenshot');
  const steps = M.steps(gd);
  assert.deepEqual(steps.slice(0, 2).map(step => [step.label, step.value]), [['Email Address', values.email], ['UBIF Location', '878']]);
  assert.equal(steps.find(step => step.label === 'Exception Type').value, 'Galaxy Diagnostic Tool');
  assert.equal(steps.find(step => step.label === 'UBIF Location').number, true);
});

function worker() {
  const sessionData = {}, created = [];
  const listeners = [];
  let removed = null;
  const chrome = {
    runtime: { lastError: null, onMessage: { addListener: fn => listeners.push(fn) } },
    tabs: { create: async options => { created.push(options); return { id: 41 }; }, onRemoved: { addListener: fn => { removed = fn; } } },
    storage: { session: {
      get: async key => (key in sessionData ? { [key]: sessionData[key] } : {}),
      set: async object => { Object.assign(sessionData, object); },
      remove: async key => { delete sessionData[key]; }
    } },
    notifications: { create() {}, clear() {} }, action: { setBadgeBackgroundColor() {}, setBadgeText() {} }
  };
  const importScripts = name => new Function(read(name))();
  new Function('chrome', 'importScripts', backgroundScript)(chrome, importScripts);
  const send = (message, sender) => new Promise(resolve => {
    for (const listener of listeners) if (listener(message, sender, resolve) === true) return;
    resolve(undefined);
  });
  return { send, created, sessionData, closeTab: id => removed(id) };
}

test('the worker opens the fixed Sprinklr form and hands the job only to that tab', async () => {
  const w = worker();
  const portal = { url: 'https://portal.ubreakifix.net/repair/workorder/500089742', tab: { id: 7 } };
  const reply = await w.send({ type: 'ubif-plus-samsung-open', form: 'gd', values, autoSubmit: false }, portal);
  assert.deepEqual(reply, { ok: true });
  assert.equal(w.created.length, 1);
  assert.match(w.created[0].url, /^https:\/\/forms-prod\.sprinklr\.com\/guided-workflows\//);
  assert.deepEqual(Object.keys(w.sessionData), ['ubif-plus.samsung-job.41']);

  const otherSite = await w.send({ type: 'ubif-plus-samsung-open', form: 'gd', values }, { url: 'https://example.com/', tab: { id: 8 } });
  assert.equal(otherSite.ok, false, 'only Portal can open a form');
  const incomplete = await w.send({ type: 'ubif-plus-samsung-open', form: 'gd', values: { ...values, imei: '' } }, portal);
  assert.equal(incomplete.ok, false);
  assert.equal(w.created.length, 1);

  const sprinklr = id => ({ url: 'https://forms-prod.sprinklr.com/guided-workflows/x', tab: { id } });
  assert.equal((await w.send({ type: 'ubif-plus-samsung-job' }, sprinklr(99))).job, null, 'another Sprinklr tab gets nothing');
  assert.equal((await w.send({ type: 'ubif-plus-samsung-job' }, { url: 'https://portal.ubreakifix.net/', tab: { id: 41 } })).ok, false);
  const claimed = await w.send({ type: 'ubif-plus-samsung-job' }, sprinklr(41));
  assert.equal(claimed.job.values.gspn, '4184243168');
  assert.equal((await w.send({ type: 'ubif-plus-samsung-job' }, sprinklr(41))).job.form, 'gd', 'kept until the filler reports back');
  await w.send({ type: 'ubif-plus-samsung-done' }, sprinklr(41));
  assert.equal((await w.send({ type: 'ubif-plus-samsung-job' }, sprinklr(41))).job, null);

  await w.send({ type: 'ubif-plus-samsung-open', form: 'wer', values }, portal);
  w.sessionData['ubif-plus.samsung-job.41'].createdAt -= 16 * 60 * 1000;
  assert.equal((await w.send({ type: 'ubif-plus-samsung-job' }, sprinklr(41))).job, null, 'stale jobs expire');
  await w.send({ type: 'ubif-plus-samsung-open', form: 'wer', values }, portal);
  w.closeTab(41);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(Object.keys(w.sessionData), [], 'closing the tab drops its job');
});

/* A small stand-in for Sprinklr's guided workflow: required-star labels, a
   searchable combobox per dropdown, and follow-up questions that appear only
   after the answer before them. "Store Email Address" comes first so an
   inexact label match would put the technician's email in the wrong box. */
const sprinklrForm = `<!doctype html><body><form id="form">
  <div class="q"><div class="label"><span>Store Email Address</span><span>*</span></div><div class="box"><input name="storeEmail"></div></div>
  <div class="q"><div class="label"><span>Email Address</span><span>*</span></div><div class="box"><input name="email"></div></div>
  <div class="q"><div class="label">UBIF Location *</div><div class="box"><input role="combobox" name="location" data-options="Hartford CT #1878|Manchester CT #878|Newington #550"></div></div>
  <div class="q"><div class="label">Repair Location Type</div><div class="box"><input role="combobox" name="repairType" data-options="Store|Kiosk"></div></div>
  <div class="q"><div class="label">Technician Name</div><div class="box"><input name="techName"></div></div>
  <div class="q"><div class="label">Issue Type</div><div class="box"><input role="combobox" name="issue" data-options="Exception Request|Process Requests" data-reveals="exception"></div></div>
  <div id="exception" hidden>
    <div class="q"><div class="label">Exception Type</div><div class="box"><input role="combobox" name="exceptionType" data-options="Fenrir|Galaxy Diagnostic Tool" data-reveals="gd"></div></div>
  </div>
  <div id="gd" hidden>
    <div class="q"><div class="label">Galaxy Diagnostic Exception Reason</div><div class="box"><input role="combobox" name="reason" data-options="Customer Request|Asurion Repair"></div></div>
    <div class="q"><div class="label">Galaxy Diagnostic Tool Version</div><div class="box"><input name="gdVersion"></div></div>
    <div class="q"><div class="label">Device Full SKU</div><div class="box"><input name="sku"></div></div>
    <div class="q"><div class="label">GSPN Ticket Number</div><div class="box"><input name="gspn"></div></div>
    <div class="q"><div class="label">Portal Work Order Number</div><div class="box"><input name="workorder"></div></div>
    <div class="q"><div class="label">IMEI</div><div class="box"><input name="imei"></div></div>
    <div class="q"><div class="label">Subject</div><div class="box"><input name="subject"></div></div>
    <div class="q"><div class="label">Description</div><div class="box"><textarea name="description"></textarea></div></div>
  </div>
  <button type="submit">Submit</button>
</form><ul role="listbox" id="list" hidden></ul>
<script>
  const list = document.getElementById('list');
  let active = null;
  document.addEventListener('click', event => {
    const box = event.target.closest('[role=combobox]');
    if (!box) return;
    active = box; list.replaceChildren();
    for (const text of box.dataset.options.split('|')) {
      const li = document.createElement('li'); li.setAttribute('role', 'option'); li.textContent = text;
      li.addEventListener('click', () => {
        active.value = text; active.dataset.chosen = text; list.hidden = true;
        if (active.dataset.reveals) setTimeout(() => { document.getElementById(active.dataset.reveals).hidden = false; }, 30);
      });
      list.append(li);
    }
    setTimeout(() => { list.hidden = false; }, 20);
  });
  document.getElementById('form').addEventListener('submit', event => { event.preventDefault(); document.body.dataset.submitted = 'yes'; });
</script></body>`;

/* The same form with the quirks Portal Pro copes with: labels holding more
   than the field name, options that are plain classed list items, and an
   aria-hidden wrapper. */
const looseForm = sprinklrForm
  .replace('<div class="label"><span>Store Email Address</span><span>*</span></div>', '<div class="label">Store Email Address (store inbox) *</div>')
  .replace('<div class="label"><span>Email Address</span><span>*</span></div>', '<div class="label">Email Address (where Samsung replies) *</div>')
  .replace('<form id="form">', '<div aria-hidden="true"><form id="form">').replace('</form>', '</form></div>')
  .replace('<ul role="listbox" id="list" hidden>', '<ul class="menu" id="list" hidden>')
  .replace("li.setAttribute('role', 'option');", "li.className = 'menu-option';");

function sprinklrPage(job, { dropOption, loose } = {}) {
  const base = loose ? looseForm : sprinklrForm;
  const markup = dropOption ? base.replace(`|${dropOption}`, '') : base;
  const dom = new JSDOM(markup, { url: 'https://forms-prod.sprinklr.com/guided-workflows/6544db26d4b8393a0b65ebb7', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  const sent = [];
  w.chrome = { runtime: { sendMessage: async message => { sent.push(message.type); return message.type === 'ubif-plus-samsung-job' ? { ok: true, job } : { ok: true }; } } };
  w.eval(modelScript);
  w.eval(fillerScript);
  const field = name => w.document.querySelector(`[name="${name}"]`);
  const banner = () => w.document.querySelector('[data-ubif-sprinklr]')?.shadowRoot?.textContent || '';
  return { dom, w, sent, field, banner };
}

test('the filler completes a GD Bypass form and leaves it for review by default', async t => {
  const M = model();
  const page = sprinklrPage(M.job('gd', values, false));
  t.after(() => page.dom.window.close());
  await until(page.w, () => page.sent.includes('ubif-plus-samsung-done'), 15000);
  const { field } = page;
  assert.equal(field('email').value, 'alex.tech@ubreakifix.com', 'exact label: not the store email box');
  assert.equal(field('storeEmail').value, 'manchesterct@ubreakifix.com');
  assert.equal(field('location').dataset.chosen, 'Manchester CT #878', '#878 never matches #1878');
  assert.equal(field('repairType').dataset.chosen, 'Store');
  assert.equal(field('issue').dataset.chosen, 'Exception Request');
  assert.equal(field('exceptionType').dataset.chosen, 'Galaxy Diagnostic Tool', 'waited for the revealed question');
  assert.equal(field('reason').dataset.chosen, 'Asurion Repair');
  assert.equal(field('gspn').value, '4184243168');
  assert.equal(field('sku').value, 'Samsung Galaxy S21 5G Phantom Gray');
  assert.equal(field('description').value, 'Asurion Repair');
  assert.equal(page.w.document.body.dataset.submitted, undefined, 'fill-only by default');
  assert.match(page.banner(), /GD Bypass filled/);
  assert.match(page.banner(), /Review the form, then submit/);
});

test('the filler submits only when asked and every field filled', async t => {
  const M = model();
  const page = sprinklrPage(M.job('gd', values, true));
  t.after(() => page.dom.window.close());
  await until(page.w, () => page.sent.includes('ubif-plus-samsung-done'), 15000);
  assert.equal(page.w.document.body.dataset.submitted, 'yes');
  assert.match(page.banner(), /GD Bypass submitted/);
});

test('a missing answer is reported and blocks automatic submission', async t => {
  const M = model();
  const page = sprinklrPage(M.job('gd', values, true), { dropOption: 'Asurion Repair' });
  t.after(() => page.dom.window.close());
  await until(page.w, () => page.sent.includes('ubif-plus-samsung-done'), 20000);
  assert.equal(page.w.document.body.dataset.submitted, undefined);
  assert.match(page.banner(), /Filled 14 of 15 fields/);
  assert.match(page.banner(), /Galaxy Diagnostic Exception Reason/);
  assert.equal(page.field('imei').value, '350166280848735', 'later fields still fill');
});

test('labels that only contain the field name, classed options and aria-hidden wrappers still fill, as in Portal Pro', async t => {
  const M = model();
  const page = sprinklrPage(M.job('gd', values, false), { loose: true });
  t.after(() => page.dom.window.close());
  await until(page.w, () => page.sent.includes('ubif-plus-samsung-done'), 15000);
  const { field } = page;
  assert.equal(field('email').value, 'alex.tech@ubreakifix.com', '"Store Email Address (store inbox)" is not taken for Email Address');
  assert.equal(field('storeEmail').value, 'manchesterct@ubreakifix.com');
  assert.equal(field('location').dataset.chosen, 'Manchester CT #878');
  assert.equal(field('reason').dataset.chosen, 'Asurion Repair');
  assert.equal(field('imei').value, '350166280848735');
  assert.match(page.banner(), /GD Bypass filled/);
});

test('a Sprinklr tab the extension did not open is left alone', async t => {
  const page = sprinklrPage(null);
  t.after(() => page.dom.window.close());
  await tick(page.w, 300);
  assert.equal(page.field('email').value, '');
  assert.equal(page.banner(), '');
});

/* The GD Bypass questions as native controls, every one shown at once.
   Half are named by aria-label or placeholder instead of a <label>, and the
   form can sit in a shadow root or a same-origin frame. */
const gdChoices = { 'UBIF Location': ['Hartford CT #1878', 'Manchester CT #878'], 'Repair Location Type': ['Store', 'Kiosk'],
  'Issue Type': ['Exception Request'], 'Exception Type': ['Fenrir', 'Galaxy Diagnostic Tool'], 'Galaxy Diagnostic Exception Reason': ['Asurion Repair'] };
const nativeForm = () => model().FORMS.gd.fields.map(({ label }, index) => {
  const control = gdChoices[label] ? `<select name="${label}"${index % 2 ? ` aria-label="${label}"` : ''}><option value="">Select</option>${gdChoices[label].map(text => `<option>${text}</option>`).join('')}</select>`
    : `<input name="${label}"${index % 2 ? ` ${index % 4 === 1 ? 'aria-label' : 'placeholder'}="${label}"` : ''}>`;
  return `<div class="q">${index % 2 ? '' : `<label>${label} *</label>`}${control}</div>`;
}).join('');

function hostedPage(where) {
  const body = where === 'none' ? '<p>Sign in to continue</p><label>Username</label><input placeholder="Password">'
    : where === 'page' ? nativeForm() : '<div id="host"></div><iframe id="frame"></iframe>';
  const dom = new JSDOM(`<!doctype html><body>${body}</body>`, { url: 'https://forms-prod.sprinklr.com/guided-workflows/6544db26d4b8393a0b65ebb7', runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;
  if (where === 'shadow') w.document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML = nativeForm();
  if (where === 'frame') w.document.getElementById('frame').contentDocument.body.innerHTML = nativeForm();
  const sent = [];
  w.chrome = { runtime: { sendMessage: async message => { sent.push(message.type); return { ok: true, job: null }; } } };
  w.eval(modelScript);
  w.eval(fillerScript);
  const scope = where === 'shadow' ? w.document.getElementById('host').shadowRoot : where === 'frame' ? w.document.getElementById('frame').contentDocument : w.document;
  const field = name => scope.querySelector(`[name="${name}"]`);
  const banner = () => w.document.querySelector('[data-ubif-sprinklr]')?.shadowRoot?.textContent || '';
  return { dom, w, sent, field, banner };
}

for (const where of ['page', 'shadow', 'frame']) {
  test(`the filler finds fields by label, aria-label or placeholder (${where})`, async t => {
    const page = hostedPage(where);
    t.after(() => page.dom.window.close());
    await page.w.UBIFPlusSprinklr.run(model().job('gd', values, false));
    const { field } = page;
    assert.equal(field('Email Address').value, 'alex.tech@ubreakifix.com');
    assert.equal(field('Store Email Address').value, 'manchesterct@ubreakifix.com');
    assert.equal(field('UBIF Location').value, 'Manchester CT #878');
    assert.equal(field('Exception Type').value, 'Galaxy Diagnostic Tool');
    assert.equal(field('IMEI').value, '350166280848735');
    assert.equal(field('Description').value, 'Asurion Repair');
    assert.match(page.banner(), /GD Bypass filled/);
    assert.equal(page.sent.at(-1), 'ubif-plus-samsung-done');
  });
}

test('a page without the form says so instead of waiting on every field', async t => {
  const page = hostedPage('none');
  t.after(() => page.dom.window.close());
  const started = Date.now();
  await page.w.UBIFPlusSprinklr.run(model().job('gd', values, true), { firstField: 300, nextField: 5000, option: 3000 });
  assert.ok(Date.now() - started < 3000, 'stops after the first wait');
  assert.match(page.banner(), /Could not find the GD Bypass fields/);
  assert.match(page.banner(), /Looked for "Email Address"; this page shows "Username", "Password"/);
});

test('an unexpected error ends in a banner, not a stuck "Filling…"', async t => {
  const page = hostedPage('page');
  t.after(() => page.dom.window.close());
  page.w.Element.prototype.querySelectorAll = () => { throw new Error('boom'); };
  page.w.Document.prototype.querySelectorAll = page.w.Element.prototype.querySelectorAll;
  await page.w.UBIFPlusSprinklr.run(model().job('gd', values, false));
  assert.match(page.banner(), /Could not fill GD Bypass/);
  assert.match(page.banner(), /boom/);
});

/* Portal work order page with fictional API responses. */
function portalPage({ workorder = order(), notes = [], settings = {} } = {}) {
  const dom = new JSDOM('<!doctype html><body><main><h1><span data-aui="text">Work order #500089742 | Alex Morgan</span></h1></main></body>', {
    url: 'https://portal.ubreakifix.net/repair/workorder/500089742', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const sent = [], stored = { 'ubif-plus.settings.v1': settings };
  w.chrome = {
    runtime: { sendMessage: async message => { sent.push(message); return { ok: true }; } },
    storage: { local: { get: async key => (key in stored ? { [key]: stored[key] } : {}), set: async object => { Object.assign(stored, object); } }, onChanged: { addListener() {} } }
  };
  w.fetch = async url => {
    if (String(url).startsWith('/api/workorder/500089742')) return { ok: true, json: async () => ({ workorder }) };
    if (String(url).startsWith('/api/note')) return { ok: true, json: async () => ({ notes }) };
    return { ok: false, json: async () => ({}) };
  };
  w.eval(settingsScript);
  w.eval(modelScript);
  w.eval(portalScript);
  // What messages-page.js posts from Portal's store in the main world.
  w.dispatchEvent(new w.MessageEvent('message', { source: w, data: { source: 'ubif-plus', type: 'tech-context',
    email: 'alex.tech@ubreakifix.com', name: 'Alex Tech', storeId: '12', storeName: 'Manchester CT #878' } }));
  const host = () => w.document.querySelector('[data-ubif-samsung]');
  const $ = selector => host()?.shadowRoot.querySelector(selector);
  return { dom, w, sent, stored, host, $ };
}

test('a Samsung work order gets the button beside its heading and a prefilled review', async t => {
  const page = portalPage({ settings: { samsungGdVersion: '3.5.067' } });
  t.after(() => page.dom.window.close());
  await until(page.w, () => page.host());
  assert.equal(page.host().previousElementSibling.textContent.startsWith('Work order #500089742'), true);
  page.$('.launch').click();
  await until(page.w, () => page.$('dialog').hasAttribute('open'));
  const value = key => page.$(`[data-key="${key}"] input, [data-key="${key}"] select`).value;
  assert.equal(value('email'), 'alex.tech@ubreakifix.com');
  assert.equal(value('storeNumber'), '878');
  assert.equal(value('storeEmail'), 'manchesterct@ubreakifix.com');
  assert.equal(value('gspn'), '4184243168');
  assert.equal(value('gdVersion'), '3.5.067');
  assert.equal(page.$('.primary').disabled, false);
  assert.equal(page.$('.primary').textContent, 'Open Sprinklr form', 'fill-only by default');

  const fenrir = page.$('input[value="fenrir"]');
  fenrir.checked = true; fenrir.dispatchEvent(new page.w.Event('change', { bubbles: true }));
  assert.equal(page.$('[data-key="sku"]').hidden, true, 'Fenrir does not ask for the SKU');
  assert.equal(page.$('.auto').hidden, true, 'Fenrir never submits itself');
  assert.match(page.$('.note').textContent, /screenshot/);

  const store = page.$('[data-key="storeEmail"] input');
  store.value = 'manchester@ubreakifix.com'; store.dispatchEvent(new page.w.Event('input'));
  page.$('.primary').click();
  await until(page.w, () => page.sent.length === 1);
  assert.deepEqual({ type: page.sent[0].type, form: page.sent[0].form, autoSubmit: page.sent[0].autoSubmit }, { type: 'ubif-plus-samsung-open', form: 'fenrir', autoSubmit: false });
  assert.equal(page.sent[0].values.storeEmail, 'manchester@ubreakifix.com');
  await until(page.w, () => !page.$('dialog').hasAttribute('open'));
  assert.deepEqual(JSON.parse(JSON.stringify(page.stored['ubif-plus.samsung.store-emails.v1'])), { 878: 'manchester@ubreakifix.com' }, 'a corrected store email is remembered for that store');
});

test('missing details keep the form from opening, and a GSPN ticket in the notes is used', async t => {
  const page = portalPage({ workorder: order({ PartnerJob: null }), notes: [{ noteText: 'created a GSPN ticket. Ticket no. 5550001234' }] });
  t.after(() => page.dom.window.close());
  await until(page.w, () => page.host());
  page.$('.launch').click();
  await until(page.w, () => page.$('dialog').hasAttribute('open'));
  assert.equal(page.$('[data-key="gspn"] input').value, '5550001234');
  assert.equal(page.$('[data-key="gdVersion"]').hasAttribute('data-invalid'), true, 'no GD version saved yet');
  assert.equal(page.$('.primary').disabled, true);
  const version = page.$('[data-key="gdVersion"] input');
  version.value = '3.5.070'; version.dispatchEvent(new page.w.Event('input'));
  assert.equal(page.$('.primary').disabled, false);
  page.$('.primary').click();
  await until(page.w, () => page.sent.length === 1);
  await tick(page.w);
  assert.equal(page.stored['ubif-plus.settings.v1'].samsungGdVersion, '3.5.070', 'the version is remembered');
});

test('other devices and a disabled setting get no button', async t => {
  const apple = portalPage({ workorder: order({ PartnerJob: null, CustomerDevice: { imei: '1', DeviceCatalog: { name: 'iPhone 16 Pro' } } }) });
  t.after(() => apple.dom.window.close());
  const off = portalPage({ settings: { samsungForms: false } });
  t.after(() => off.dom.window.close());
  await tick(apple.w, 300);
  assert.equal(apple.host(), null);
  assert.equal(off.host(), null);
});

test('a keyboard shortcut opens the chosen Samsung form', async t => {
  const page = portalPage({ settings: { samsungGdVersion: '3.5.067' } });
  t.after(() => page.dom.window.close());
  await until(page.w, () => page.host());
  page.w.document.dispatchEvent(new page.w.CustomEvent('ubif-plus-action', { detail: { action: 'samsung.wer' } }));
  await until(page.w, () => page.$('dialog').hasAttribute('open'));
  assert.equal(page.$('input[value="wer"]').checked, true);
  assert.equal(page.$('[data-key="gspn"]').hidden, true, 'WER needs no GSPN ticket');
});
