const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const scripts = ['model.js', 'content.js'].map(f => fs.readFileSync(`${__dirname}/../extension/${f}`, 'utf8'));
(0, eval)(scripts[0]);
const { COLUMNS, PRESETS, LAYOUT_VERSION, GROUPS } = globalThis.UBIFPlusModel;
const columns = [ ['nextUpdate','Next update'], ['createdDate','Created'], ['customerName','Customer'], ['deviceCatalogName','Device/Issue'], ['status','Status'], ['woProgram','Program'], ['location','Location'], ['woId','WO #'] ];
// Columns the table does not render: they stay opt-in, so they are hidden by default.
const dataIds = COLUMNS.filter(c => !columns.some(([portalId]) => c.portalIds.includes(portalId))).map(c => c.id);
const table = (cols = columns) => `<table><thead><tr>${cols.map(([id,label]) => `<th data-column-id="${id}">${label}</th>`).join('')}</tr></thead><tbody><tr>${cols.map(([id]) => `<td><a href="/repair/workorder/demo">${id}</a></td>`).join('')}</tr></tbody></table>`;
async function setup(data = {}, fail = false) {
  const dom = new JSDOM(`<body><div role="tab" aria-selected="true">All (3)</div><main>${table()}</main></body>`, { url:'https://portal.ubreakifix.net/repair/workorders?tab=All', runScripts:'outside-only', pretendToBeVisual:true });
  const w = dom.window;
  w.HTMLDialogElement.prototype.showModal = function() { this.open = true; };
  w.HTMLDialogElement.prototype.close = function() { this.open = false; this.dispatchEvent(new w.Event('close')); };
  const writes = []; let changeListener;
  w.chrome = { storage: { local: { get: async () => data, set: async obj => { if(fail) throw Error('storage failure'); writes.push(obj); Object.assign(data,obj); } }, onChanged: { addListener: fn => { changeListener = fn; } } } };
  scripts.forEach(s => w.eval(s));
  const tick = () => new Promise(r => w.setTimeout(r, 45));
  await tick();
  return { dom, w, data, writes, tick, shadow: () => w.document.querySelector('#ubif-plus-columns')?.shadowRoot, changed: changes => changeListener(changes, 'local') };
}
function button(shadow, text) {
  return [...shadow.querySelectorAll('button')].find(el => el.textContent === text || el.textContent.startsWith(`${text} (`));
}
function openColumns(s) { const ui = s.shadow(); button(ui, 'Columns').click(); return ui; }
const names = ui => [...ui.querySelectorAll('.row .name')].map(el => el.textContent);
const toggled = (ui, id) => ui.querySelector(`[data-focus="${id}-check"]`);

test('the dialog lists the portal defaults once, grouped, and applies live', async t => {
  const s = await setup(); t.after(() => (s.w.dispatchEvent(new s.w.Event('pagehide')), s.dom.window.close()));
  const cell = s.w.document.querySelector('td'); let clicked = 0; cell.addEventListener('click', () => clicked++);
  const ui = openColumns(s);
  assert.equal(button(ui, 'Apply'), undefined, 'live apply: there is no Apply button');
  assert.ok(button(ui, 'Done'));
  assert.deepEqual([...ui.querySelectorAll('.group')].map(g => g.textContent), ['Workorder (10)', 'Program (3)', 'Customer (4)', 'Device (7)']);
  const labels = names(ui);
  assert.equal(labels.length, COLUMNS.length, 'every logical column is offered once');
  assert.equal(labels.filter(name => name === 'Status').length, 1, 'no duplicate Status');
  assert.equal(labels.filter(name => name === 'Total').length, 1, 'no duplicate Total');
  assert.ok(labels.includes('Device/Issue') && labels.includes('Location'));
  // Portal-rendered columns are marked, the data columns are not.
  assert.equal(ui.querySelector('[data-focus="created-check"]').closest('label').querySelector('.tag').textContent, 'table');
  assert.equal(toggled(ui, 'phone').closest('label').querySelector('.tag'), null);
  // Toggling applies to the table and to storage straight away.
  toggled(ui, 'created').click(); await s.tick();
  assert.equal(toggled(ui, 'created').checked, false);
  const saved = s.data['ubif-plus.columns.v1.All'];
  assert.ok(saved.hidden.includes('created'));
  assert.equal(saved.hidden.length, dataIds.length + 1);
  assert.equal(saved.v, LAYOUT_VERSION);
  assert.equal(s.shadow().querySelector('.summary').textContent, `All · ${columns.length - 1} of ${COLUMNS.length} columns`);
  assert.match(s.shadow().querySelector('.counts').textContent, new RegExp(`${columns.length - 1} of ${COLUMNS.length} columns shown`));
  assert.match(s.w.document.querySelector('#ubif-plus-table-style').textContent, /th:nth-child\(2\)[^}]*\{display:none!important/);
  // Portal cells, links and handlers are untouched.
  assert.equal(cell, s.w.document.querySelector('td')); cell.click(); assert.equal(clicked, 1);
});

