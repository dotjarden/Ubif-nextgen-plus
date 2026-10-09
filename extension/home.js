/* Home page polish: optionally hides the Arrivals calendar that the portal
   pins to the right of Home. The aside is only marked, never removed, so the
   portal keeps its own state and re-showing the calendar needs no reload. */
(() => {
  'use strict';
  if (globalThis.__ubifPlusHome) return;
  globalThis.__ubifPlusHome = true;
  const S = globalThis.UBIFPlusSettings;
  const STYLE_ID = 'ubif-plus-home-style';
  const HIDDEN = 'data-ubif-calendar-hidden';
  const ROW = 'data-ubif-calendar-row';
  /* The Home column is a flex row: hiding the aside alone would leave the
     Quick actions half-width, so the rule also lets its sibling take the
     space the calendar used to hold. */
  const CSS = `[${ROW}]>aside[${HIDDEN}]{display:none!important;}
    [${ROW}]>section{flex:1 1 auto!important;width:auto!important;min-width:0;}`;
  let enabled = false, pending = false;

  const style = () => {
    let node = document.getElementById(STYLE_ID);
    if (!node) {
      node = document.createElement('style');
      node.id = STYLE_ID;
      node.textContent = CSS;
      (document.head || document.documentElement).append(node);
    }
    return node;
  };
  const isHome = () => /^\/(?:home)?\/?$/.test(location.pathname);
  const calendar = () => [...document.querySelectorAll('aside')].find(aside => {
    if (!isHome()) return false;
    const heading = aside.querySelector('h1,h2,h3');
    return Boolean(heading) && /^arrivals$/i.test(heading.textContent.trim());
  });

  function apply() {
    pending = false;
    if (!enabled || !isHome()) {
      for (const el of document.querySelectorAll(`[${HIDDEN}],[${ROW}]`)) {
        el.removeAttribute(HIDDEN);
        el.removeAttribute(ROW);
      }
      return;
    }
    const aside = calendar();
    if (!aside) return;
    style().textContent = CSS;
    aside.setAttribute(HIDDEN, '');
    if (aside.parentElement) aside.parentElement.setAttribute(ROW, '');
  }
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(apply);
  }

  let lastUrl = location.href;
  setInterval(() => {
    if (lastUrl !== location.href) { lastUrl = location.href; schedule(); }
  }, 400);
  // The Home column renders after the route does, so watch for it arriving.
  if (document.body) new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  addEventListener('pageshow', schedule);

  const setEnabled = settings => {
    const next = Boolean(settings && settings.hideHomeCalendar);
    if (next === enabled) { if (next) schedule(); return; }
    enabled = next;
    schedule();
  };
  if (S) { S.get().then(setEnabled, () => {}); S.subscribe(setEnabled); } else setEnabled({ hideHomeCalendar: false });
})();
