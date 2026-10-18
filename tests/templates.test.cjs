const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');

const read = name => fs.readFileSync(`${__dirname}/../extension/${name}`, 'utf8');
const settingsScript = read('settings.js');
const templatesScript = read('note-templates.js');
const hotkeyModel = read('hotkey-model.js');
const pickerScript = read('note-picker.js');
const hotkeysScript = read('hotkeys.js');
const optionsScripts = ['settings.js', 'note-templates.js', 'hotkey-model.js', 'message-model.js', 'message-ui.js', 'whats-new.js', 'settings-ui.js', 'options.js', 'settings-editors.js'].map(read);
const optionsHtml = read('options.html');
const manifest = JSON.parse(read('manifest.json'));
const SETTINGS = 'ubif-plus.settings.v1';
const TEMPLATES = 'ubif-plus.note-templates.v1';
const HOTKEYS = 'ubif-plus.hotkeys.v1';
const tick = (w, ms = 40) => new Promise(resolve => w.setTimeout(resolve, ms));
const plain = value => JSON.parse(JSON.stringify(value));

function storage(w, stored = {}) {
  const data = JSON.parse(JSON.stringify(stored));
  const listeners = [];
  w.chrome = {
    runtime: { getManifest: () => ({ version: 'test' }) },
    storage: {
      local: {
        get: key => Promise.resolve(key == null ? plain(data) : key in data ? { [key]: plain(data[key]) } : {}),
        set: object => {
          Object.assign(data, plain(object));
          for (const [key, value] of Object.entries(object)) listeners.forEach(fn => fn({ [key]: { newValue: plain(value) } }, 'local'));
          return Promise.resolve();
        }
      },
      onChanged: { addListener: fn => listeners.push(fn), removeListener: fn => listeners.splice(listeners.indexOf(fn), 1) }
    }
  };
  return data;
}