test('reorder, resize and last-column guard run from the header and the dialog', async t => {
  const s = await setup(); t.after(() => (s.w.dispatchEvent(new s.w.Event('pagehide')), s.dom.window.close()));
  const ui = openColumns(s);
  s.w.document.querySelector('[aria-label="Move WO #"]').dispatchEvent(new s.w.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
  const customer = s.w.document.querySelector('[data-column-id="customerName"]');
  customer.getBoundingClientRect = () => ({width:230});
  customer.querySelector('[role=separator]').dispatchEvent(new s.w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
  await s.tick();
  const saved = s.data['ubif-plus.columns.v1.All'];
  assert.equal(saved.order[6], 'woId');
  assert.equal(saved.widths.customerName, 240);
  assert.match(s.w.document.querySelector('#ubif-plus-table-style').textContent, /grid-column:7/);
  // Hiding columns from the dialog until only one remains is refused.
  let guard = 0;
  while (guard++ < COLUMNS.length) {
    const candidates = [...ui.querySelectorAll('.row input')].filter(el => el.checked && !el.disabled);
    if (candidates.length <= 1) break;
    candidates[0].click();
  }
  await s.tick();
  const remaining = [...ui.querySelectorAll('.row input')].filter(el => el.checked);
  assert.equal(remaining.length, 1, 'the last visible column stays checked');
  assert.equal(toggled(ui, remaining[0].dataset.focus.replace('-check','')).disabled, true);
  button(ui, 'Done').click();
  assert.equal(s.data['ubif-plus.columns.v1.All'].hidden.length, COLUMNS.length - 1);
});

test('per-tab layouts survive table replacements, reloads and SPA route changes', async t => {
  const data = { 'ubif-plus.columns.v1.All':{ order:['woId'], hidden:['created'], widths:{} } };
  const s = await setup(data); t.after(() => (s.w.dispatchEvent(new s.w.Event('pagehide')), s.dom.window.close()));
  assert.match(s.shadow().querySelector('.summary').textContent, new RegExp(`All · 7 of ${COLUMNS.length}`));
  const tab = s.w.document.querySelector('[role=tab]'); tab.textContent = 'Need to order (1)';
  s.w.history.pushState({},'', '?tab=Need+to+order'); s.w.document.querySelector('main').innerHTML = table(columns.filter(c => c[0] !== 'status')); await s.tick();
  assert.match(s.shadow().querySelector('.summary').textContent, new RegExp(`Need to order · 7 of ${COLUMNS.length}`));
  let ui = openColumns(s);
  assert.equal(toggled(ui, 'status').closest('label').querySelector('.tag'), null, 'Status is a data column on this tab');
  toggled(ui, 'status').click(); await s.tick();
  const needToOrder = data['ubif-plus.columns.v1.Need to order'];
  assert.equal(needToOrder.v, LAYOUT_VERSION);
  assert.ok(needToOrder.hidden.includes('phone'));
  assert.ok(!needToOrder.hidden.includes('status'));
  button(ui, 'Done').click();
  tab.textContent = 'All (3)'; s.w.history.pushState({},'', '?tab=All'); s.w.document.querySelector('main').innerHTML = table(); await s.tick();
  assert.match(s.shadow().querySelector('.summary').textContent, new RegExp(`All · 7 of ${COLUMNS.length}`));
  s.w.history.pushState({},'', '/check-out/sales'); tab.textContent = 'Sales'; await s.tick();
  assert.equal(s.shadow(),undefined); assert.equal(s.w.document.querySelector('[data-ubif-plus]'),null);
  const reload = await setup(data); t.after(() => (reload.w.dispatchEvent(new reload.w.Event('pagehide')), reload.dom.window.close()));
  assert.match(reload.shadow().querySelector('.summary').textContent, new RegExp(`All · 7 of ${COLUMNS.length}`));
});

test('reset, show all and the storage-less first run', async t => {
  const s = await setup(); t.after(() => (s.w.dispatchEvent(new s.w.Event('pagehide')), s.dom.window.close()));
  let ui = openColumns(s);
  toggled(ui, 'location').click(); await s.tick();
  assert.equal(s.data['ubif-plus.columns.v1.All'].hidden.includes('location'), true);
  button(ui, 'Reset layout').click(); await s.tick();
  assert.deepEqual([...s.data['ubif-plus.columns.v1.All'].hidden].sort(), [...dataIds].sort());
  button(ui, 'Show all').click(); await s.tick();
  assert.deepEqual([...s.data['ubif-plus.columns.v1.All'].hidden], []);
  assert.match(s.shadow().querySelector('.summary').textContent, new RegExp(`${COLUMNS.length} of ${COLUMNS.length}`));
  button(ui, 'Done').click();
});

test('normalization handles corrupt preferences, new columns and bounded widths', async t => {
  const s = await setup(); t.after(() => (s.w.dispatchEvent(new s.w.Event('pagehide')), s.dom.window.close()));
  const normalize = s.w.UBIFPlusModel.normalize;
  const schema = columns.map(([id,label])=>({id: s.w.UBIFPlusModel.logicalId(id), label}));
  const a = normalize(schema,{order:['woId','woId','removed'],hidden:schema.map(c=>c.id),widths:{woId:99999,customerName:-20}});
  assert.equal(a.order.length,8); assert.equal(a.hidden.length,7); assert.equal(a.widths.woId,600); assert.equal(a.widths.customerName,100);
  assert.equal(normalize(schema,{order:'oops',hidden:42}).order.length,8);
  // A layout saved before logical ids existed keeps working: portal header ids
  // and `x.*` data ids fold onto the logical id, and a legacy data copy of a
  // column the table renders itself does not hide the portal's own cell.
  const full = [...schema, { id: 'phone', label: 'Phone' }, { id: 'total', label: 'Total' }];
  const legacy = normalize(full, { v: 2, order:['deviceCatalogName','x.bin','x.phone','woId'], hidden:['x.bin','x.phone'], widths:{'x.bin':340,'x.phone':210} }, ['phone','total']);
  assert.deepEqual([...legacy.order].slice(0,4), ['deviceIssue','location','phone','woId']);
  assert.deepEqual([...legacy.hidden], ['phone', 'total'], 'data columns stay opt-in in a legacy layout');
  assert.equal(legacy.widths.location, 340);
  assert.equal(legacy.widths.phone, 210);
  assert.equal(legacy.v, LAYOUT_VERSION);
});

test('storage failure is visible and external preference changes apply', async t => {
  const s = await setup({},true); t.after(() => (s.w.dispatchEvent(new s.w.Event('pagehide')), s.dom.window.close()));
  const ui = openColumns(s);
  toggled(ui, 'location').click(); await s.tick();
  assert.match(s.shadow().querySelector('.bar [role=status]').textContent,/Could not save/);
  assert.match(ui.querySelector('.save').textContent,/Could not save/);
  s.changed({'ubif-plus.columns.v1.All':{newValue:{hidden:['location']}}}); await s.tick();
  assert.match(s.shadow().querySelector('.summary').textContent, new RegExp(`All · 7 of ${COLUMNS.length}`));
});

test('unrelated tables remain untouched and content initialization is idempotent', async t => {
  const s = await setup(); t.after(() => (s.w.dispatchEvent(new s.w.Event('pagehide')), s.dom.window.close()));
  const extra = s.w.document.createElement('table'); extra.innerHTML='<thead><tr><th>Other</th></tr></thead><tbody><tr><td>Untouched</td></tr></tbody>'; s.w.document.body.append(extra);
  s.w.eval(scripts[1]); await s.tick();
  assert.equal(s.w.document.querySelectorAll('#ubif-plus-columns').length,1); assert.equal(extra.hasAttribute('data-ubif-plus'),false);
});

test('a reinjected content script replaces the previous controls instead of duplicating them', async t => {
  const s = await setup(); t.after(() => (s.w.dispatchEvent(new s.w.Event('pagehide')), s.dom.window.close()));
  const first = s.w.document.querySelector('#ubif-plus-columns');
  s.w.__ubifPlusStarted = false; // Simulate a new isolated JS world on the same document.
  s.w.eval(scripts[1]); await s.tick();
  assert.equal(first.isConnected, false);
  assert.equal(s.w.document.querySelectorAll('#ubif-plus-columns').length, 1);
  assert.equal(s.w.document.querySelectorAll('#ubif-plus-table-style').length, 1);
  assert.equal(s.w.document.querySelectorAll('[data-ubif-handle="move"]').length, columns.length);
  s.w.document.querySelector('main').innerHTML = table(); await s.tick();
  assert.equal(s.w.document.querySelectorAll('#ubif-plus-columns').length, 1);
});

test('header drag reorders without firing sort and stays attached after refresh', async t => {
  const s = await setup(); t.after(() => (s.w.dispatchEvent(new s.w.Event('pagehide')), s.dom.window.close()));
  const th = s.w.document.querySelector('[data-column-id="woId"]');
  let sorts = 0; th.addEventListener('click', () => sorts++);
  const grip = th.querySelector('[data-ubif-handle="move"]'); grip.click(); assert.equal(sorts,0);
  const transfer = { setData(){}, effectAllowed:'', dropEffect:'' };
  const drag = type => { const e = new s.w.Event(type,{bubbles:true,cancelable:true}); e.dataTransfer = transfer; return e; };
  grip.dispatchEvent(drag('dragstart'));
  const target = s.w.document.querySelector('[data-column-id="nextUpdate"]');
  target.dispatchEvent(drag('dragover')); assert.equal(target.hasAttribute('data-ubif-drop'),true);
  target.dispatchEvent(drag('drop')); await s.tick();
  assert.equal(s.data['ubif-plus.columns.v1.All'].order[0],'woId');
  assert.equal(target.hasAttribute('data-ubif-drop'),false);
  s.w.document.querySelector('tbody').innerHTML = '<tr><td colspan="8">No workorders</td></tr>'; await s.tick();
  assert.equal(s.w.document.querySelectorAll('[data-ubif-handle="move"]').length,columns.length);
});

test('Columns integrates beside Device type without a separate toolbar', async t => {
  const s = await setup(); t.after(() => (s.w.dispatchEvent(new s.w.Event('pagehide')), s.dom.window.close()));
  s.w.document.querySelector('main').innerHTML = '<div><button>Program</button><button id="device-filter">Device type</button></div>' + table(); await s.tick();
  assert.equal(s.w.document.querySelector('#device-filter').nextElementSibling.id,'ubif-plus-columns');
  assert.equal(s.w.document.querySelector('#ubif-plus-columns').hasAttribute('data-inline'),true);
  assert.ok(openColumns(s).querySelector('.search'));
});

test('Columns is a sibling of dropdown wrappers, with no layout shift on save', async t => {
  const s = await setup(); t.after(() => (s.w.dispatchEvent(new s.w.Event('pagehide')), s.dom.window.close()));
  s.w.document.querySelector('main').innerHTML = '<div id="filters" style="display:flex;gap:12px"><div><button>Program</button></div><div id="device-wrapper" style="display:flex;flex-direction:column"><button>Device type</button><div hidden>Menu</div></div></div>' + table(); await s.tick();
  const host = s.w.document.querySelector('#ubif-plus-columns');
  assert.equal(host.parentElement.id,'filters');
  assert.equal(host.previousElementSibling.id,'device-wrapper');
  const ui = openColumns(s); toggled(ui, 'phone').click(); await s.tick();
  assert.equal(ui.querySelector('.save').hasAttribute('data-error'),false);
});

const arrivalsColumns = [['customer','Customer'],['device','Device'],['programType','Program type'],['appointment','Appointment'],['arrivalStatus','Arrival Status']];
test('Arrivals uses its actual columns, owns an independent layout, and survives page switches', async t => {
  const s = await setup(); t.after(() => (s.w.dispatchEvent(new s.w.Event('pagehide')), s.dom.window.close()));
  const workOrderLayout = { order:['woId'], hidden:['created'], widths:{woId:300} };
  s.changed({'ubif-plus.columns.v1.All':{newValue:workOrderLayout}}); await s.tick();
  s.w.history.pushState({},'', '/check-in/arrivals');
  s.w.document.querySelector('main').innerHTML = '<div><button id="add">Add new</button></div>' + table(arrivalsColumns);
  await s.tick();
  const ui = s.shadow(); assert.ok(ui); assert.equal(s.w.document.querySelector('#add').nextElementSibling.id,'ubif-plus-columns');
  const open = openColumns(s);
  assert.equal(open.querySelectorAll('.row').length,5);
  assert.deepEqual(names(open),arrivalsColumns.map(c=>c[1]));
  assert.equal(open.querySelector('.group'), null, 'no workorder groups on Arrivals');
  toggled(open, 'programType').click(); await s.tick();
  assert.deepEqual([...s.data['ubif-plus.columns.v1.arrivals.Arrivals'].hidden],['programType']);
  assert.match(s.shadow().querySelector('.summary').textContent,/Arrivals · 4 of 5/);
  s.w.history.pushState({},'', '/repair/workorders?tab=All');
  s.w.document.querySelector('main').innerHTML = table(); await s.tick();
  assert.match(s.shadow().querySelector('.summary').textContent, new RegExp(`All · 7 of ${COLUMNS.length}`));
  assert.equal(s.data['ubif-plus.columns.v1.All'].widths.woId,300);
});

test('a column the table stops rendering stays listed, ordered and sized', async t => {
  const data = { 'ubif-plus.columns.v1.All':{order:['woId','location','customerName','status','nextUpdate','createdDate','deviceCatalogName','woProgram'],hidden:['location'],widths:{location:360,customerName:260}} };
  const s=await setup(data); t.after(() => (s.w.dispatchEvent(new s.w.Event('pagehide')), s.dom.window.close()));
  const tab=s.w.document.querySelector('[role=tab]'); tab.textContent='All (2)';
  s.w.document.querySelector('main').innerHTML=table(columns.filter(([id])=>id!=='location')); await s.tick();
  let ui = openColumns(s);
  assert.equal(names(ui).length, COLUMNS.length);
  const locationRow = toggled(ui,'location').closest('.row');
  assert.equal(locationRow.querySelector('.tag'), null, 'Location moved to a data column');
  assert.equal(toggled(ui,'location').checked, false);
  button(ui,'Done').click();
  const saved = data['ubif-plus.columns.v1.All'];
  assert.ok(saved.order.includes('location')); assert.ok(saved.hidden.includes('location')); assert.equal(saved.widths.location,360);
  s.w.document.querySelector('main').innerHTML=table(); await s.tick();
  ui = openColumns(s);
  assert.equal(ui.querySelector('[data-focus="location-check"]').closest('.row').querySelector('.tag').textContent, 'table');
  assert.match(s.shadow().querySelector('.summary').textContent, new RegExp(`All · 7 of ${COLUMNS.length}`));
});

test('every tab keeps the portal defaults available exactly once', async t => {
  const s=await setup(); t.after(() => (s.w.dispatchEvent(new s.w.Event('pagehide')), s.dom.window.close()));
  const tab=s.w.document.querySelector('[role=tab]');
  const views=[['All',columns],['Need to order',columns.filter(([id])=>id!=='status')],['Ready to start',columns.filter(([id])=>id!=='woProgram')],['Work started',columns.filter(([id])=>!['status','woProgram','location'].includes(id))],['Waiting',columns.filter(([id])=>id!=='location')],['Ready for pickup',columns.filter(([id])=>id!=='status')]];
  for(const [name,cols] of views){
    tab.textContent=`${name} (1)`; s.w.history.pushState({},'',`?tab=${encodeURIComponent(name)}`); s.w.document.querySelector('main').innerHTML=table(cols); await s.tick();
    const ui = openColumns(s);
    const labels = names(ui);
    assert.equal(labels.length, COLUMNS.length, name);
    assert.equal(new Set(labels).size, COLUMNS.length, `no duplicates on ${name}`);
    for (const label of ['Device/Issue','Status','Program','Location','Total','Customer','WO #']) {
      assert.ok(labels.includes(label), `${label} available on ${name}`);
    }
    for (const [portalId, label] of cols) {
      const row = toggled(ui, s.w.UBIFPlusModel.logicalId(portalId)).closest('.row');
      assert.equal(row.querySelector('.tag').textContent, 'table', `${label} rendered by ${name}`);
    }
    button(ui, 'Done').click();
  }
});

test('presets, search and groups drive the dialog', async t => {
  const s = await setup(); t.after(() => (s.w.dispatchEvent(new s.w.Event('pagehide')), s.dom.window.close()));
  const ui = openColumns(s);
  assert.deepEqual([...ui.querySelectorAll('.preset')].map(b => b.textContent), PRESETS.map(p => p.label));
  assert.deepEqual(GROUPS.slice(0,4), ['Workorder','Program','Customer','Device']);
  const search = ui.querySelector('.search');
  search.value = 'phone';
  search.dispatchEvent(new s.w.Event('input', { bubbles: true }));
  assert.equal(ui.querySelectorAll('.row').length, 1);
  assert.equal(names(ui)[0], 'Phone');
  search.value = 'zzz';
  search.dispatchEvent(new s.w.Event('input', { bubbles: true }));
  assert.match(ui.querySelector('.empty').textContent, /No columns match/);
  search.value = '';
  search.dispatchEvent(new s.w.Event('input', { bubbles: true }));
  ui.querySelector('.preset:nth-child(3)').click(); await s.tick(); // Ops board
  assert.equal(toggled(ui, 'location').checked, true);
  assert.equal(toggled(ui, 'phone').checked, false);
  assert.equal(ui.querySelector('.preset:nth-child(3)').getAttribute('aria-pressed'), 'true');
  assert.match(ui.querySelector('.save').textContent, /Saved/);
});
