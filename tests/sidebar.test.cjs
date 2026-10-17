const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const script = fs.readFileSync(`${__dirname}/../extension/sidebar.js`, 'utf8');
const frame = w => new Promise(resolve => w.requestAnimationFrame(() => w.setTimeout(resolve, 0)));

/* The portal's observed Nav markup (R92.4): Asurion links with icon spans,
   the More row as <a href="/"> with button.toggle-more, the Appcues embed,
   and button.toggle-nav (.rotate while expanded). Clicking the toggles flips
   the classes the way the portal's Redux layout slice does. */
function portal(t, { closed = false, width = 1332, settings } = {}) {
  const dom = new JSDOM(`<!doctype html><body><nav><div class="${closed ? 'closed' : 'open'}">
    <a data-aui="link" class="active" href="/"><div><span data-aui="icon" data-icon-name="user-home"></span></div>${closed ? '' : 'Dashboard'}</a>
    <a data-aui="link" href="/check-in/arrivals"><div><span data-aui="icon" data-icon-name="time/calendar-dollar-2.svg"></span></div>${closed ? '' : 'Arrivals'}</a>
    <a data-aui="link" href="/"><div><span data-aui="icon" data-icon-name="services-menu"></span></div>${closed ? '' : '<span>More</span><button class="toggle-more"></button>'}</a>
    <appcues-experience-container></appcues-experience-container>
  </div><div><button class="toggle-nav${closed ? '' : ' rotate'}"></button></div></nav><main></main></body>`,
  { url: 'https://portal.ubreakifix.net/', runScripts: 'outside-only', pretendToBeVisual: true });
  // Queued frames must not run against a closed window.
  t.after(() => { dom.window.requestAnimationFrame = () => 0; dom.window.close(); });
  const w = dom.window, doc = w.document;
  Object.defineProperty(w, 'innerWidth', { configurable: true, writable: true, value: width });
  const host = doc.querySelector('appcues-experience-container');
  host.attachShadow({ mode: 'open' }).innerHTML = '<div><button id="embed-root" style="background-color: rgb(255,255,255)"><div blocktype="Cell"><button blocktype="Button">Support Ticket</button></div><div blocktype="Cell"><button blocktype="Button">Enhancement Idea</button></div></button></div>';
  const inner = doc.querySelector('nav > div');
  const clicks = { nav: 0, more: 0, navigated: 0 };
  doc.querySelector('button.toggle-nav').addEventListener('click', () => {
    clicks.nav++;
    const nowClosed = inner.classList.contains('open');
    inner.className = nowClosed ? 'closed' : 'open';
    doc.querySelector('button.toggle-nav').classList.toggle('rotate', !nowClosed);
    // Collapsed links lose their text; the More chevron is not rendered.
    const links = inner.querySelectorAll('a');
    links[0].lastChild.textContent = nowClosed ? '' : 'Dashboard';
    links[1].lastChild.textContent = nowClosed ? '' : 'Arrivals';
    links[2].querySelector('span:not([data-aui])')?.remove(); links[2].querySelector('button')?.remove();
    if (!nowClosed) links[2].insertAdjacentHTML('beforeend', '<span>More</span><button class="toggle-more"></button>');
    bindMore();
  });
  function bindMore() {
    doc.querySelector('button.toggle-more')?.addEventListener('click', event => { event.preventDefault(); clicks.more++; event.currentTarget.classList.toggle('rotateMore'); });
  }
  bindMore();
  // Any click that reaches the More anchor's default would open Dashboard.
  doc.addEventListener('click', event => { if (event.target.closest('a') && !event.defaultPrevented) clicks.navigated++; });
  if (settings) {
    let listener;
    w.UBIFPlusSettings = { get: () => Promise.resolve(settings), subscribe: fn => { listener = fn; } };
    w.eval(script);
    return { w, doc, host, clicks, change: next => listener(next) };
  }
  w.eval(script);
  return { w, doc, host, clicks };
}

test('collapsed icons get the portal labels as tooltips and accessible names', async t => {
  const { w, doc } = portal(t);
  await frame(w);
  const links = [...doc.querySelectorAll('nav a')];
  assert.equal(links[0].hasAttribute('title'), false, 'expanded rows already show their text');
  assert.equal(doc.querySelector('button.toggle-nav').getAttribute('aria-label'), 'Collapse navigation');
  assert.equal(doc.querySelector('button.toggle-nav').getAttribute('aria-expanded'), 'true');
  doc.querySelector('button.toggle-nav').click();
  await frame(w);
  assert.deepEqual(links.map(link => link.getAttribute('title')), ['Dashboard', 'Arrivals', 'More']);
  assert.equal(links[1].getAttribute('aria-label'), 'Arrivals');
  assert.equal(doc.querySelector('button.toggle-nav').getAttribute('aria-label'), 'Expand navigation');
});

