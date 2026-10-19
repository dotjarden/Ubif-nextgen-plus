/* One-click copy beside each IMEI shown on a work order. Portal renders the
   device card line as a plain text element, "IMEI: 350166280848735"; the
   button sits right after the number and copies only its digits. */
(() => {
  'use strict';
  if (globalThis.__ubifPlusImeiCopy) return;
  globalThis.__ubifPlusImeiCopy = true;
  const S = globalThis.UBIFPlusSettings;
  const MARK = 'data-ubif-imei-copy';
  const LINE = /^\s*IMEI\s*:?\s*(\d{14,17})\s*$/i;
  let enabled = !S, scheduled = false;
  const style = document.createElement('style');
  style.textContent = `
    [${MARK}]{display:inline-flex;align-items:center;justify-content:center;gap:4px;vertical-align:middle;margin-left:6px;padding:2px 6px;min-height:22px;border:1px solid var(--aui-outline,#c8c2cd);border-radius:6px;background:var(--aui-elevated-level-01,#fff);color:var(--aui-on-surface,#242128);font:inherit;font-size:12px;line-height:1;cursor:pointer;transition:background-color .15s,border-color .15s,color .15s,box-shadow .15s,transform .15s}
    [${MARK}]:hover{background:var(--aui-primary-container,#eee2f9);border-color:var(--aui-primary,#8224ce);color:var(--aui-primary,#8224ce);box-shadow:0 1px 4px #8224ce33;transform:translateY(-1px)}
    [${MARK}]:active{transform:translateY(0);box-shadow:none}
    @media (prefers-reduced-motion:reduce){[${MARK}]{transition:none}[${MARK}]:hover{transform:none}}
    [${MARK}]:focus-visible{outline:2px solid var(--aui-primary,#8224ce);outline-offset:1px}
    [${MARK}] svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    [${MARK}][data-copied]{border-color:var(--aui-status-success,#237a42);color:var(--aui-status-success,#237a42)}
  `;
  document.head.append(style);
  const onWorkorder = () => /^\/repair\/workorder\/\d+/.test(location.pathname);
  const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
    // Fallback for a document that blocks the async clipboard.
    const area = document.createElement('textarea');
    area.value = text; area.setAttribute('readonly', ''); area.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.append(area); area.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch {}
    area.remove(); return ok;
  }
  function button(imei) {
    const node = document.createElement('button');
    node.type = 'button'; node.setAttribute(MARK, imei);
    node.setAttribute('aria-label', `Copy IMEI ${imei}`); node.title = 'Copy IMEI';
    node.innerHTML = COPY_ICON;
    let reset;
    node.addEventListener('click', async event => {
      // The device card opens Portal's editor on click; the copy must not.
      event.preventDefault(); event.stopPropagation();
      const ok = await copy(node.getAttribute(MARK));
      clearTimeout(reset);
      node.toggleAttribute('data-copied', ok);
      node.title = ok ? 'Copied' : 'Could not copy';
      node.setAttribute('aria-label', ok ? `Copied IMEI ${imei}` : `Could not copy IMEI ${imei}`);
      reset = setTimeout(() => { node.removeAttribute('data-copied'); node.title = 'Copy IMEI'; node.setAttribute('aria-label', `Copy IMEI ${imei}`); }, 1500);
    });
    return node;
  }
  // Text of an element without our own button, so a re-render check stays stable.
  const ownText = node => [...node.childNodes].filter(child => !(child.nodeType === 1 && child.hasAttribute(MARK))).map(child => child.textContent).join('');
  function scan() {
    scheduled = false;
    const active = enabled && onWorkorder();
    for (const existing of document.querySelectorAll(`button[${MARK}]`)) {
      const match = LINE.exec(ownText(existing.parentElement || document.createElement('i')));
      if (!active || !match || match[1] !== existing.getAttribute(MARK)) existing.remove();
    }
    if (!active) return;
    for (const node of document.querySelectorAll('p, span, div, li, td, dd')) {
      if (node.closest('#ubif-universal-search, [contenteditable], input, textarea, dialog')) continue;
      // Leaf text lines only: a container whose children hold the IMEI line is skipped.
      if ([...node.children].some(child => !child.hasAttribute(MARK))) continue;
      const match = LINE.exec(ownText(node));
      if (!match || node.querySelector(`button[${MARK}]`)) continue;
      node.append(button(match[1]));
    }
  }
  const schedule = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(scan); } };
  new MutationObserver(mutations => {
    // Ignore the mutations our own buttons cause.
    if (mutations.every(m => [...m.addedNodes, ...m.removedNodes].every(n => n.nodeType === 1 && n.hasAttribute?.(MARK)))) return;
    schedule();
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
  addEventListener('popstate', schedule);
  const apply = settings => { enabled = settings.workorderImeiCopy !== false; schedule(); };
  if (S) { S.subscribe(apply); S.get().then(apply, () => {}); }
  schedule();
})();
