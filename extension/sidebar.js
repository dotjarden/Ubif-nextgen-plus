/* Portal navigation sidebar fixes.
   The portal's Nav (@ubif/components) renders <nav><div class="open|closed">
   with Asurion Link anchors, a More entry (icon "services-menu") holding a
   button.toggle-more, and a button.toggle-nav that is .rotate while expanded.
   Collapsed links render no text and no accessible name, the More row is an
   <a href="/"> that opens Dashboard unless the small chevron is hit, and a
   width change re-forces the portal's own open/closed state over the user's.
   Appcues embeds Support Ticket and Enhancement Idea as an
   <appcues-experience-container> (open shadow root) inside the same list;
   its inline-styled white Helvetica buttons ignore the theme and spill
   clipped text into the collapsed rail. */
(() => {
  'use strict';
  if (globalThis.__ubifPlusSidebarStarted) return;
  globalThis.__ubifPlusSidebarStarted = true;
  const S = globalThis.UBIFPlusSettings;
  const PREF = 'ubif-plus.nav.collapsed';
  // Asurion UI's LG breakpoint; below it the portal overlays the nav instead.
  const LG = 1280;
  const ATTR = 'data-ubif-nav';
  // Collapsed links have no text; these are the portal's own labels by route.
  const LABELS = {
    '/': 'Dashboard', '/check-in/arrivals': 'Arrivals', '/repair/workorders': 'Workorders',
    '/check-out/sales': 'Sales', '/boh/inventory': 'Inventory', '/kbase': 'Knowledge base',
    '/reporting/metrics': 'Reports', '/repair/remote-tech': 'Remote Tech'
  };
  const learned = new Map();
  let enabled = false, observer = null, resizeTimer = 0, lastWidth = window.innerWidth;

  const css = `
html[${ATTR}] nav:has(> div.open), html[${ATTR}] nav:has(> div.closed) { transition: width .18s ease; }
html[${ATTR}] nav > div.open > a[data-aui="link"], html[${ATTR}] nav > div.closed > a[data-aui="link"] { white-space: nowrap; overflow: hidden; }
html[${ATTR}] nav > div.closed { overflow-x: hidden; }
/* Tighter rhythm than the portal's 48 px rows with 8 px gaps, so the list
   fits short windows without scrolling. */
html[${ATTR}] nav > div.open > a[data-aui="link"], html[${ATTR}] nav > div.closed > a[data-aui="link"] { height: 40px !important; min-height: 40px !important; margin: 0 0 2px !important; }
html[${ATTR}] nav > div.open > div > a[data-aui="link"] { min-height: 34px !important; height: auto !important; margin: 0 0 2px !important; padding-top: 6px !important; padding-bottom: 6px !important; }
html[${ATTR}] nav button.toggle-more { margin-left: auto !important; }
/* Support Ticket and Enhancement Idea (Appcues), then More and its menu, form
   a group at the bottom above the collapse toggle, with More last. The list
   fills the nav so the group can be pushed down, and still scrolls when an
   open More menu overflows. */
html[${ATTR}] nav > div.open, html[${ATTR}] nav > div.closed { flex: 1 1 auto !important; }
html[${ATTR}] nav > div > a[data-aui="link"]:has([data-icon-name="services-menu"]) { order: 2; }
html[${ATTR}] nav > div > div { order: 3; }
/* Without the Appcues embed, More starts the bottom group itself. */
html[${ATTR}] nav > div:not(:has(> appcues-experience-container)) > a[data-aui="link"]:has([data-icon-name="services-menu"]) { margin-top: auto !important; }
@media (prefers-reduced-motion: reduce) { html[${ATTR}] nav:has(> div.open), html[${ATTR}] nav:has(> div.closed) { transition: none; } }`;

  // Appcues writes inline styles, so overrides need !important. The shadow
  // root inherits the nav's font, colour and the portal's --aui-* tokens.
  const ICONS = {
    ticket: 'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4V7Z M13 5v2 M13 11v2 M13 17v2',
    idea: 'M9 18h6 M10 21h4 M12 3a6 6 0 0 0-3.6 10.8c.6.5 1.1 1.3 1.1 2.2h5c0-.9.5-1.7 1.1-2.2A6 6 0 0 0 12 3Z'
  };
  const mask = path => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'><path d='${path}'/></svg>`)}")`;
  const shadowCss = `
#embed-root { background: transparent !important; min-height: min-content !important; margin: 0 !important; cursor: default !important; border-radius: 0 !important;
  /* The host is display: contents, so this is a flex item of the scrolling
     list: never shrink into the links when it overflows, and start the
     bottom group, ahead of More and its menu. */
  flex: none !important; order: 1; margin-top: auto !important; }
[blocktype="Cell"] { padding: 0 !important; height: auto !important; }
button[blocktype="Button"] {
  display: flex !important; align-items: center !important; gap: 8px; box-sizing: border-box;
  width: 100% !important; height: 40px !important; margin: 0 0 2px !important; padding: 0 12px !important;
  border-radius: 8px !important; background: transparent !important; color: var(--aui-on-surface, inherit) !important;
  font: inherit !important; text-align: start !important; white-space: nowrap; overflow: hidden;
}
button[blocktype="Button"]:hover { background: var(--aui-fills-surface-contrast, rgba(12, 14, 17, .04)) !important; }
button[blocktype="Button"]:focus-visible { outline: 2px solid var(--aui-primary, #8223d2); outline-offset: -2px; }
button[blocktype="Button"]::before {
  content: ""; flex: none; width: 24px; height: 24px; background: currentColor;
  -webkit-mask: var(--ubif-icon) center / 24px no-repeat; mask: var(--ubif-icon) center / 24px no-repeat;
}
button[data-ubif-icon="ticket"] { --ubif-icon: ${mask(ICONS.ticket)}; }
button[data-ubif-icon="idea"] { --ubif-icon: ${mask(ICONS.idea)}; }
:host([data-ubif-collapsed]) button[blocktype="Button"] { font-size: 0 !important; gap: 0; }`;

  const nav = () => document.querySelector('nav:has(> div.open), nav:has(> div.closed)');
  const collapsed = root => Boolean(root?.querySelector(':scope > div.closed'));
  const pathOf = link => { try { return new URL(link.href, location.origin).pathname; } catch { return ''; } };
  const isMore = link => Boolean(link.querySelector('[data-icon-name="services-menu"]'));
  const readPref = () => { try { return localStorage.getItem(PREF); } catch { return null; } };
  const writePref = value => { try { localStorage.setItem(PREF, String(value)); } catch {} };

  function decorateLinks(root) {
    const closed = collapsed(root);
    for (const link of root.querySelectorAll(':scope > div > a[data-aui="link"]')) {
      const path = pathOf(link);
      const text = link.textContent.trim();
      if (text) learned.set(isMore(link) ? 'more' : path, text);
      const label = isMore(link) ? learned.get('more') || 'More' : learned.get(path) || LABELS[path];
      if (!label) continue;
      // Collapsed icons get a tooltip and an accessible name; expanded rows
      // already show their text.
      if (closed) { link.setAttribute('aria-label', label); link.setAttribute('title', label); }
      else { link.removeAttribute('title'); link.removeAttribute('aria-label'); }
    }
    const toggle = root.querySelector('button.toggle-nav');
    if (toggle) {
      const text = closed ? 'Expand navigation' : 'Collapse navigation';
      toggle.setAttribute('aria-label', text); toggle.setAttribute('title', text);
      toggle.setAttribute('aria-expanded', String(!closed));
    }
    const more = root.querySelector('button.toggle-more');
    if (more) {
      more.setAttribute('aria-expanded', String(more.classList.contains('rotateMore')));
      more.setAttribute('aria-label', more.classList.contains('rotateMore') ? 'Hide more' : 'Show more');
    }
  }

  function decorateAppcues(root) {
    const closed = collapsed(root);
    for (const host of root.querySelectorAll('appcues-experience-container')) {
      const shadow = host.shadowRoot;
      if (!shadow) continue;
      if (!shadow.querySelector('style[data-ubif-nav]')) {
        const style = document.createElement('style');
        style.dataset.ubifNav = '';
        style.textContent = shadowCss;
        shadow.append(style);
        // Appcues replaces its blocks when it re-renders.
        new MutationObserver(() => { if (enabled) decorateAppcues(root); }).observe(shadow, { childList: true, subtree: true });
      }
      host.toggleAttribute('data-ubif-collapsed', closed);
      for (const button of shadow.querySelectorAll('button[blocktype="Button"]')) {
        const label = button.dataset.ubifLabel || button.textContent.trim();
        if (!label) continue;
        button.dataset.ubifLabel = label;
        const icon = /ticket|support|help/i.test(label) ? 'ticket' : 'idea';
        if (button.dataset.ubifIcon !== icon) button.dataset.ubifIcon = icon;
        if (closed) button.setAttribute('title', label); else button.removeAttribute('title');
        button.setAttribute('aria-label', label);
      }
    }
  }

  function decorate() {
    const root = nav();
    if (!enabled || !root) return;
    decorateLinks(root);
    decorateAppcues(root);
  }

  function undecorate() {
    document.documentElement.removeAttribute(ATTR);
    document.getElementById('ubif-nav-style')?.remove();
    const root = nav();
    if (!root) return;
    for (const link of root.querySelectorAll('a[data-aui="link"][title]')) { link.removeAttribute('title'); link.removeAttribute('aria-label'); }
    for (const host of root.querySelectorAll('appcues-experience-container')) {
      host.removeAttribute('data-ubif-collapsed');
      host.shadowRoot?.querySelector('style[data-ubif-nav]')?.remove();
    }
  }

  // The More row navigates to "/" unless its chevron is hit. Make the whole
  // row toggle the submenu, and in the collapsed rail expand the nav first.
  document.addEventListener('click', event => {
    if (!enabled) return;
    const root = nav();
    const link = event.target.closest?.('a[data-aui="link"]');
    if (root && link && root.contains(link) && isMore(link)) {
      if (event.target.closest('button.toggle-more')) return;
      event.preventDefault();
      event.stopPropagation();
      if (collapsed(root)) {
        root.querySelector('button.toggle-nav')?.click();
        // Open the submenu once the expanded list has rendered.
        requestAnimationFrame(() => {
          const more = nav()?.querySelector('button.toggle-more');
          if (more && !more.classList.contains('rotateMore')) more.click();
        });
      } else link.querySelector('button.toggle-more')?.click();
      return;
    }
    const toggle = event.target.closest?.('button.toggle-nav');
    // Only a person's click records their preference; the portal's own
    // breakpoint handling and our restoration below are not choices.
    if (toggle && event.isTrusted && root?.contains(toggle)) writePref(!collapsed(root));
  }, true);

  // The portal re-forces open/closed whenever the width changes. On a wide
  // window, put the user's last explicit choice back.
  function restore() {
    const root = nav();
    const pref = readPref();
    if (!enabled || !root || pref === null || window.innerWidth < LG) return;
    if (String(collapsed(root)) !== pref) root.querySelector('button.toggle-nav')?.click();
  }
  window.addEventListener('resize', () => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(restore, 250);
  });

  function apply(on) {
    if (on === enabled) return;
    enabled = on;
    if (!on) { observer?.disconnect(); observer = null; undecorate(); return; }
    document.documentElement.setAttribute(ATTR, '');
    if (!document.getElementById('ubif-nav-style')) {
      const style = document.createElement('style');
      style.id = 'ubif-nav-style';
      style.textContent = css;
      (document.head || document.documentElement).append(style);
    }
    let queued = false;
    observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; decorate(); });
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    decorate();
  }

  if (S) {
    S.get().then(settings => apply(settings.navEnhance !== false), () => apply(true));
    S.subscribe(settings => apply(settings.navEnhance !== false));
  } else apply(true);
  globalThis.UBIFPlusSidebar = Object.freeze({ decorate, restore });
})();
