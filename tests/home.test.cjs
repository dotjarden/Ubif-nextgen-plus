const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const script = fs.readFileSync(`${__dirname}/../extension/home.js`, 'utf8');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
// Settings answer on a promise, then apply() runs on an animation frame.
const settle = async w => { await wait(10); await new Promise(r => w.requestAnimationFrame(r)); await wait(40); };

const markup = `<!doctype html><body><main>
  <div id="home-row">
    <section id="quick"><h2>Quick actions</h2></section>
    <aside id="calendar"><h3>Arrivals</h3></aside>
    <aside id="notes"><h3>Notes</h3></aside>
  </div></main></body>`;

function boot(t, hideHomeCalendar) {
  const dom = new JSDOM(markup, { url: 'https://portal.ubreakifix.net/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  // The module schedules its work on timers and animation frames; both are kept
  // here so nothing outlives the window.
  const timers = new Set();
  const every = w.setInterval.bind(w);
  w.setInterval = (fn, ms) => { const id = every(fn, ms); timers.add(id); return id; };
  const frames = new Set();
  let frameId = 0;
  w.requestAnimationFrame = cb => {
    const id = ++frameId;
    frames.add(id);
    w.setTimeout(() => { if (frames.delete(id)) cb(Date.now()); }, 0);
    return id;
  };
  w.cancelAnimationFrame = id => frames.delete(id);
  t.after(() => {
    frames.clear();
    for (const id of timers) w.clearInterval(id);
    dom.window.close();
  });
  const listeners = [];
  w.UBIFPlusSettings = {
    get: () => Promise.resolve({ hideHomeCalendar }),
    subscribe: fn => { listeners.push(fn); return () => {}; }
  };
  w.eval(script);
  const marks = () => ({
    calendar: w.document.getElementById('calendar'),
    notes: w.document.getElementById('notes'),
    row: w.document.getElementById('home-row')
  });
  return { w, marks, emit: value => { hideHomeCalendar = value; listeners.forEach(fn => fn({ hideHomeCalendar: value })); } };
}
const hidden = w => w.document.querySelectorAll('[data-ubif-calendar-hidden]');
const rows = w => w.document.querySelectorAll('[data-ubif-calendar-row]');

test('the Arrivals calendar is marked and its rule lets the column take the space', async t => {
  const { w, marks } = boot(t, true);
  await settle(w);
  const { calendar, notes, row } = marks();
  assert.equal(calendar.hasAttribute('data-ubif-calendar-hidden'), true, 'the calendar is hidden, not removed');
  assert.equal(calendar.parentElement, row, 'only the Home column wrapper is touched');
  assert.equal(row.hasAttribute('data-ubif-calendar-row'), true);
  assert.equal(notes.hasAttribute('data-ubif-calendar-hidden'), false, 'only the Arrivals aside');
  const css = w.document.getElementById('ubif-plus-home-style').textContent;
  assert.match(css, /\[data-ubif-calendar-row\]>aside\[data-ubif-calendar-hidden\]\{display:none!important;\}/);
  assert.match(css, /\[data-ubif-calendar-row\]>section\{flex:1 1 auto!important/);
  assert.equal(w.document.querySelectorAll('#ubif-plus-home-style').length, 1, 'one stylesheet');
  assert.equal(w.document.querySelectorAll('#home-row').length, 1, 'the portal markup is untouched');
});

test('the setting works both ways without a reload', async t => {
  const { w, marks, emit } = boot(t, false);
  await settle(w);
  assert.equal(hidden(w).length, 0, 'off by default');
  emit(true); await settle(w);
  assert.equal(hidden(w).length, 1, 'turning it on marks the calendar');
  emit(false); await settle(w);
  assert.equal(hidden(w).length, 0, 'turning it off restores the portal layout');
  assert.equal(rows(w).length, 0);
  assert.equal(marks().calendar.isConnected, true, 'the aside was never removed');
});

test('marks are dropped on other routes and picked up when Home renders late', async t => {
  const { w, marks } = boot(t, true);
  await settle(w);
  assert.equal(hidden(w).length, 1);
  w.history.pushState({}, '', '/repair/workorders');
  w.document.body.append(w.document.createElement('div')); // the observer notices the route change
  await settle(w);
  assert.equal(hidden(w).length, 0, 'the mark does not follow the user off Home');
  // Coming back, the portal renders the calendar after the route does.
  w.history.pushState({}, '', '/');
  const late = w.document.createElement('aside');
  late.innerHTML = '<h3>Arrivals</h3>';
  marks().calendar.remove();
  marks().row.append(late);
  await settle(w);
  assert.equal(late.hasAttribute('data-ubif-calendar-hidden'), true, 'a calendar rendered after the route is still hidden');
  assert.equal(late.parentElement.hasAttribute('data-ubif-calendar-row'), true);
});
