const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const supportScript = fs.readFileSync(`${__dirname}/../extension/support.js`, 'utf8');
const settingsScript = fs.readFileSync(`${__dirname}/../extension/settings.js`, 'utf8');
const manifest = JSON.parse(fs.readFileSync(`${__dirname}/../extension/manifest.json`, 'utf8'));
const KEY = 'ubif-plus.settings.v1';
const POS_KEY = 'ubif-plus.support.v1';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
// Settings answer on a promise, then apply() runs on an animation frame.
const settle = async w => { await wait(10); await new Promise(r => w.requestAnimationFrame(r)); await wait(30); };

/* The widget markup as the portal and the Amazon Connect client render it: a
   fixed container the portal anchors with top/left, the chat frame inside it,
   and the close button the portal hides. */
const markup = `<!doctype html><body>
  <header><button data-chat-launch-button>UBIF Support</button></header>
  <div id="single-spa-application:@ubif/check-in"><a href="/repair/workorder/30787644">order</a></div>
  <div id="amazon-connect-chat-widget">
    <div class="acWidgetContainer-0-0-16" style="top:69px;left:100px">
      <div id="amazon-connect-widget-frame" class="acFrameContainer-0-0-20 show medium">
        <iframe id="amazon-connect-chat-widget-iframe" title="Chat Widget"></iframe>
      </div>
      <button id="amazon-connect-close-widget-button" style="display:none">minimize</button>
    </div>
  </div>
</body>`;

/* chrome.storage.local stand-in with recorded writes, so both the settings
   record and the saved panel position can be inspected. chrome.runtime is
   stubbed too: the chat's badge and desktop notes travel through it. */
function storage(w, stored = {}) {
  const data = JSON.parse(JSON.stringify(stored));
  const listeners = [];
  const writes = [];
  const sends = [];
  w.chrome = {
    storage: {
      local: {
        get: key => Promise.resolve(key == null ? JSON.parse(JSON.stringify(data)) : (key in data ? { [key]: data[key] } : {})),
        set: object => { writes.push(JSON.parse(JSON.stringify(object))); Object.assign(data, object); return Promise.resolve(); },
        remove: key => { delete data[key]; writes.push({ [key]: undefined }); return Promise.resolve(); }
      },
      onChanged: { addListener: listener => listeners.push(listener) }
    },
    runtime: {
      sendMessage: payload => { sends.push(JSON.parse(JSON.stringify(payload))); return Promise.resolve(true); }
    }
  };
  return {
    data, writes, sends,
    changed: (value, area = 'local', key = KEY) => listeners.forEach(listener => listener({ [key]: { newValue: value } }, area))
  };
}

function boot(t, { support = true, stored = {}, raf = true, session = {} } = {}) {
  const dom = new JSDOM(markup, { url: 'https://portal.ubreakifix.net/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  // Attention decides whether a message is announced or silently displayed.
  w.document.hasFocus = () => true;
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
  if (!raf) w.requestAnimationFrame = () => 0; // as in a tab Chrome considers hidden
  t.after(() => { frames.clear(); for (const id of timers) w.clearInterval(id); dom.window.close(); });
  const s = storage(w, { [KEY]: { support }, ...stored });
  const button = w.document.querySelector('[data-chat-launch-button]');
  button.getBoundingClientRect = () => ({ left: 100, right: 200, top: 12, bottom: 44, width: 100, height: 32, x: 100, y: 12 });
  const panel = w.document.querySelector('.acWidgetContainer-0-0-16');
  panel.getBoundingClientRect = () => ({ left: 100, top: 69, width: 300, height: 480, right: 400, bottom: 549, x: 100, y: 69 });
  for (const [key, value] of Object.entries(session)) w.sessionStorage.setItem(key, value);
  w.eval(settingsScript);
  w.eval(supportScript);
  const marks = () => ({
    panel: w.document.querySelector('.acWidgetContainer-0-0-16'),
    frame: w.document.getElementById('amazon-connect-widget-frame'),
    grip: w.document.querySelector('.ubif-plus-chat-grip'),
    style: w.document.getElementById('ubif-plus-support-style')
  });
  const position = node => ({
    left: node.style.getPropertyValue('--ubif-plus-chat-left'),
    top: node.style.getPropertyValue('--ubif-plus-chat-top')
  });
  return { w, s, sends: s.sends, marks, position, emit: value => s.changed({ support: value }) };
}
// A gesture starts on the grip and its moves bubble to the window, exactly as
// they do in the browser.
const pointer = (w, type, x, y) => {
  const target = w.document.querySelector('.ubif-plus-chat-grip') || w;
  target.dispatchEvent(new w.MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }));
};

