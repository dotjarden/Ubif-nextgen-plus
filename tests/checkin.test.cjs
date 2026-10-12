const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const code = fs.readFileSync(require('node:path').join(__dirname, '../extension/checkin.js'), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture(t, variant = 'additional-details-note', notes = 'Customer reports intermittent charging.') {
  const dom = new JSDOM(`<div data-testid="device-diagnosis-container"><div data-testid="${variant}"><textarea></textarea></div></div>`, { url: 'https://portal.ubreakifix.net/check-in', runScripts: 'outside-only' });
  t.after(() => { dom.window.dispatchEvent(new dom.window.Event('pagehide')); dom.window.close(); });
  const w = dom.window, native = w.document.querySelector('textarea'), changes = [];
  native.value = notes;
  native.__reactProps$test = { onChange: event => changes.push(event.target.value) };
  w.eval(code);
  const root = w.document.querySelector('#ubif-plus-checkin').shadowRoot;
  const set = (key, value) => {
    const control = root.querySelector(`[name="${key}"]`); control.value = value;
    control.dispatchEvent(new w.Event(control.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  };
  return { w, native, root, changes, set };
}
for (const variant of ['additional-details-note', 'DeviceDiagSubIssues_Notes']) {
  test(`${variant}: all fields join existing native notes through Portal handler`, t => {
    const f = fixture(t, variant);
    assert.equal(f.root.querySelectorAll('input,select').length, 8);
    f.set('model', 'iPhone 15'); f.set('color', 'Blue'); f.set('issue', 'Charging port');
    f.set('fmip', 'off'); f.set('accessories', 'yes'); f.set('services', 'no'); f.set('eta', 'unsure'); f.set('price', '$99');
    const saved = f.changes.at(-1);
    assert.match(saved, /^Customer reports intermittent charging\.\n\n\[UBIF Plus check-in\]/);
    for (const text of ['Model: iPhone 15', 'Color: Blue', 'Device Issue: Charging port', 'FMIP: off', 'Accessories Offered: yes', 'Services Offered: no', 'ETA: unsure', 'Price Est: $99']) assert.ok(saved.includes(text));
    f.set('price', '$129');
    assert.equal(f.native.value.split('[UBIF Plus check-in]').length, 2);
    assert.ok(!f.native.value.includes('$99'));
    // Native React callbacks can change on rerender; use current props.
    let latest;
    f.native.__reactProps$test.onChange = e => { latest = e.target.value; };
    f.set('color', 'Black'); assert.match(latest, /Color: Black/);
  });
}
test('reopening diagnosis restores saved fields; new native form starts empty', async t => {
  const f = fixture(t);
  f.set('model', 'Pixel'); f.set('fmip', 'on');
  const saved = f.native.value;
  const container = f.w.document.querySelector('[data-testid="device-diagnosis-container"]');
  container.replaceChildren(); await tick();
  assert.equal(f.w.document.querySelector('#ubif-plus-checkin'), null);
  function remount(value) {
    const native = f.w.document.createElement('textarea'); native.dataset.testid = 'additional-details-note';
    native.value = value; native.__reactProps$test = { onChange() {} }; container.append(native);
  }
  remount(saved); await tick();
  let root = f.w.document.querySelector('#ubif-plus-checkin').shadowRoot;
  assert.equal(root.querySelector('[name=model]').value, 'Pixel');
  assert.equal(root.querySelector('[name=fmip]').value, 'on');
  container.replaceChildren(); await tick(); remount('Different customer'); await tick();
  root = f.w.document.querySelector('#ubif-plus-checkin').shadowRoot;
  assert.equal(root.querySelector('[name=model]').value, '');
  assert.equal(root.querySelector('[name=fmip]').value, '');
});
test('native notes edits preserve custom block and clearing custom fields preserves notes', async t => {
  const f = fixture(t); f.set('model', 'Pixel');
  f.native.value = 'Native notes edited'; f.native.dispatchEvent(new f.w.Event('input', { bubbles: true }));
  await tick(); assert.match(f.changes.at(-1), /^Native notes edited\n\n\[UBIF Plus check-in\]/);
  f.set('model', ''); assert.equal(f.changes.at(-1), 'Native notes edited');
});
test('Notes length limit rejects an entry without silently dropping existing notes', t => {
  const f = fixture(t, 'additional-details-note', 'x'.repeat(1900)); f.set('model', 'Pixel');
  assert.equal(f.changes.length, 0); assert.equal(f.native.value.length, 1900);
  assert.equal(f.root.querySelector('[name=model]').value, '');
  assert.match(f.root.querySelector('[role=status]').textContent, /2,000/);
});
test('unsupported, disabled, ambiguous and non-check-in forms do not write', async t => {
  const f = fixture(t); delete f.native.__reactProps$test.onChange;
  f.set('model', 'Pixel'); assert.equal(f.changes.length, 0);
  f.native.disabled = true; await tick(); assert.ok(f.root.querySelector('[name=model]').disabled);
  f.w.history.pushState({}, '', '/check-in/arrivals');
  f.w.dispatchEvent(new f.w.PopStateEvent('popstate'));
  assert.equal(f.w.document.querySelector('#ubif-plus-checkin'), null);
  f.w.history.pushState({}, '', '/check-in');
  const second = f.w.document.createElement('textarea'); second.dataset.testid = 'DeviceDiagSubIssues_Notes';
  f.w.document.body.append(second); await tick();
  assert.equal(f.w.document.querySelector('#ubif-plus-checkin'), null);
});
test('handler failure keeps native notes intact and reports failure', t => {
  const f = fixture(t); f.native.__reactProps$test.onChange = () => { throw new Error('failed'); };
  f.set('model', 'Pixel'); assert.equal(f.native.value, 'Customer reports intermittent charging.');
  assert.equal(f.root.querySelector('[name=model]').value, '');
  assert.match(f.root.querySelector('[role=status]').textContent, /could not be applied/);
});
test('late-loaded Portal notes hydrate the existing controls and a state reset clears them', async t => {
  const f = fixture(t); f.set('model', 'Saved model');
  const saved = f.native.value;
  f.native.value = saved.replace('Saved model', 'Loaded model');
  f.w.document.body.append(f.w.document.createElement('div')); await tick();
  assert.equal(f.root.querySelector('[name=model]').value, 'Loaded model');
  f.native.value = ''; f.w.document.body.append(f.w.document.createElement('div')); await tick();
  assert.equal(f.root.querySelector('[name=model]').value, '');
});
test('Extra Details precedes the native additional details block', t => {
  const f = fixture(t);
  const host = f.w.document.querySelector('#ubif-plus-checkin');
  assert.equal(f.root.querySelector('h3').textContent, 'Extra Details');
  assert.equal(host.nextElementSibling.dataset.testid, 'additional-details-note');
});
async function withDiagnosis(t, variant, options = {}) {
  const f = fixture(t, variant);
  const parent = f.native.closest('[data-testid="device-diagnosis-container"]');
  const categoryIds = variant === 'additional-details-note' ? ['device-issue-accordion-section-1', 'device-issue-accordion-section-2'] : ['1_Physical', '2_Functional'];
  const row = f.w.document.createElement('div');
  for (const id of categoryIds) { const node = f.w.document.createElement('div'); node.dataset.testid = id; row.append(node); }
  parent.prepend(row);
  let selection = [false, false]; const calls = [];
  const fiber = { memoizedProps: {}, return: null };
  f.native.__reactFiber$test = fiber;
  function render() {
    const snapshot = [...selection];
    fiber.memoizedProps.children = categoryIds.map((id, i) => ({ props: {
      'data-testid': id, header: id, onOpenStateChange() {},
      children: { props: { label: 'No issues', checked: snapshot[i], disabled: options.disabled && i === 1,
        onChange() {
          calls.push(i);
          if (options.fail) throw new Error('Native selection failed');
          setTimeout(() => { selection = snapshot.map((value, index) => index === i ? true : value); render(); }, 5);
        }
      } }
    } }));
  }
  render(); await tick();
  const host = f.w.document.querySelector('#ubif-plus-battery-shortcut');
  assert.ok(host); assert.equal(host.nextElementSibling, row);
  return { ...f, shortcut: host.shadowRoot, calls, selection: () => selection };
}
for (const variant of ['additional-details-note', 'DeviceDiagSubIssues_Notes']) {
  test(`${variant}: battery shortcut updates collapsed categories sequentially and retains Extra Details`, async t => {
    const f = await withDiagnosis(t, variant); f.set('model', 'Pixel'); f.set('issue', 'Battery not working');
    const notes = f.native.value;
    const button = f.shortcut.querySelector('button'); button.click(); button.click();
    for (let i = 0; i < 30 && button.disabled; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(f.selection(), [true, true]); assert.deepEqual(f.calls, [0, 1]);
    assert.equal(f.native.value, notes); assert.equal(f.root.querySelector('[name=issue]').value, 'Battery not working');
    assert.match(f.shortcut.querySelector('[role=status]').textContent, /Extra Details kept/);
    button.click(); await tick(); assert.deepEqual(f.calls, [0, 1], 'already selected options are never toggled off');
  });
}
test('battery shortcut respects disabled native categories and reports native failure', async t => {
  const disabled = await withDiagnosis(t, 'additional-details-note', { disabled: true });
  assert.ok(disabled.shortcut.querySelector('button').disabled); disabled.shortcut.querySelector('button').click();
  assert.deepEqual(disabled.calls, []);
  const failed = await withDiagnosis(t, 'additional-details-note', { fail: true });
  failed.shortcut.querySelector('button').click(); await tick();
  assert.deepEqual(failed.calls, [0]); assert.match(failed.shortcut.querySelector('[role=status]').textContent, /Native selection failed/);
});