test('a nav that starts collapsed still labels its icons from the portal routes', async t => {
  const { w, doc } = portal(t, { closed: true });
  await frame(w);
  assert.equal(doc.querySelectorAll('nav a')[1].getAttribute('title'), 'Arrivals');
});

test('the whole More row toggles its menu instead of opening Dashboard', async t => {
  const { w, doc, clicks } = portal(t);
  await frame(w);
  doc.querySelector('nav a:nth-of-type(3) span:not([data-aui])').click();
  assert.equal(clicks.more, 1);
  assert.equal(clicks.navigated, 0);
  await frame(w);
  assert.equal(doc.querySelector('button.toggle-more').getAttribute('aria-expanded'), 'true');
  doc.querySelector('button.toggle-more').click();
  assert.equal(clicks.more, 2, 'the chevron keeps working on its own');
});

test('More in the collapsed rail expands the nav and opens the menu', async t => {
  const { w, doc, clicks } = portal(t, { closed: true });
  await frame(w);
  doc.querySelector('[data-icon-name="services-menu"]').click();
  await frame(w);
  assert.equal(clicks.nav, 1);
  assert.equal(clicks.navigated, 0);
  assert.equal(doc.querySelector('nav > div').className, 'open');
  assert.equal(doc.querySelector('button.toggle-more').classList.contains('rotateMore'), true);
});

test('Appcues Support Ticket and Enhancement Idea follow the portal theme and the collapsed rail', async t => {
  const { w, doc, host } = portal(t);
  await frame(w);
  const style = host.shadowRoot.querySelector('style[data-ubif-nav]');
  assert.ok(style && /var\(--aui-on-surface/.test(style.textContent), 'portal tokens, not white Helvetica');
  const buttons = [...host.shadowRoot.querySelectorAll('button[blocktype="Button"]')];
  assert.deepEqual(buttons.map(b => b.dataset.ubifIcon), ['ticket', 'idea']);
  assert.equal(buttons[0].hasAttribute('title'), false);
  doc.querySelector('button.toggle-nav').click();
  await frame(w);
  assert.equal(host.hasAttribute('data-ubif-collapsed'), true, 'labels hide behind icons in the rail');
  assert.deepEqual(buttons.map(b => b.getAttribute('title')), ['Support Ticket', 'Enhancement Idea']);
  // Appcues re-rendering its blocks is styled again.
  host.shadowRoot.querySelector('[blocktype="Cell"]').insertAdjacentHTML('beforeend', '<button blocktype="Button">Support Ticket</button>');
  await frame(w); await frame(w);
  assert.equal(host.shadowRoot.querySelectorAll('button[data-ubif-icon]').length, 3);
});

test('a wide window keeps the last collapse choice after the portal re-forces it', async t => {
  const { w, doc, clicks } = portal(t);
  w.localStorage.setItem('ubif-plus.nav.collapsed', 'true');
  // The portal reopened the nav on a width change; a narrow window is left alone.
  w.innerWidth = 1000; w.dispatchEvent(new w.Event('resize'));
  await new Promise(resolve => w.setTimeout(resolve, 300));
  assert.equal(clicks.nav, 0);
  w.innerWidth = 1400; w.dispatchEvent(new w.Event('resize'));
  await new Promise(resolve => w.setTimeout(resolve, 300));
  assert.equal(clicks.nav, 1);
  assert.equal(doc.querySelector('nav > div').className, 'closed');
  assert.equal(w.localStorage.getItem('ubif-plus.nav.collapsed'), 'true', 'restoration is not recorded as a choice');
});

test('turning the setting off removes every change', async t => {
  const { w, doc, host, clicks, change } = portal(t, { closed: true, settings: { navEnhance: true } });
  await frame(w); await frame(w);
  assert.equal(doc.querySelectorAll('nav a')[0].getAttribute('title'), 'Dashboard');
  change({ navEnhance: false });
  assert.equal(doc.querySelectorAll('nav a[title]').length, 0);
  assert.equal(host.shadowRoot.querySelector('style[data-ubif-nav]'), null);
  assert.equal(doc.getElementById('ubif-nav-style'), null);
  doc.querySelector('[data-icon-name="services-menu"]').click();
  assert.equal(clicks.nav, 0, 'More is native again');
});

test('Support Ticket and Enhancement Idea, then More and its menu, are grouped at the bottom of the sidebar', async t => {
  const { w, doc, host } = portal(t);
  await frame(w);
  const css = doc.getElementById('ubif-nav-style').textContent;
  assert.match(host.shadowRoot.querySelector('style[data-ubif-nav]').textContent, /order: 1; margin-top: auto !important;/, 'Appcues starts the bottom group');
  assert.match(css, /a\[data-aui="link"\]:has\(\[data-icon-name="services-menu"\]\) \{ order: 2; \}/, 'More is the last button');
  assert.match(css, /nav > div > div \{ order: 3; \}/, 'its menu opens below it');
  assert.match(css, /height: 40px !important; min-height: 40px !important; margin: 0 0 2px !important;/, 'compact 40 px rows');
});
