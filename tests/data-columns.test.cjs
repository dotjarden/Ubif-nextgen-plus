const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const scripts = ['model.js', 'content.js'].map(f => fs.readFileSync(`${__dirname}/../extension/${f}`, 'utf8'));
(0, eval)(scripts[0]);
const { COLUMNS, PRESETS, LAYOUT_VERSION } = globalThis.UBIFPlusModel;

const portal = [['nextUpdate', 'Next update'], ['createdDate', 'Created'], ['customerName', 'Customer'], ['deviceCatalogName', 'Device/Issue'], ['woId', 'WO #']];
const dataIds = COLUMNS.filter(c => !portal.some(([portalId]) => c.portalIds.includes(portalId))).map(c => c.id);
const record = id => ({
  workorderId: id,
  workorderStatusName: 'Ready for work',
  serviceOutcome: '',
  programName: 'Asurion Home+ Repairs',
  claimNumber: 'CL-99',
  clientId: 10,
  locationBin: id === 301 ? 'B6' : 'A1',
  workorderTotal: '129.5',
  deviceIssues: ['Screen repair', 'Cleaning'],
  itemswithdevice: 'Other Item(s)',
  updatedAt: '2026-10-07T20:21:15.197Z',
  createdAt: '2026-10-01T15:05:00.000Z',
  nextUpdate: '2026-10-22T22:00:00.000Z',
  customer: { fullName: 'Dak Kinard', primaryPhoneNumber: '4043160771', email: 'dak@example.com', csuCustomerId: 'UBF000117730', canSms: 1, canCall: 1, canEmail: 0 },
  customerDevice: { name: 'iPod', serial: 'FVFGQTAAQ6L4', imei: '', passcode: id === 301 ? 'blob' : '' }
});
const table = (cols = portal, rows = [301, 302]) =>
  `<table><thead><tr>${cols.map(([id, label]) => `<th data-column-id="${id}">${label}</th>`).join('')}</tr></thead><tbody>${rows.map(id => `<tr>${cols.map(([cid]) => `<td><a href="/repair/workorder/${id}">${cid}</a></td>`).join('')}</tr>`).join('')}</tbody></table>`;