function portal(markup, stored = {}, url = 'https://portal.ubreakifix.net/repair/workorder/500089742') {
  const dom = new JSDOM(`<!doctype html><body>${markup}</body>`, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  const data = storage(w, stored);
  for (const script of [settingsScript, templatesScript, hotkeyModel, pickerScript, hotkeysScript]) w.eval(script);
  return { dom, w, data, doc: w.document };
}
const picker = (doc, where = 'notes') => doc.querySelector(`[data-ubif-note-templates="${where}"]`)?.shadowRoot;
const choose = async (w, root, id) => {
  root.querySelector('.open').click();
  await tick(w, 10);
  root.querySelector(`[data-template="${id}"]`).click();
  await tick(w, 10);
};
const notesMarkup = '<main><div class="field"><label for="n">Notes</label><textarea id="n" data-testid="notes-input" maxlength="2000"></textarea><button>Add note</button></div></main>';
const checkinMarkup = '<div class="wrap"><label>Additional Details</label><textarea data-testid="additional-details-note" maxlength="2000"></textarea></div>';

test('the template scripts load on Portal pages and in settings, in dependency order', () => {
  const idle = manifest.content_scripts.find(entry => entry.js.includes('note-picker.js')).js;
  for (const [before, after] of [['note-templates.js', 'hotkey-model.js'], ['hotkey-model.js', 'note-picker.js'], ['note-picker.js', 'hotkeys.js'], ['hotkeys.js', 'samsung.js']]) {
    assert.ok(idle.indexOf(before) < idle.indexOf(after), `${before} before ${after}`);
  }
});

test('fourteen templates in three groups, editable and restorable', async t => {
  const dom = new JSDOM('<!doctype html>', { url: 'https://portal.ubreakifix.net/', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window, data = storage(w);
  w.eval(templatesScript);
  const T = w.UBIFPlusNoteTemplates;
  await T.load();
  const counts = Object.fromEntries(T.GROUPS.map(g => [g.id, T.list().filter(t => t.group === g.id).length]));
  assert.deepEqual(counts, { status: 8, leads: 2, checkin: 4 });
  assert.match(T.get('awaitingDiagPriceQuote').text, /Quote With ATC/);
  assert.doesNotMatch(T.get('multiday').text, /<br>|resotre|specificy/, 'plain text, typos fixed');
  await T.save('awaitingDiag', 'Awaiting Diag:\n• Custom line');
  assert.equal(T.get('awaitingDiag').edited, true);
  assert.deepEqual(plain(data[TEMPLATES].overrides), { awaitingDiag: 'Awaiting Diag:\n• Custom line' });
  await T.reset('awaitingDiag');
  assert.equal(T.get('awaitingDiag').edited, false);
  assert.deepEqual(plain(data[TEMPLATES].overrides), {});
  assert.deepEqual(plain(T.sanitize({ overrides: { nope: 'x', qualityInspection: '   ', declinedRFP: 'ok' } })), { declinedRFP: 'ok' });
});

test('templates are added beside existing text, never over it', () => {
  const dom = new JSDOM('<!doctype html>', { runScripts: 'outside-only' });
  dom.window.eval(templatesScript);
  const { combine } = dom.window.UBIFPlusNoteTemplates;
  assert.deepEqual(plain(combine('', 'T')), { value: 'T', caret: 1 });
  assert.deepEqual(plain(combine('Called customer.', 'T')), { value: 'Called customer.\n\nT', caret: 19 });
  assert.equal(combine('Extra Details:\nModel: S21', 'T', { at: 'start' }).value, 'T\n\nExtra Details:\nModel: S21');
  assert.equal(combine('Before after', 'T', { start: 7, end: 7 }).value, 'Before \n\nT\n\nafter');
  assert.equal(combine('Line\n', 'T').value, 'Line\n\nT');
  assert.equal(combine('Replace me', 'T', { start: 0, end: 10 }).value, 'T', 'a selection is replaced, as typing would');
});

test('a Note templates button appears under work-order notes and inserts at the end', async t => {
  const page = portal(notesMarkup);
  t.after(() => page.dom.window.close());
  await page.w.UBIFPlusSettings.get(); await tick(page.w);
  const root = picker(page.doc);
  assert.ok(root, 'button added');
  assert.equal(page.doc.querySelector('[data-ubif-note-templates]').previousElementSibling.className, 'field', 'below the whole field, not inside it');
  root.querySelector('.open').click(); await tick(page.w, 10);
  const groups = [...root.querySelectorAll('h3')].map(h => h.textContent);
  assert.deepEqual(groups, ['Status notes', 'Lead notes'], 'no check-in templates in work-order notes');
  root.querySelector('.search').value = 'callback';
  root.querySelector('.search').dispatchEvent(new page.w.Event('input'));
  assert.deepEqual([...root.querySelectorAll('.item strong')].map(n => n.textContent), ['Awaiting Callback/Device']);
  root.querySelector('.open').click();

  const area = page.doc.querySelector('textarea');
  let events = 0; area.addEventListener('input', () => events++);
  area.value = 'Customer called.';
  await choose(page.w, root, 'qualityInspection');
  assert.match(area.value, /^Customer called\.\n\nQuality Inspection:\n• Repair Summary:/);
  assert.equal(events, 1, 'Portal hears an input event');
  assert.match(root.querySelector('.status').textContent, /Inserted Quality Inspection/);
});

test('check-in templates go above existing notes so Extra Details stays last', async t => {
  const page = portal(checkinMarkup, {}, 'https://portal.ubreakifix.net/check-in');
  t.after(() => page.dom.window.close());
  await tick(page.w);
  const root = picker(page.doc, 'checkin');
  assert.ok(root);
  const area = page.doc.querySelector('textarea');
  area.value = 'Extra Details:\nModel: S21';
  await choose(page.w, root, 'insurance');
  assert.match(area.value, /^Insurance Mobile Device Notes:\n[\s\S]*\n\nExtra Details:\nModel: S21$/);
});

test('the caret position is used once the technician has placed it', async t => {
  const page = portal(notesMarkup);
  t.after(() => page.dom.window.close());
  await tick(page.w);
  const area = page.doc.querySelector('textarea');
  area.value = 'First. Second.';
  area.setSelectionRange(7, 7);
  area.dispatchEvent(new page.w.Event('mouseup'));
  await choose(page.w, picker(page.doc), 'leadNotContacted');
  assert.match(area.value, /^First\. \n\nLead Template \(Customer NOT Contacted\):[\s\S]*\n\nSecond\.$/);
});

test('a template that would pass the notes limit is refused', async t => {
  const page = portal(notesMarkup);
  t.after(() => page.dom.window.close());
  await tick(page.w);
  const area = page.doc.querySelector('textarea');
  area.value = 'x'.repeat(1990);
  await choose(page.w, picker(page.doc), 'repairedRFP');
  assert.equal(area.value, 'x'.repeat(1990));
  assert.match(picker(page.doc).querySelector('.status').textContent, /does not fit/);
});

test('edited wording is used, and each switch removes its buttons', async t => {
  const page = portal(notesMarkup + checkinMarkup, { [TEMPLATES]: { version: 1, overrides: { awaitingDiag: 'My diag template' } } });
  t.after(() => page.dom.window.close());
  await tick(page.w);
  await choose(page.w, picker(page.doc), 'awaitingDiag');
  assert.equal(page.doc.querySelector('[data-testid="notes-input"]').value, 'My diag template');
  await page.w.UBIFPlusSettings.set({ noteTemplates: false });
  await tick(page.w);
  assert.equal(picker(page.doc), undefined);
  assert.ok(picker(page.doc, 'checkin'), 'check-in templates have their own switch');
  await page.w.UBIFPlusSettings.set({ noteTemplatesCheckin: false });
  await tick(page.w);
  assert.equal(picker(page.doc, 'checkin'), undefined);
});

test('fields rendered later, and the Update Today note, get the button too', async t => {
  const page = portal('<main id="root"></main>');
  t.after(() => page.dom.window.close());
  await tick(page.w);
  page.doc.getElementById('root').innerHTML = '<div data-testid="notes-area-text-field"><textarea></textarea></div>';
  await tick(page.w);
  assert.ok(picker(page.doc), 'Portal status-change notes');
  const host = page.doc.createElement('div');
  const shadow = host.attachShadow({ mode: 'open' });
  const label = page.doc.createElement('label'); const area = page.doc.createElement('textarea');
  label.append(area); shadow.append(label); page.doc.body.append(host);
  page.w.UBIFPlusNotePicker.attach(area, 'notes', label);
  assert.equal(label.nextElementSibling?.getAttribute('data-ubif-note-templates'), 'notes');
});

test('shortcut combinations are read from the physical key and checked', () => {
  const dom = new JSDOM('<!doctype html>', { runScripts: 'outside-only' });
  dom.window.eval(templatesScript); dom.window.eval(hotkeyModel);
  const H = dom.window.UBIFPlusHotkeys;
  assert.equal(H.fromEvent({ code: 'KeyG', altKey: true, key: '©' }), 'alt+g', 'Option+G on a Mac');
  assert.equal(H.fromEvent({ code: 'Digit3', ctrlKey: true, shiftKey: true }), 'ctrl+shift+3');
  assert.equal(H.fromEvent({ code: 'ShiftLeft', shiftKey: true }), '', 'modifier alone');
  assert.equal(H.normalize('Shift+ALT+g'), 'alt+shift+g');
  assert.match(H.problem('shift+g'), /Ctrl, Alt/);
  assert.match(H.problem('meta+k'), /universal search/);
  assert.match(H.problem('ctrl+c'), /browser/);
  assert.match(H.problem('ctrl+shift+t'), /browser/);
  assert.equal(H.problem('ctrl+alt+g'), '');
  assert.equal(H.problem('alt+shift+1'), '');
  assert.deepEqual(plain(H.sanitize({ 'template.awaitingDiag': 'alt+d', 'template.oop': 'ALT+D', 'samsung.gd': 'ctrl+c', nope: 'alt+n' })), { 'template.awaitingDiag': 'alt+d' });
  const ids = H.actions().map(a => a.id);
  assert.equal(ids.length, 18);
  assert.ok(ids.includes('darkMode.toggle') && ids.includes('samsung.wer') && ids.includes('template.oop'));
});

test('a bound shortcut inserts into the notes field in use, even while typing', async t => {
  const page = portal(notesMarkup, { [HOTKEYS]: { 'template.awaitingCallback': 'alt+c', 'darkMode.toggle': 'ctrl+alt+d' } });
  t.after(() => page.dom.window.close());
  await tick(page.w);
  const area = page.doc.querySelector('textarea');
  area.focus();
  const press = (code, mods) => { const event = new page.w.KeyboardEvent('keydown', { code, key: 'x', bubbles: true, cancelable: true, ...mods }); area.dispatchEvent(event); return event; };
  const event = press('KeyC', { altKey: true });
  assert.equal(event.defaultPrevented, true);
  assert.match(area.value, /^Awaiting Callback\/Device:/);
  assert.equal(press('KeyC', { ctrlKey: true }).defaultPrevented, false, 'unbound keys pass through');
  press('KeyD', { ctrlKey: true, altKey: true });
  await tick(page.w);
  assert.equal((await page.w.UBIFPlusSettings.get()).darkMode, true, 'dark mode toggled');
  await page.w.UBIFPlusSettings.set({ hotkeys: false });
  await tick(page.w);
  assert.equal(press('KeyC', { altKey: true }).defaultPrevented, false, 'switch turns shortcuts off');
});

test('a template shortcut with no notes field says what to do', async t => {
  const page = portal('<main></main>', { [HOTKEYS]: { 'template.oop': 'alt+o' } });
  t.after(() => page.dom.window.close());
  await tick(page.w);
  page.doc.body.dispatchEvent(new page.w.KeyboardEvent('keydown', { code: 'KeyO', altKey: true, bubbles: true }));
  assert.match(page.doc.querySelector('[data-ubif-note-toast]').textContent, /check-in notes first/);
});

test('settings edit template wording and record shortcuts by pressing them', async t => {
  const dom = new JSDOM(optionsHtml, { url: 'chrome-extension://abcdef/options.html#templates/notes', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window, doc = w.document;
  const data = storage(w, { [HOTKEYS]: { 'samsung.gd': 'alt+g' } });
  for (const script of optionsScripts) w.eval(script);
  await tick(w);
  assert.equal(doc.getElementById('templates-notes').hidden, false, 'deep link opens the Notes tab');

  const editor = doc.getElementById('template-editor');
  assert.equal(editor.querySelectorAll('details').length, 8, 'status group first');
  editor.querySelector('[data-group="checkin"]').click();
  assert.equal(editor.querySelectorAll('details').length, 4);
  const area = editor.querySelector('textarea[data-template="oop"]');
  area.value = 'OOP notes:\nCustom';
  area.dispatchEvent(new w.Event('input'));
  await tick(w, 500);
  assert.equal(data[TEMPLATES].overrides.oop, 'OOP notes:\nCustom');
  editor.querySelector('details[data-id="oop"] .tools .grow').click();
  await tick(w);
  assert.equal('oop' in data[TEMPLATES].overrides, false, 'restored');
  // Each template offers its shortcut; it opens the recorder already listening.
  editor.querySelector('[data-group="status"]').click();
  const set = [...editor.querySelectorAll('details[data-id="awaitingDiag"] .tools button')].find(b => /Set shortcut/.test(b.textContent));
  set.click();
  assert.equal(doc.getElementById('group-general').hidden, false, 'jumps to the shortcuts card');
  assert.equal(doc.querySelector('#hotkey-editor [data-action="template.awaitingDiag"]').textContent, 'Press keys…');
  doc.body.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  const keys = doc.getElementById('hotkey-editor');
  const key = id => keys.querySelector(`[data-action="${id}"]`);
  assert.notEqual(key('samsung.gd').textContent, 'Not set');
  key('template.awaitingDiag').click();
  assert.equal(key('template.awaitingDiag').textContent, 'Press keys…');
  // Key presses are read at the document, wherever focus is.
  const press = (id, code, mods) => doc.body.dispatchEvent(new w.KeyboardEvent('keydown', { code, key: 'x', bubbles: true, cancelable: true, ...mods }));
  press('template.awaitingDiag', 'KeyG', { altKey: true });
  assert.match(keys.querySelector('.row-note').textContent, /already used by GD Bypass/, 'shown on the row being recorded');
  press('template.awaitingDiag', 'KeyC', { ctrlKey: true });
  assert.match(keys.querySelector('.row-note').textContent, /browser/);
  assert.equal(key('template.awaitingDiag').textContent, 'Press keys…', 'still recording after a refused combination');
  press('template.awaitingDiag', 'KeyD', { altKey: true, shiftKey: true });
  await tick(w);
  assert.equal(data[HOTKEYS]['template.awaitingDiag'], 'alt+shift+d');
  key('samsung.gd').click();
  press('samsung.gd', 'Backspace', { key: 'Backspace' });
  await tick(w);
  assert.equal('samsung.gd' in data[HOTKEYS], false, 'Backspace clears');
});

test('a notes box without Portal test ids is still found by its name', async t => {
  const page = portal('<main><div class="wrap"><label for="x">Notes</label><textarea id="x"></textarea></div><div><textarea aria-label="Send message"></textarea></div></main>');
  t.after(() => page.dom.window.close());
  await tick(page.w);
  assert.equal(page.doc.querySelectorAll('[data-ubif-note-templates="notes"]').length, 1, 'notes yes, chat composer no');
  const other = portal('<main><label for="y">Notes</label><textarea id="y"></textarea></main>', {}, 'https://portal.ubreakifix.net/repair/workorders');
  t.after(() => other.dom.window.close());
  await tick(other.w);
  assert.equal(other.doc.querySelector('[data-ubif-note-templates]'), null, 'only on work order and check-in pages');
});
