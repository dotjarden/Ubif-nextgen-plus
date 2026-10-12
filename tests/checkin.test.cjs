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
    assert.match(saved, /^Customer reports intermittent charging\.\n\nExtra Details:/);
    for (const text of ['Model: iPhone 15', 'Color: Blue', 'Device Issue: Charging port', 'FMIP: off', 'Accessories Offered: yes', 'Services Offered: no', 'ETA: unsure', 'Price Est: $99']) assert.ok(saved.includes(text));
    f.set('price', '$129');
    assert.equal(f.native.value.split('Extra Details:').length, 2);
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
  await tick(); assert.match(f.changes.at(-1), /^Native notes edited\n\nExtra Details:/);
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
  const categoryIds = Array.from({ length: options.count || 2 }, (_, index) => variant === 'additional-details-note' ? `device-issue-accordion-section-${index + 1}` : `${index + 1}_Category`);
  const row = f.w.document.createElement('div');
  for (const id of categoryIds) { const node = f.w.document.createElement('div'); node.dataset.testid = id; row.append(node); }
  parent.prepend(row);
  let selection = categoryIds.map(() => false), conflicts = categoryIds.map(() => !!options.conflicts), reasons = categoryIds.map(() => ''), opened = categoryIds.map(() => false); const calls = [];
  const nativeContinue = f.w.document.createElement('button'); nativeContinue.dataset.testid = variant === 'additional-details-note' ? 'DeviceDiagIssues_Continue' : 'DeviceDiagSubIssues_Continue'; parent.append(nativeContinue);
  const fiber = { memoizedProps: {}, return: null };
  const committedRoot = { memoizedProps: {}, child: null, sibling: null, return: null };
  committedRoot.stateNode = { current: committedRoot };
  let oldHost;
  f.native.__reactFiber$test = fiber;
  function render() {
    const snapshot = [...selection];
    nativeContinue.disabled = !selection.every(Boolean) || (variant === 'additional-details-note' && reasons.some(reason => reason.replace(/\s/g, '').length < 10)) || f.native.value.replace(/\s/g, '').length < 10;
    const children = categoryIds.map((id, i) => ({ props: {
      'data-testid': id, header: id, isOpen: opened[i], onOpenStateChange() { opened[i] = true; render(); },
      children: [{ props: { label: 'Can’t test', checked: snapshot[i], disabled: options.disabled && i === 1 || conflicts[i],
        onChange() {
          calls.push(i);
          if (options.fail) throw new Error('Native selection failed');
          setTimeout(() => { selection = snapshot.map((value, index) => index === i ? true : value); render(); }, 5);
        }
      } }, ...(options.conflicts ? [{ props: { label: 'Screen damage', checked: conflicts[i], onChange() { calls.push(`clear:${i}`); setTimeout(() => { conflicts[i] = false; render(); }, 5); } } }] : []),
      ...((options.reason || variant === 'additional-details-note') && snapshot[i] && (!options.closedReasons || opened[i]) ? [{ props: { 'data-testid': 'cant-test-label-note', value: reasons[i], onChange(e) { reasons[i] = e.target.value; render(); } } }] : [])]
    } }));
    fiber.memoizedProps.children = options.innerOnly ? children.slice(0, 1) : children;
    if (options.innerOnly) fiber.return = { memoizedProps: { children }, return: null };
    if (options.stalePointer) {
      // A bailed-out DOM pointer retains old props but its reused return pointer
      // reaches the CURRENT root. Swapping one alternate cannot resolve it.
      if (!oldHost) oldHost = { memoizedProps: { children }, return: committedRoot };
      committedRoot.child = { memoizedProps: { children }, return: committedRoot,
        child: { memoizedProps: {}, stateNode: f.native, child: null, sibling: null }, sibling: null };
      f.native.__reactFiber$test = oldHost;
    }
  }
  render(); await tick();
  const host = f.w.document.querySelector('#ubif-plus-battery-shortcut');
  assert.ok(host); assert.equal(host.nextElementSibling, row);
  return { ...f, shortcut: host.shadowRoot, nativeContinue, calls, selection: () => selection, reasons: () => reasons, conflicts: () => conflicts };
}
for (const variant of ['additional-details-note', 'DeviceDiagSubIssues_Notes']) {
  test(`${variant}: battery shortcut updates collapsed categories sequentially and retains Extra Details`, async t => {
    const f = await withDiagnosis(t, variant); f.set('model', 'Pixel'); f.set('issue', 'Battery not working');
    const notes = f.native.value;
    const button = f.shortcut.querySelector('button'); button.click(); button.click();
    for (let i = 0; i < 30 && button.disabled; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(f.selection(), [true, true]); assert.deepEqual(f.calls, [0, 1]);
    assert.equal(f.native.value, notes); assert.equal(f.root.querySelector('[name=issue]').value, 'Battery not working');
    assert.match(f.shortcut.querySelector('[role=status]').textContent, /All 2 diagnosis categories marked Can’t test/);
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
test('legacy branded sections hydrate and migrate to plain Extra Details on edit', t => {
  const legacy = 'Native note\n\n[UBIF Plus check-in]\nModel: Pixel\nColor: Blue\nDevice Issue: Charging\nFMIP: off\nAccessories Offered: yes\nServices Offered: no\nETA: unsure\nPrice Est: $99\n[/UBIF Plus check-in]\nFollow-up note';
  const f = fixture(t, 'additional-details-note', legacy);
  assert.equal(f.root.querySelector('[name=model]').value, 'Pixel');
  f.set('color', 'Black');
  assert.doesNotMatch(f.native.value, /UBIF Plus|\[\/.*check-in\]/);
  assert.match(f.native.value, /Extra Details:\nModel: Pixel\nColor: Black/);
  assert.ok(f.native.value.includes('Native note')); assert.ok(f.native.value.includes('Follow-up note'));
  f.set('price', '$109'); assert.equal(f.native.value.split('Extra Details:').length, 2);
});
test('ordinary notes mentioning Extra Details remain intact', t => {
  const notes = 'Extra Details:\nCustomer says battery is slow.\nModel: customer unsure';
  const f = fixture(t, 'additional-details-note', notes); f.set('model', 'Pixel');
  assert.ok(f.native.value.startsWith(notes + '\n\nExtra Details:\nModel: Pixel'));
  f.set('color', 'Blue'); assert.ok(f.native.value.startsWith(notes));
});
test('battery shortcut leaves Extra Details untouched and sits under diagnosis heading', async t => {
  const f = await withDiagnosis(t, 'additional-details-note');
  const heading = f.w.document.createElement('h3'); heading.dataset.testid = 'device-diagnosis-title'; heading.textContent = 'Device diagnosis';
  // Reopen the same form with a heading to exercise preferred placement.
  const parent = f.native.closest('[data-testid="device-diagnosis-container"]');
  f.w.document.querySelector('#ubif-plus-checkin').remove(); parent.prepend(heading); await tick();
  const shortcutHost = f.w.document.querySelector('#ubif-plus-battery-shortcut');
  assert.equal(heading.nextElementSibling, shortcutHost);
  const root = f.w.document.querySelector('#ubif-plus-checkin').shadowRoot;
  const issue = root.querySelector('[name=issue]'); issue.value = 'Screen cracked'; issue.dispatchEvent(new f.w.Event('input'));
  const button = shortcutHost.shadowRoot.querySelector('button'); button.click();
  for (let i = 0; i < 30 && button.disabled; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(issue.value, 'Screen cracked'); assert.equal(button.getAttribute('aria-pressed'), 'true');
  button.click(); await tick(); assert.equal(issue.value, 'Screen cracked');
  assert.doesNotMatch(f.native.value, /UBIF Plus/);
});
test('battery shortcut never changes Extra Details even when its issue is full or other fields are empty', async t => {
  const f = await withDiagnosis(t, 'additional-details-note'); f.set('issue', 'x'.repeat(400));
  const before = f.native.value, writes = f.changes.length;
  const button = f.shortcut.querySelector('button'); button.click();
  for (let i = 0; i < 100 && button.disabled; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(f.calls, [0, 1]); assert.deepEqual(f.selection(), [true, true]);
  assert.equal(f.native.value, before); assert.equal(f.changes.length, writes);
  assert.equal(f.root.querySelector('[name=issue]').value, 'x'.repeat(400));
  assert.equal(f.root.querySelector('[name=model]').value, '');
  assert.doesNotMatch(f.shortcut.textContent, /Quick diagnosis|Adds the battery issue/);
});
test('battery shortcut clears conflicting native issues then selects Can’t test and fills required reasons', async t => {
  const f = await withDiagnosis(t, 'additional-details-note', { conflicts: true, reason: true });
  const button = f.shortcut.querySelector('button'); assert.equal(button.disabled, false); button.click();
  for (let i = 0; i < 50 && button.disabled; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(f.calls, ['clear:0', 0, 'clear:1', 1]);
  assert.deepEqual(f.conflicts(), [false, false]); assert.deepEqual(f.selection(), [true, true]);
  assert.deepEqual(f.reasons(), ['Unable to test because the battery is not working.', 'Unable to test because the battery is not working.']);
  assert.equal(f.root.querySelector('[name=issue]').value, '');
  button.click(); await tick(); assert.equal(f.calls.length, 4);
});
test('battery shortcut discovers every sibling category beyond the inner Hardware render', async t => {
  const f = await withDiagnosis(t, 'additional-details-note', { count: 5, innerOnly: true, reason: true });
  const button = f.shortcut.querySelector('button'); button.click();
  for (let i = 0; i < 100 && button.disabled; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(f.calls, [0, 1, 2, 3, 4]);
  assert.deepEqual(f.selection(), [true, true, true, true, true]);
  assert.ok(f.reasons().every(reason => reason === 'Unable to test because the battery is not working.'));
  assert.match(f.shortcut.querySelector('[role=status]').textContent, /All 5 diagnosis categories marked Can’t test/);
});
function completeExtra(f) {
  for (const [key, value] of Object.entries({ model: 'Pixel', color: 'Black', issue: 'Battery', fmip: 'off', accessories: 'no', services: 'yes', eta: 'unsure', price: '$99' })) f.set(key, value);
}
for (const [variant, id] of [['additional-details-note', 'DeviceDiagIssues_Continue'], ['DeviceDiagSubIssues_Notes', 'DeviceDiagSubIssues_Continue']]) {
  test(`${variant}: Continue requires every Extra Details field and allows a complete section`, t => {
    const f = fixture(t, variant);
    const button = f.w.document.createElement('button'); button.dataset.testid = id; f.w.document.body.append(button);
    let nativeCalls = 0; button.addEventListener('click', () => nativeCalls++);
    button.click(); assert.equal(nativeCalls, 0);
    assert.match(f.root.querySelector('[role=status]').textContent, /Complete Extra Details: Model, Color, Device Issue, FMIP, Accessories Offered, Services Offered, ETA, Price Est/);
    assert.ok([...f.root.querySelectorAll('input,select')].every(control => control.required));
    completeExtra(f); f.set('color', '   '); button.click(); assert.equal(nativeCalls, 0);
    assert.equal(f.root.querySelector('[name=color]').getAttribute('aria-invalid'), 'true');
    f.set('color', 'Black'); button.click(); assert.equal(nativeCalls, 1);
    f.set('fmip', ''); button.click(); assert.equal(nativeCalls, 1);
    assert.match(f.root.querySelector('[role=status]').textContent, /FMIP/);
  });
}
test('native form submit is blocked until Extra Details is complete; unrelated buttons still work', t => {
  const f = fixture(t); const form = f.w.document.createElement('form');
  const anchor = f.native.closest('[data-testid="additional-details-note"]'); anchor.replaceWith(form); form.append(anchor);
  let submits = 0; form.addEventListener('submit', event => { submits++; event.preventDefault(); });
  form.dispatchEvent(new f.w.Event('submit', { bubbles: true, cancelable: true })); assert.equal(submits, 0);
  completeExtra(f); form.dispatchEvent(new f.w.Event('submit', { bubbles: true, cancelable: true })); assert.equal(submits, 1);
  const back = f.w.document.createElement('button'); let backs = 0; back.addEventListener('click', () => backs++); f.w.document.body.append(back);
  f.set('model', ''); back.click(); assert.equal(backs, 1);
});
test('battery fills collapsed native reason fields and enables native Continue with completed Extra Details', async t => {
  const f = await withDiagnosis(t, 'additional-details-note', { count: 5, innerOnly: true, closedReasons: true });
  completeExtra(f); const before = f.native.value, writes = f.changes.length;
  assert.equal(f.nativeContinue.disabled, true);
  const button = f.shortcut.querySelector('button'); button.click();
  for (let i = 0; i < 120 && button.disabled; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(f.selection(), [true, true, true, true, true]);
  assert.ok(f.reasons().every(reason => reason === 'Unable to test because the battery is not working.'));
  assert.equal(f.native.value, before); assert.equal(f.changes.length, writes);
  assert.equal(f.nativeContinue.disabled, false);
  let continued = 0; f.nativeContinue.addEventListener('click', () => continued++);
  f.nativeContinue.click(); assert.equal(continued, 1);
});
test('already-applied complete Extra Details does not block Continue merely because native notes are read-only', t => {
  const f = fixture(t); completeExtra(f); f.native.readOnly = true;
  const button = f.w.document.createElement('button'); button.dataset.testid = 'DeviceDiagIssues_Continue'; f.w.document.body.append(button);
  let continued = 0; button.addEventListener('click', () => continued++); button.click(); assert.equal(continued, 1);
});
test('a reused DOM fiber pointing at the current root must resolve committed checkbox and reason props', async t => {
  const f = await withDiagnosis(t, 'additional-details-note', { count: 3, stalePointer: true, closedReasons: true });
  completeExtra(f); const notes = f.native.value;
  const button = f.shortcut.querySelector('button'); button.click();
  for (let i = 0; i < 120 && button.disabled; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(f.selection(), [true, true, true]);
  assert.ok(f.reasons().every(reason => reason === 'Unable to test because the battery is not working.'));
  assert.equal(f.nativeContinue.disabled, false); assert.equal(f.native.value, notes);
  assert.match(f.shortcut.querySelector('[role=status]').textContent, /All 3 diagnosis categories marked Can’t test/);
});