const onlyLocation = { v: LAYOUT_VERSION, hidden: dataIds.filter(id => id !== 'location') };
async function setup(data = {}) {
  const dom = new JSDOM(`<body>
    <div role="tab" aria-selected="true">All (2)</div><div role="tab">Waiting (1)</div>
    <main>${table()}</main></body>`, { url: 'https://portal.ubreakifix.net/repair/workorders?tab=All', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
  const writes = [];
  w.chrome = { storage: { local: { get: async () => data, set: async obj => { writes.push(obj); Object.assign(data, obj); } }, onChanged: { addListener() {} } } };
  scripts.forEach(s => w.eval(s));
  const tick = () => new Promise(r => w.setTimeout(r, 45));
  await tick();
  const post = async records => { w.postMessage({ source: 'ubif-plus', type: 'workorders', records }, '*'); await tick(); };
  const shadow = () => w.document.querySelector('#ubif-plus-columns')?.shadowRoot;
  const button = text => [...shadow().querySelectorAll('button')].find(b => b.textContent === text || b.textContent.startsWith(`${text} (`));
  const open = () => { button('Columns').click(); return shadow(); };
  return { dom, w, data, writes, tick, post, shadow, button, open };
}
const cellText = (row, id) => row.querySelector(`[data-ubif-extra="${id}"]`)?.textContent;
const checkbox = (ui, id) => ui.querySelector(`[data-focus="${id}-check"]`);

test('data columns stay hidden until opted in, then fill from the portal feed', async t => {
  const s = await setup(); t.after(() => (s.w.dispatchEvent(new s.w.Event('pagehide')), s.dom.window.close()));
  await s.post([record(301), record(302)]);
  assert.equal(s.w.document.querySelectorAll('[data-ubif-extra]').length, 0, 'no data cells before opt-in');
  const ui = s.open();
  assert.equal(ui.querySelectorAll('.row').length, COLUMNS.length);
  assert.equal(dataIds.length, COLUMNS.length - portal.length);
  checkbox(ui, 'status').click();
  checkbox(ui, 'location').click();
  await s.tick();
  const rows = [...s.w.document.querySelectorAll('tbody tr')];
  assert.equal(s.w.document.querySelectorAll('th[data-ubif-extra]').length, 2);
  assert.equal(cellText(rows[0], 'status'), 'Ready for work');
  assert.equal(cellText(rows[0], 'location'), 'B6');
  assert.equal(cellText(rows[1], 'location'), 'A1');
  const saved = s.data['ubif-plus.columns.v1.All'];
  assert.equal(saved.v, LAYOUT_VERSION);
  assert.ok(!saved.hidden.includes('status'));
  assert.ok(saved.hidden.includes('phone'));
  const css = s.w.document.querySelector('#ubif-plus-table-style').textContent;
  assert.match(css, /\[data-ubif-extra="status"\]\{grid-column:6!/);
  assert.match(css, /\[data-ubif-extra="location"\]\{grid-column:7!/);
});

test('contact and device values are formatted, and missing records show a placeholder', async t => {
  const s = await setup({ 'ubif-plus.columns.v1.All': { v: LAYOUT_VERSION, hidden: dataIds.filter(id => !['phone', 'serial', 'passcode', 'issues', 'total', 'lastUpdate'].includes(id)) } });
  t.after(() => (s.w.dispatchEvent(new s.w.Event('pagehide')), s.dom.window.close()));
  await s.post([record(301)]); // only one row has a record
  const rows = [...s.w.document.querySelectorAll('tbody tr')];
  assert.equal(cellText(rows[0], 'phone'), '(404) 316-0771SMS · Call');
  assert.equal(rows[0].querySelector('[data-ubif-extra="phone"] .ubif-x2').textContent, 'SMS · Call');
  assert.equal(cellText(rows[0], 'serial'), 'FVFGQTAAQ6L4');
  assert.equal(cellText(rows[0], 'passcode'), 'Set');
  assert.equal(cellText(rows[0], 'issues'), 'Screen repair, Cleaning');
  assert.equal(cellText(rows[1], 'passcode'), '—');
  assert.equal(cellText(rows[1], 'status'), undefined, 'hidden data column has no cell');
  assert.ok(cellText(rows[0], 'total').startsWith('$129.50'));
  const updated = s.w.UBIFPlusModel.dateLines(record(301).updatedAt);
  assert.equal(cellText(rows[0], 'lastUpdate'), `${updated.a}${updated.b}`);
});

test('colspan and headerless rows never receive data cells', async t => {
  const s = await setup({ 'ubif-plus.columns.v1.All': onlyLocation });
  t.after(() => (s.w.dispatchEvent(new s.w.Event('pagehide')), s.dom.window.close()));
  await s.post([record(301), record(302)]);
  assert.equal(s.w.document.querySelectorAll('tbody [data-ubif-extra]').length, 2);
  s.w.document.querySelector('tbody').innerHTML = '<tr><td colspan="5">No workorders</td></tr>';
  await s.tick();
  assert.equal(s.w.document.querySelectorAll('tbody [data-ubif-extra]').length, 0);
  s.w.document.querySelector('main').innerHTML = table();
  await s.tick();
  assert.equal(s.w.document.querySelectorAll('tbody [data-ubif-extra]').length, 2, 'cells return with real rows');
});

test('data columns sort the visible rows, and a portal sort clears our order', async t => {
  const s = await setup({ 'ubif-plus.columns.v1.All': { v: LAYOUT_VERSION, hidden: dataIds.filter(id => id !== 'location') } });
  t.after(() => (s.w.dispatchEvent(new s.w.Event('pagehide')), s.dom.window.close()));
  await s.post([record(301), record(302)]);
  const rows = () => [...s.w.document.querySelectorAll('tbody tr')];
  const location = s.w.document.querySelector('th[data-ubif-extra="location"]');
  const sortButton = location.querySelector('[data-ubif-handle="sort"]');
  sortButton.click(); await s.tick();
  assert.equal(location.getAttribute('aria-sort'), 'ascending');
  // Location A1 (row 2) sorts before B6 (row 1)
  assert.equal(rows()[1].style.order, '1');
  assert.equal(rows()[0].style.order, '2');
  sortButton.click(); await s.tick();
  assert.equal(location.getAttribute('aria-sort'), 'descending');
  assert.equal(rows()[0].style.order, '1');
  assert.equal(s.data['ubif-plus.columns.v1.All'].sort.dir, 'desc');
  s.w.document.querySelector('th[data-column-id="nextUpdate"]').click(); await s.tick();
  assert.equal(s.data['ubif-plus.columns.v1.All'].sort, null);
  assert.equal(rows()[0].style.order, '');
  sortButton.click(); await s.tick(); sortButton.click(); await s.tick(); sortButton.click(); await s.tick();
  assert.equal(s.data['ubif-plus.columns.v1.All'].sort, null, 'third click clears the sort');
});

test('presets apply immediately and Apply to all tabs copies the layout', async t => {
  const s = await setup(); t.after(() => (s.w.dispatchEvent(new s.w.Event('pagehide')), s.dom.window.close()));
  await s.post([record(301), record(302)]);
  const ui = s.open();
  const presets = [...ui.querySelectorAll('.preset')].map(b => b.textContent);
  assert.deepEqual(presets, PRESETS.map(p => p.label));
  ui.querySelector('.preset:nth-child(3)').click(); // Ops board
  await s.tick();
  const checked = id => checkbox(ui, id).checked;
  assert.equal(checked('location'), true);
  assert.equal(checked('status'), true);
  assert.equal(checked('phone'), false);
  assert.equal(checked('nextUpdate'), true, 'portal columns are never hidden by a preset');
  s.button('Apply to all tabs').click(); await s.tick();
  const current = s.data['ubif-plus.columns.v1.All'];
  const waiting = s.data['ubif-plus.columns.v1.Waiting'];
  assert.ok(current && waiting, 'both tab layouts saved');
  assert.ok(!waiting.hidden.includes('location'));
  assert.ok(waiting.hidden.includes('phone'));
  assert.equal(waiting.v, LAYOUT_VERSION);
  assert.match(ui.querySelector('.save').textContent, /Layout copied to 1 other tab\./);
});

test('search filters the column list and cannot hide the last visible column', async t => {
  const s = await setup(); t.after(() => (s.w.dispatchEvent(new s.w.Event('pagehide')), s.dom.window.close()));
  const ui = s.open();
  const search = ui.querySelector('.search');
  search.value = 'phone';
  search.dispatchEvent(new s.w.Event('input', { bubbles: true }));
  assert.equal(ui.querySelectorAll('.row').length, 1);
  assert.equal(ui.querySelector('.row .name').textContent, 'Phone');
  search.value = 'zzz';
  search.dispatchEvent(new s.w.Event('input', { bubbles: true }));
  assert.match(ui.querySelector('.empty').textContent, /No columns match/);
  search.value = '';
  search.dispatchEvent(new s.w.Event('input', { bubbles: true }));
  let guard = 0;
  while (guard++ < COLUMNS.length) {
    const candidates = [...ui.querySelectorAll('.row input')].filter(el => el.checked && !el.disabled);
    if (candidates.length <= 1) break;
    candidates[0].click();
  }
  await s.tick();
  const checked = [...ui.querySelectorAll('.row input')].filter(el => el.checked);
  assert.equal(checked.length, 1);
  assert.equal(checkbox(ui, checked[0].dataset.focus.replace('-check', '')).disabled, true);
  assert.equal(s.writes.length > 0, true, 'live apply writes without an Apply button');
});