test('the panel is shrunk to the chat so the page underneath stays clickable', async t => {
  const { w, marks, position } = boot(t);
  await settle(w);
  const { panel, grip, style } = marks();
  assert.ok(style, 'the rule set is in place before the widget opens');
  const css = style.textContent;
  assert.match(css, /\.amazon-connect-widget-parent\{width:max-content!important;height:max-content!important;\s*bottom:auto!important;right:auto!important;pointer-events:none!important\}/,
    'the stretched container collapses to the chat and stops swallowing clicks');
  assert.match(css, /\.amazon-connect-widget-parent>\*\{pointer-events:auto!important\}/, 'the chat itself stays interactive');
  assert.match(css, /\.ubif-plus-chat-panel\{top:var\(--ubif-plus-chat-top\)!important;left:var\(--ubif-plus-chat-left\)!important/,
    'our own position beats the portal\'s inline anchor writes');
  assert.equal(panel.classList.contains('ubif-plus-chat-panel'), true, 'the panel is placed by us');
  assert.deepEqual(position(panel), { left: '100px', top: '69px' }, 'anchored below the UBIF Support button');
  assert.ok(grip, 'a drag bar was added to the frame');
  assert.equal(grip.getAttribute('aria-label'), 'Move the UBIF support chat');
  assert.equal(grip.tabIndex, 0, 'reachable without a pointer');
  assert.match(css, /#amazon-connect-widget-frame:not\(\.x-large\):not\(\.mobile\)\{position:relative!important;padding-top:26px!important\}/,
    'the bar sits in padding above the chat frame, and the vendor\'s fullscreen layout is untouched');
  assert.equal(marks().frame.getAttribute('style'), null, 'the frame keeps its own layout');
});

test('the portal cannot drag a moved panel back under the header', async t => {
  const { w, marks, position, emit } = boot(t);
  await settle(w);
  const { panel } = marks();
  pointer(w, 'pointerdown', 150, 100);
  pointer(w, 'pointermove', 190, 140);
  pointer(w, 'pointerup', 190, 140);
  assert.deepEqual(position(panel), { left: '140px', top: '109px' }, 'dragged by the pointer delta');
  // The portal re-anchors on every DOM change during a conversation.
  panel.style.setProperty('top', '999px');
  panel.style.setProperty('left', '5px');
  w.document.body.append(w.document.createElement('div'));
  await settle(w);
  assert.deepEqual(position(panel), { left: '140px', top: '109px' }, 'our values survive the portal re-anchor');
  assert.equal(panel.classList.contains('ubif-plus-chat-panel'), true);
  assert.equal(marks().frame.querySelector('.ubif-plus-chat-grip'), marks().grip, 'exactly one grip, inside the frame');
  emit(false);
  await settle(w);
  assert.equal(panel.classList.contains('ubif-plus-chat-panel'), false, 'switching the feature off hands the panel back');
});

test('the page is released from the widget\'s inert background', async t => {
  const { w, marks } = boot(t);
  const app = w.document.getElementById('single-spa-application:@ubif/check-in');
  const other = w.document.createElement('div');
  w.document.body.append(other);
  // Fullscreen mode marks every body container but the widget itself inert.
  for (const node of [app, other]) { node.setAttribute('inert', ''); node.setAttribute('data-amazon-connect-inert', ''); }
  marks().panel.setAttribute('aria-modal', 'true');
  await settle(w);
  assert.equal(app.hasAttribute('inert'), false, 'the portal app is usable again');
  assert.equal(other.hasAttribute('data-amazon-connect-inert'), false);
  assert.equal(marks().panel.hasAttribute('aria-modal'), false, 'the chat is no longer claimed as modal');
  assert.equal(app.isConnected, true, 'containers are never removed');
  assert.equal(w.document.getElementById('amazon-connect-widget-frame'), marks().frame, 'the conversation is untouched');
});

test('the panel is movable with the keyboard and snaps back on Enter', async t => {
  const { w, marks, position } = boot(t);
  await settle(w);
  const grip = marks().grip;
  const press = key => grip.dispatchEvent(new w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  press('ArrowRight');
  assert.deepEqual(position(marks().panel), { left: '116px', top: '69px' });
  press('ArrowDown');
  assert.deepEqual(position(marks().panel), { left: '116px', top: '85px' });
  press('Enter');
  assert.deepEqual(position(marks().panel), { left: '100px', top: '69px' }, 'Enter re-anchors it under UBIF Support');
  await settle(w);
  assert.equal(w.document.querySelector('.ubif-plus-chat-grip'), grip, 'the grip survives the move');
});

test('where the panel was dropped is remembered, and off-screen drops are pulled back', async t => {
  const bootWith = (position, options) => boot(t, { ...options, stored: { [POS_KEY]: position } });
  const first = bootWith({ left: 500, top: 300 });
  await settle(first.w);
  pointer(first.w, 'pointerdown', 550, 350);
  pointer(first.w, 'pointermove', 600, 400);
  pointer(first.w, 'pointerup', 600, 400);
  assert.deepEqual(first.s.writes.at(-1)[POS_KEY], { left: 550, top: 350 }, 'written on release');
  assert.deepEqual(first.position(first.marks().panel), { left: '550px', top: '350px' });

  const second = bootWith({ left: 5000, top: -60 });
  await settle(second.w);
  // jsdom's window is 1024x768; the panel is 300x480.
  assert.deepEqual(second.position(second.marks().panel), { left: '984px', top: '0px' }, 'clamped into view on load');
  assert.ok(second.marks().grip, 'the widget stays wired after a clamped load');
  pointer(second.w, 'pointerdown', 500, 10);
  pointer(second.w, 'pointermove', 480, 40);
  pointer(second.w, 'pointerup', 480, 40);
  assert.deepEqual(second.position(second.marks().panel), { left: '964px', top: '30px' }, 'the drag continues from the clamped position');
});

test('the feature follows its setting and survives a widget relaunch', async t => {
  const { w, marks, emit } = boot(t, { support: false });
  await settle(w);
  assert.equal(marks().style, null, 'off: the portal keeps its own behavior');
  assert.equal(marks().grip, null);
  assert.equal(marks().panel.classList.contains('ubif-plus-chat-panel'), false);
  emit(true);
  await settle(w);
  assert.ok(marks().style, 'switching on needs no reload');
  assert.ok(marks().grip);
  // Relaunching the chat replaces the frame React owns; the grip follows it.
  const frame = marks().frame;
  const replacement = frame.cloneNode(false);
  frame.replaceWith(replacement);
  await settle(w);
  assert.equal(marks().frame, replacement);
  assert.ok(replacement.querySelector('.ubif-plus-chat-grip'), 'the grip is re-added to the new frame');
  assert.equal(w.document.querySelectorAll('.ubif-plus-chat-grip').length, 1, 'never a second one');
  emit(false);
  await settle(w);
  assert.equal(marks().style, null, 'off again: grips and marks are cleared');
  assert.equal(marks().grip, null);
  assert.equal(marks().panel.classList.contains('ubif-plus-chat-panel'), false);
});

test('the chat can be minimized without dropping the conversation', async t => {
  const { w, marks } = boot(t);
  await settle(w);
  const frame = marks().frame;
  const iframe = frame.querySelector('iframe');
  const transcript = iframe.contentDocument;
  const grip = marks().grip;
  const min = frame.querySelector('.ubif-plus-chat-min');
  assert.ok(min, 'the grip carries a minimize button');
  min.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(frame.style.display, 'none', 'the frame is hidden in place');
  assert.equal(frame.classList.contains('show'), false, 'hidden the way the portal hides it');
  assert.equal(frame.isConnected, true, 'the frame stays mounted');
  assert.strictEqual(frame.querySelector('iframe'), iframe, 'same iframe: the conversation survives');
  assert.strictEqual(iframe.contentDocument, transcript, 'the transcript document is untouched');
  assert.strictEqual(frame.querySelector('.ubif-plus-chat-grip'), grip, 'the grip hides with the chat, not away from it');
  // Coming back runs through the portal's own launcher path.
  const button = w.document.querySelector('[data-chat-launch-button]');
  button.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(frame.style.display, 'block', 'clicking UBIF Support brings the chat back');
  assert.equal(frame.classList.contains('show'), true);
  assert.strictEqual(frame.querySelector('iframe'), iframe, 'still the same conversation');
});

test('messages that arrive while the chat is hidden become a badge and a desktop note', async t => {
  const { w, marks, sends } = boot(t);
  await settle(w);
  const frame = marks().frame;
  const doc = frame.querySelector('iframe').contentDocument;
  assert.ok(doc && doc.body, 'the widget frame is same-origin, so the transcript is readable');
  const arrive = text => {
    const row = w.document.createElement('div');
    row.setAttribute('data-testid', 'message-container');
    row.textContent = text;
    doc.body.append(row);
  };
  // Chat in front and window focused: the user is already reading it.
  arrive('We have the part in stock');
  await wait(20);
  const badge = w.document.querySelector('.ubif-plus-chat-badge');
  assert.ok(badge, 'the launcher carries the badge element');
  assert.equal(badge.classList.contains('ubif-plus-chat-badge-on'), false, 'a visible chat stays silent');
  assert.equal(sends.length, 0, 'no desktop note while the user is watching');

  frame.style.display = 'none';
  frame.classList.remove('show');
  arrive('Your repair is ready for pickup');
  await wait(20);
  assert.equal(badge.classList.contains('ubif-plus-chat-badge-on'), true, 'a hidden chat lights the badge');
  assert.equal(badge.textContent, '1');
  assert.deepEqual(sends.at(-1), { type: 'ubif-plus-chat-message', text: 'Your repair is ready for pickup', unread: 1, desktop: true, badge: true },
    'the background worker gets the message text');

  const button = w.document.querySelector('[data-chat-launch-button]');
  button.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(badge.classList.contains('ubif-plus-chat-badge-on'), false, 'coming back clears the badge');
  assert.equal(badge.textContent, '');
  assert.deepEqual(sends.at(-1), { type: 'ubif-plus-chat-seen' }, 'and withdraws the desktop note');
});

test('the background worker turns chat messages into desktop notifications', () => {
  const background = fs.readFileSync(`${__dirname}/../extension/background.js`, 'utf8');
  const created = [], cleared = [], badges = [];
  let listener = null;
  const chrome = {
    runtime: { lastError: null, onMessage: { addListener: fn => { listener = fn; } } },
    notifications: {
      create: (id, options, done) => { created.push({ id, options }); if (done) done(); },
      clear: (id, done) => { cleared.push(id); if (done) done(); }
    },
    action: {
      setBadgeText: value => badges.push(value.text),
      setBadgeBackgroundColor: () => {}
    }
  };
  new Function('chrome', background)(chrome);
  assert.equal(typeof listener, 'function', 'the worker subscribes to the content script');
  listener({ type: 'ubif-plus-chat-message', text: 'Ready for pickup', unread: 3 });
  assert.equal(created.length, 1, 'one notification is raised');
  assert.equal(created[0].options.title, 'UBIF support');
  assert.equal(created[0].options.message, 'Ready for pickup');
  assert.equal(badges.at(-1), '3', 'the toolbar icon shows the count');
  listener({ type: 'ubif-plus-chat-message', text: 'We will call you', unread: 4 });
  assert.equal(created.length, 2, 'further messages reuse the same notification slot');
  listener({ type: 'ubif-plus-chat-seen' });
  assert.equal(cleared.at(-1), created[0].id, 'returning to the chat withdraws it');
  assert.equal(badges.at(-1), '');
  listener({ type: 'ubif-plus-chat-message', text: '', unread: 5, desktop: false, badge: false });
  assert.equal(created.length, 2, 'disabled notifications do not create desktop alerts');
  assert.equal(badges.at(-1), '', 'disabled badges stay clear');
  listener({ type: 'ubif-plus-chat-message', text: '', unread: 5, desktop: true, badge: false });
  assert.equal(created.at(-1).options.message, 'UBIF support has a new message', 'generic notification without preview');
  listener({ type: 'ubif-plus-chat-preferences', desktop: false, badge: true });
  assert.equal(cleared.length, 2, 'turning notifications off clears an existing alert');
  listener({ type: 'unrelated' });
  assert.equal(created.length, 3, 'other extension messages are ignored');
});

test('the widget is still styled when animation frames are suspended', async t => {
  // Chrome pauses rAF in tabs it considers hidden; without the fallback timer
  // the very first schedule would wedge and the panel would never be placed.
  const { w, marks } = boot(t, { raf: false });
  await wait(800); // not settle(): it waits on a frame that never comes
  assert.ok(marks().style, 'the rules are in place');
  assert.ok(marks().grip, 'the fallback timer applied the panel');
  assert.equal(marks().panel.classList.contains('ubif-plus-chat-panel'), true);
  assert.equal(marks().grip.querySelector('.ubif-plus-chat-min') !== null, true);
});

test('the script loads on every portal page after the settings module', () => {
  assert.deepEqual(manifest.content_scripts[0].js, ['page.js']);
  const scripts = manifest.content_scripts[1].js;
  assert.equal(scripts[0], 'settings.js', 'settings load before the consumers');
  assert.equal(scripts.includes('support.js'), true);
  assert.deepEqual(manifest.content_scripts[1].matches, ['https://portal.ubreakifix.net/*'], 'every page, not one route');
  assert.equal(manifest.permissions.includes('notifications'), true, 'desktop notes need the notifications permission');
  assert.equal(manifest.background && manifest.background.service_worker, 'background.js', 'the desktop note is raised from the worker');
});

const STATE_KEY = 'ubif-plus.support.session.v1';
const SESSION_KEY = 'persistedChatSession';
const savedSession = (extra = {}) => ({
  [SESSION_KEY]: 'test-session',
  [STATE_KEY]: JSON.stringify({ session: 'test-session', open: true, minimized: false, unread: 0, draft: 'Unsent question', ...extra })
});

test('refresh restores visibility and an unsent draft without submitting anything', async t => {
  const { w, marks } = boot(t, { session: savedSession() });
  const doc = marks().frame.querySelector('iframe').contentDocument;
  const input = doc.createElement('textarea');
  doc.body.append(input);
  let inputs = 0;
  input.addEventListener('input', () => inputs++);
  marks().frame.classList.remove('show');
  await settle(w);
  assert.equal(marks().frame.classList.contains('show'), true);
  assert.equal(input.value, 'Unsent question');
  assert.equal(inputs, 1, 'the controlled composer is informed of restored text');
  input.value = 'Updated draft';
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  w.dispatchEvent(new w.Event('pagehide'));
  assert.equal(JSON.parse(w.sessionStorage.getItem(STATE_KEY)).draft, 'Updated draft');
  input.value = '';
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  doc.body.append(doc.createElement('div'));
  await wait(20);
  assert.equal(input.value, '', 'sent or discarded text does not reappear');
});

test('a minimized chat survives refresh and drafts never cross conversation identities', async t => {
  const first = boot(t, { session: savedSession({ open: false, minimized: true, unread: 2 }) });
  await settle(first.w);
  assert.equal(first.marks().frame.style.display, 'none');
  assert.equal(first.w.document.querySelector('.ubif-plus-chat-badge').textContent, '2');
  const second = boot(t, { session: { ...savedSession(), [SESSION_KEY]: 'different-session' } });
  const doc = second.marks().frame.querySelector('iframe').contentDocument;
  const input = doc.createElement('textarea');
  doc.body.append(input);
  await settle(second.w);
  assert.equal(input.value, '', 'an old conversation draft is not restored');
});

test('new tab keeps the source visible until that tab confirms its connection', async t => {
  const { w, marks } = boot(t, { session: savedSession() });
  await settle(w);
  const original = marks().frame.querySelector('iframe');
  let copied, focused = 0;
  const target = { closed: false, focus: () => focused++ };
  w.open = (url, name) => {
    assert.equal(url, w.location.href);
    assert.equal(name, '_blank');
    copied = Object.fromEntries(Array.from({ length: w.sessionStorage.length }, (_, i) => {
      const key = w.sessionStorage.key(i);
      return [key, w.sessionStorage.getItem(key)];
    }));
    return target;
  };
  const button = marks().grip.querySelector('.ubif-plus-chat-pop');
  button.click();
  assert.equal(copied[SESSION_KEY], 'test-session');
  assert.equal(JSON.parse(copied[STATE_KEY]).open, true);
  assert.equal(JSON.parse(copied[STATE_KEY]).minimized, false);
  assert.equal(JSON.parse(copied[STATE_KEY]).draft, 'Unsent question');
  assert.strictEqual(marks().frame.querySelector('iframe'), original);
  assert.equal(marks().frame.classList.contains('show'), true, 'still usable while destination loads');
  const id = JSON.parse(copied['ubif-plus.support.handoff.v1']).id;
  const ready = source => new w.MessageEvent('message', {
    origin: w.location.origin, source, data: { type: 'ubif-plus-support-ready', id }
  });
  w.dispatchEvent(ready(w));
  assert.equal(marks().frame.classList.contains('show'), true, 'unrelated windows cannot hide the source');
  w.dispatchEvent(ready(target));
  assert.equal(marks().frame.style.display, 'none');
  assert.ok(w.document.getElementById('ubif-plus-chat-resume'));
  button.click();
  assert.equal(focused, 1);
});

test('blocked popups and missing sessions leave the current chat open', async t => {
  const { w, marks } = boot(t);
  await settle(w);
  let opened = 0;
  w.open = () => { opened++; return null; };
  const button = marks().grip.querySelector('.ubif-plus-chat-pop');
  button.click();
  assert.equal(opened, 0);
  w.sessionStorage.setItem(SESSION_KEY, 'test-session');
  button.click();
  assert.equal(opened, 1);
  assert.equal(marks().frame.classList.contains('show'), true);
  assert.match(marks().frame.querySelector('[role="status"]').textContent, /Allow popups/);
  assert.equal(w.sessionStorage.getItem('ubif-plus.support.handoff.v1'), null);
});

test('header restore intercepts the portal remount handler and dock restores the identical iframe', async t => {
  const { w, marks } = boot(t);
  const original = marks().frame.querySelector('iframe');
  let portalLaunches = 0;
  const header = w.document.querySelector('[data-chat-launch-button]');
  // Reproduce the portal handler: a hidden widget is replaced on launcher click.
  header.addEventListener('click', () => {
    portalLaunches++;
    const frame = marks().frame;
    if (!frame.classList.contains('show')) frame.replaceWith(frame.cloneNode(true));
    else { frame.style.display = 'none'; frame.classList.remove('show'); }
  });
  await settle(w);
  marks().grip.querySelector('.ubif-plus-chat-min').click();
  assert.ok(w.document.getElementById('ubif-plus-chat-resume'));
  header.click();
  assert.equal(portalLaunches, 0);
  assert.equal(marks().frame.style.display, 'block');
  assert.strictEqual(marks().frame.querySelector('iframe'), original);
  assert.equal(w.document.getElementById('ubif-plus-chat-resume'), null);
  marks().grip.querySelector('.ubif-plus-chat-min').click();
  w.document.getElementById('ubif-plus-chat-resume').click();
  assert.strictEqual(marks().frame.querySelector('iframe'), original);
  assert.equal(marks().frame.style.display, 'block');
});

test('destination acknowledges only the vendor connection event, not merely mounting a frame', async t => {
  const { w, marks } = boot(t, { session: {
    ...savedSession(),
    'ubif-plus.support.handoff.v1': JSON.stringify({ id: 'handoff-test', created: Date.now() })
  } });
  const messages = [];
  w.opener = { postMessage: (data, origin) => messages.push({ data, origin }) };
  await settle(w);
  assert.equal(messages.length, 0);
  const iframe = marks().frame.querySelector('iframe');
  w.dispatchEvent(new w.MessageEvent('message', {
    source: iframe.contentWindow, origin: w.location.origin,
    data: { call: 'amazon-connect-chat-started' }
  }));
  assert.equal(messages.length, 1);
  assert.equal(messages[0].data.id, 'handoff-test');
  assert.equal(messages[0].origin, w.location.origin);
  assert.equal(w.opener, null);
});

test('composer controls do not trigger drag keyboard shortcuts', async t => {
  const { w, marks, position } = boot(t);
  await settle(w);
  const button = marks().grip.querySelector('.ubif-plus-chat-pop');
  const before = position(marks().panel);
  button.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.deepEqual(position(marks().panel), before);
});


test('recovery waits for the portal launcher and does not spam launches on DOM mutations', async t => {
  const { w, marks } = boot(t, { session: savedSession() });
  const current = marks().frame;
  const parent = current.parentElement;
  current.remove();
  const launcher = w.document.querySelector('[data-chat-launch-button]');
  launcher.remove();
  await settle(w);
  let launches = 0;
  launcher.addEventListener('click', () => { launches++; });
  w.document.querySelector('header').append(launcher);
  await settle(w);
  assert.equal(launches, 1);
  w.document.body.append(w.document.createElement('div'));
  await settle(w);
  assert.equal(launches, 1, 'DOM changes cannot start another launch');
  w.dispatchEvent(new w.Event('pagehide'));
  assert.equal(JSON.parse(w.sessionStorage.getItem(STATE_KEY)).draft, 'Unsent question');
  parent.append(current);
  await settle(w);
  const doc = current.querySelector('iframe').contentDocument;
  const input = doc.createElement('textarea');
  doc.body.append(input);
  await wait(20);
  assert.equal(input.value, 'Unsent question', 'late-mounting composer receives the saved draft');
});

test('ended sessions clear recovery state and existing composer text is left alone', async t => {
  const { w, marks } = boot(t, { session: savedSession() });
  const doc = marks().frame.querySelector('iframe').contentDocument;
  const input = doc.createElement('textarea');
  input.value = 'Already here';
  doc.body.append(input);
  await settle(w);
  assert.equal(input.value, 'Already here');
  w.sessionStorage.removeItem(SESSION_KEY);
  w.dispatchEvent(new w.Event('pagehide'));
  assert.equal(w.sessionStorage.getItem(STATE_KEY), null);
});


test('recovery retries when the visible portal launcher was not wired yet', async t => {
  const { w, marks } = boot(t, { session: savedSession() });
  const original = marks().frame;
  const parent = original.parentElement;
  original.remove();
  await settle(w); // first click happens before portal installs its handler
  let launches = 0;
  w.document.querySelector('[data-chat-launch-button]').addEventListener('click', () => {
    launches++;
    parent.append(original);
  });
  await wait(1400);
  assert.equal(launches, 1);
  assert.equal(marks().frame, original);
  assert.equal(original.classList.contains('show'), true);
});

test('support settings suppress previews and badges before delivering a hidden message', async t => {
  const { w, marks, sends } = boot(t, { stored: { [KEY]: { support: true, supportMessagePreview: false, supportUnreadBadge: false, supportDesktopNotifications: false } } });
  await settle(w);
  const frame = marks().frame;
  const doc = frame.querySelector('iframe').contentDocument;
  frame.style.display = 'none'; frame.classList.remove('show');
  const row = doc.createElement('div'); row.dataset.testid = 'message-container'; row.textContent = 'Private support reply';
  doc.body.append(row); await wait(20);
  const message = sends.findLast(m => m.type === 'ubif-plus-chat-message');
  assert.deepEqual(message, { type: 'ubif-plus-chat-message', text: '', unread: 1, desktop: false, badge: false });
  assert.equal(w.document.querySelector('.ubif-plus-chat-badge').classList.contains('ubif-plus-chat-badge-on'), false);
});

test('existing unread counts update immediately when support badge preferences change', async t => {
  const { w, s, marks, sends } = boot(t);
  await settle(w);
  const frame = marks().frame, doc = frame.querySelector('iframe').contentDocument;
  frame.style.display = 'none'; frame.classList.remove('show');
  const row = doc.createElement('div'); row.dataset.testid = 'message-container'; row.textContent = 'A reply'; doc.body.append(row);
  await wait(20);
  const badge = w.document.querySelector('.ubif-plus-chat-badge');
  s.changed({ support: true, supportUnreadBadge: false });
  assert.equal(badge.classList.contains('ubif-plus-chat-badge-on'), false);
  s.changed({ support: true, supportUnreadBadge: true, supportMessagePreview: false });
  assert.equal(badge.classList.contains('ubif-plus-chat-badge-on'), true);
  const message = sends.at(-1);
  assert.equal(message.type, 'ubif-plus-chat-preferences');
  assert.equal(message.unread, 1);
  assert.equal(message.badge, true);
  assert.equal(message.hidePreview, true);
});
