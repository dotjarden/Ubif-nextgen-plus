/* UBIF support chat, made usable again.
 *
 * The portal anchors the Amazon Connect widget under the header's UBIF Support
 * button by writing top/left on the widget's container, while the vendor's own
 * stylesheet keeps pinning that same box bottom/right. With both pairs set, a
 * fixed, transparent box (z-index 999999999) stretches across the rest of the
 * viewport: opening a conversation makes every click land on an invisible
 * overlay, so the portal has to be used from a second tab. In fullscreen mode
 * the widget goes further and marks the page's own containers inert.
 *
 * This module keeps the panel the size of the chat, lets clicks fall through to
 * the page, releases the inert background while a chat is open, and gives the
 * panel a grip bar so it can be dragged anywhere — position and size changes
 * only, so the conversation itself is never reloaded or dropped. The grip also
 * minimizes the chat in place (the iframe keeps running), and messages that
 * arrive while the chat is hidden raise a badge on the UBIF Support launcher
 * and a desktop notification via the background worker. */
(() => {
  'use strict';
  if (globalThis.__ubifPlusSupport) return;
  globalThis.__ubifPlusSupport = true;
  const S = globalThis.UBIFPlusSettings;
  const STYLE_ID = 'ubif-plus-support-style';
  const PANEL = 'ubif-plus-chat-panel';
  const GRIP = 'ubif-plus-chat-grip';
  const MIN = 'ubif-plus-chat-min';
  const POP = 'ubif-plus-chat-pop';
  const STATE_KEY = 'ubif-plus.support.session.v1';
  const SESSION_KEY = 'persistedChatSession';
  const HANDOFF_KEY = 'ubif-plus.support.handoff.v1';
  const READY = 'ubif-plus-support-ready';
  const DOCK = 'ubif-plus-chat-resume';
  const HIDDEN = 'ubif-plus-support-minimized';
  const LAUNCH = 'ubif-plus-chat-launch';
  const BADGE = 'ubif-plus-chat-badge';
  const BADGE_ON = 'ubif-plus-chat-badge-on';
  const MESSAGE = '[data-testid="message-container"]';
  const CHAT_CALL = 'amazon-connect-push-notification-eligible-message-received';
  const NOTE = 'ubif-plus-chat-message';
  const SEEN = 'ubif-plus-chat-seen';
  const TOP = '--ubif-plus-chat-top';
  const LEFT = '--ubif-plus-chat-left';
  const INERT = 'data-amazon-connect-inert';
  const POS_KEY = 'ubif-plus.support.v1';
  const GAP = 25;      // the portal drops the panel this far below the button
  const GRIP_BAR = 26; // drag bar across the top of the chat frame
  const NUDGE = 16;    // arrow-key step
  const KEEP_ON_SCREEN = 40; // px of the panel that must stay reachable
  const FALLBACK = { width: 300, height: 480 }; // the vendor's default panel

  /* `.amazon-connect-widget-parent` is the class the portal's anchor script
     adds in the same breath as top/left, so these rules only ever fire where
     the stretch can happen. Shrinking the box and letting its own box pass
     clicks through leaves the chat itself — a direct child — fully clickable.
     The panel rule then puts the box where *we* want it: an important rule
     beats the portal's inline writes, so no re-anchor can move a panel the user
     has dragged, whatever the portal does to the DOM mid-conversation. */
  const CSS = `
    .amazon-connect-widget-parent{width:max-content!important;height:max-content!important;
      bottom:auto!important;right:auto!important;pointer-events:none!important}
    .amazon-connect-widget-parent>*{pointer-events:auto!important}
    .ubif-plus-chat-panel{top:var(${TOP})!important;left:var(${LEFT})!important;
      bottom:auto!important;right:auto!important}
    /* The drag bar lives in padding added to the frame, above the vendor's
       iframe, so no chat control is ever covered. The vendor's own mobile and
       fullscreen frame layouts are left alone. */
    #amazon-connect-widget-frame:not(.x-large):not(.mobile){position:relative!important;padding-top:${GRIP_BAR}px!important}
    .ubif-plus-chat-grip{display:none}
    .ubif-plus-support-minimized #amazon-connect-widget-frame{display:none!important}
    #amazon-connect-widget-frame:not(.x-large):not(.mobile)>.${GRIP}{
      display:flex;position:absolute;top:0;left:0;right:0;height:${GRIP_BAR}px;z-index:3;
      align-items:center;padding:0 10px;cursor:grab;user-select:none;touch-action:none;
      background:var(--aui-surface-variant,#f4f2f7);color:var(--aui-on-surface-soft,#5d5e61);
      border-bottom:1px solid var(--aui-outline-soft,#e6e3ec);border-radius:4px 4px 0 0;
      font:600 12px/1 system-ui,-apple-system,sans-serif;letter-spacing:.01em}
    .ubif-plus-chat-grip::before{content:'⠿';margin-right:8px}
    .ubif-plus-chat-grip:active{cursor:grabbing}
    .ubif-plus-chat-grip:focus-visible{outline:2px solid var(--aui-primary,#8224ce);outline-offset:-2px}
    .ubif-plus-chat-min{margin-left:auto;border:0;background:transparent;color:inherit;
      font:600 15px/1 system-ui,-apple-system,sans-serif;padding:3px 6px;border-radius:4px;
      cursor:pointer}
    #ubif-plus-chat-resume{position:fixed;bottom:16px;right:16px;z-index:2147483647;padding:12px 16px;border:0;border-radius:8px;background:#8224ce;color:#fff;cursor:pointer;font:600 14px/1.4 system-ui;box-shadow:0 2px 12px #0003}
    .ubif-plus-chat-status{padding:8px;background:#fff;color:#333;font:13px/1.4 system-ui}
    .ubif-plus-chat-pop{border:0;background:transparent;color:inherit;cursor:pointer;padding:3px 6px;font:600 15px/1 system-ui}
    .ubif-plus-chat-min:hover{background:rgba(0,0,0,.1)}
    .ubif-plus-chat-min:focus-visible{outline:2px solid var(--aui-primary,#8224ce);outline-offset:-1px}
    .ubif-plus-chat-launch{position:relative!important}
    .ubif-plus-chat-badge{position:absolute;top:-7px;right:-9px;min-width:18px;height:18px;
      padding:0 5px;border-radius:9px;background:var(--aui-primary,#8224ce);color:#fff;
      font:700 11px/18px system-ui,-apple-system,sans-serif;text-align:center;display:none;
      pointer-events:none}
    .ubif-plus-chat-badge.ubif-plus-chat-badge-on{display:block}`;

  let config = {};
  let enabled = false, pending = false, saved = null, drag = null;
  let unread = 0, minimizedByUs = false, chatObserver = null, watchedDoc = null;
  let handoff = null, launchAttempts = 0, lastLaunch = 0;
  let popout = null, draftRestoredDoc = null;
  const session = () => { try { return sessionStorage.getItem(SESSION_KEY) || ''; } catch { return ''; } };
  function readState() {
    try {
      const value = JSON.parse(sessionStorage.getItem(STATE_KEY));
      return value && value.session === session() && value.session ? value : null;
    } catch { return null; }
  }
  let recovery = readState();
  let incomingHandoff = null;
  try {
    incomingHandoff = JSON.parse(sessionStorage.getItem(HANDOFF_KEY));
    sessionStorage.removeItem(HANDOFF_KEY);
    if (!incomingHandoff || Date.now() - incomingHandoff.created > 60000 || !recovery) incomingHandoff = null;
  } catch {}

  function writeState(value) {
    try { sessionStorage.setItem(STATE_KEY, JSON.stringify(value)); return true; }
    catch { return false; }
  }
  // Only the message composer is restored. Files and pre-chat forms are never
  // submitted or replayed. The vendor owns session tokens and transcript recovery.
  function composer(doc) {
    return doc && doc.querySelector('textarea:not([disabled]), [contenteditable="true"][role="textbox"]');
  }
  const draftText = node => node ? (node.tagName === 'TEXTAREA' ? node.value : node.textContent) : '';
  function remember() {
    if (!enabled || recovery) return;
    if (!session()) {
      try { sessionStorage.removeItem(STATE_KEY); } catch {}
      return;
    }
    const old = readState();
    const input = composer(watchedDoc);
    writeState({ session: session(), open: chatVisible(), minimized: minimizedByUs,
      unread, draft: input ? draftText(input) : (old && old.draft || '') });
  }
  function restoreDraft(doc) {
    const input = composer(doc);
    const state = readState();
    if (!input || draftRestoredDoc === doc) return;
    draftRestoredDoc = doc;
    if (!state || !state.draft) return;
    // Never overwrite text the user or vendor has already entered.
    if (draftText(input)) return;
    if (input.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(doc.defaultView.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(input, state.draft);
    } else input.textContent = state.draft;
    input.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
  }
  function restoreWidget() {
    if (!recovery || recovery.session !== session()) { recovery = null; return; }
    const current = frame();
    if (!current) {
      const button = launchButton();
      // Reopen only a known resumable chat; never auto-start a fresh conversation.
      if (button && !button.disabled && launchAttempts < 10 &&
          Date.now() - lastLaunch >= 1000 && (recovery.open || recovery.minimized)) {
        launchAttempts++;
        lastLaunch = Date.now();
        button.click();
      }
      return;
    }
    minimizedByUs = !!recovery.minimized;
    unread = Number.isSafeInteger(recovery.unread) && recovery.unread > 0 ? recovery.unread : 0;
    if (minimizedByUs) {
      ensureDock();
      document.documentElement.classList.add(HIDDEN);
      current.style.display = 'none';
      current.classList.remove('show');
    } else if (recovery.open) showFrame();
    recovery = null;
  }
  function tabError(button, text) {
    button.title = text;
    let notice = frame().querySelector('.ubif-plus-chat-status');
    if (!notice) {
      notice = document.createElement('div');
      notice.className = 'ubif-plus-chat-status';
      notice.setAttribute('role', 'status');
      frame().append(notice);
    }
    notice.textContent = text;
  }
  function openInTab(button) {
    if (popout && !popout.closed) { popout.focus(); return; }
    if (!session()) {
      tabError(button, 'Start a support conversation before opening it in a new tab.');
      return;
    }
    remember();
    const state = readState();
    if (!state) { tabError(button, 'Session storage is unavailable. Keep this chat open.'); return; }
    const id = crypto.randomUUID();
    try {
      // window.open clones sessionStorage at creation. Open the actual portal
      // URL directly; do not access a blank tab's storage across script worlds.
      sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ id, created: Date.now() }));
      if (!writeState({ ...state, open: true, minimized: false, unread: 0 })) throw new Error('Storage unavailable');
      popout = window.open(location.href, '_blank');
      if (!popout) throw new Error('Popup blocked');
      handoff = { id, target: popout, session: session() };
      tabError(button, 'Opening support in the new tab. This chat stays open until it connects.');
      setTimeout(() => {
        if (!handoff || handoff.id !== id) return;
        handoff = null;
        // Do not close or disconnect either document on a failed handoff.
        if (frame()) tabError(button, 'The new tab has not connected. Your conversation is still here; use UBIF Support in the new tab to retry.');
      }, 30000);
    } catch {
      popout = null;
      tabError(button, 'Could not open the chat tab. Allow popups and try again; your current chat is still open.');
    } finally {
      try { sessionStorage.removeItem(HANDOFF_KEY); } catch {}
      writeState(state);
    }
  }
  function ensureDock() {
    let dock = document.getElementById(DOCK);
    if (!dock) {
      dock = document.createElement('button');
      dock.id = DOCK;
      dock.type = 'button';
      dock.addEventListener('click', restoreInPlace);
      document.body.append(dock);
    }
    const text = unread ? `Resume support chat (${unread})` : 'Resume support chat';
    if (dock.textContent !== text) dock.textContent = text;
    return dock;
  }
  function restoreInPlace() {
    if (!enabled || !frame()) return;
    minimizedByUs = false;
    document.documentElement.classList.remove(HIDDEN);
    showFrame();
    const dock = document.getElementById(DOCK);
    if (dock) dock.remove();
    clearUnread();
    remember();
  }

  const storageArea = () =>
    (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) || null;
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
  const frame = () => document.getElementById('amazon-connect-widget-frame');
  const panelOf = current => (current ? current.parentElement : null);
  const launchButton = () => document.querySelector('[data-chat-launch-button]');
  const positionOf = panel => {
    const rect = panel.getBoundingClientRect();
    return { left: rect.width ? rect.left : 0, top: rect.height ? rect.top : 0 };
  };

  /* Where the panel belongs when the user has not moved it: just below the
     UBIF Support button, in viewport coordinates, so it stays put under the
     sticky header instead of drifting with the page the way the portal's own
     scroll-adjusted anchor does. */
  function anchor() {
    const button = launchButton();
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { left: Math.round(rect.left), top: Math.round(rect.bottom + GAP) };
  }
  function clamp(target, panel) {
    const rect = panel.getBoundingClientRect();
    const width = rect.width || FALLBACK.width;
    const height = rect.height || FALLBACK.height;
    const maxLeft = Math.max(KEEP_ON_SCREEN, window.innerWidth - KEEP_ON_SCREEN);
    const maxTop = Math.max(0, window.innerHeight - KEEP_ON_SCREEN);
    return {
      left: Math.round(Math.min(Math.max(target.left, KEEP_ON_SCREEN - width), maxLeft)),
      top: Math.round(Math.min(Math.max(target.top, 0), maxTop))
    };
  }
  function place(panel, target) {
    const position = target || saved || anchor();
    if (!position) {
      panel.classList.remove(PANEL);
      panel.style.removeProperty(LEFT);
      panel.style.removeProperty(TOP);
      return null;
    }
    const clamped = clamp(position, panel);
    panel.classList.add(PANEL);
    panel.style.setProperty(LEFT, `${clamped.left}px`);
    panel.style.setProperty(TOP, `${clamped.top}px`);
    return clamped;
  }

  function persist() {
    const area = storageArea();
    if (!area || !area.set) return;
    if (saved) area.set({ [POS_KEY]: { left: saved.left, top: saved.top } }).then(() => {}, () => {});
    else if (area.remove) area.remove(POS_KEY).then(() => {}, () => {});
  }

  /* Minimizing hides the frame in place — the exact pair of changes the
     portal's own launcher branch makes — so the iframe keeps running and the
     conversation is untouched. Restoring reuses the launcher's path: clicking
     UBIF Support brings the chat back. */
  const chatVisible = () => {
    const current = frame();
    return !minimizedByUs && !!current && current.style.display !== 'none' && current.classList.contains('show');
  };
  const attentive = () => chatVisible() && !document.hidden &&
    (typeof document.hasFocus !== 'function' || document.hasFocus());
  function send(payload) {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return;
      const sent = chrome.runtime.sendMessage(payload);
      if (sent && typeof sent.then === 'function') sent.then(() => {}, () => {});
    } catch { /* the extension is reloading */ }
  }
  function showFrame() {
    const current = frame();
    if (!current) return;
    current.style.display = 'block';
    current.classList.add('show');
  }
  function minimize() {
    const current = frame();
    if (!current) return;
    minimizedByUs = true;
    ensureDock();
    document.documentElement.classList.add(HIDDEN);
    current.style.display = 'none';
    current.classList.remove('show');
    clearUnread();
    remember();
  }

  /* While the chat is out of sight — minimized, or the tab in the background —
     each arriving message grows a badge on the UBIF Support launcher and is
     handed to the background worker, which raises one desktop notification. */
  function paintBadge() {
    if (minimizedByUs) ensureDock();
    const button = launchButton();
    if (!button) return;
    button.classList.add(LAUNCH);
    let node = button.querySelector(`.${BADGE}`);
    if (!node) {
      node = document.createElement('span');
      node.className = BADGE;
      node.setAttribute('aria-hidden', 'true');
      button.append(node);
    }
    if (unread > 0 && config.supportUnreadBadge !== false) {
      const text = unread > 9 ? '9+' : String(unread);
      if (node.textContent !== text) node.textContent = text;
      node.classList.add(BADGE_ON);
    } else {
      if (node.textContent) node.textContent = '';
      node.classList.remove(BADGE_ON);
    }
  }
  function clearUnread() {
    if (!unread) return;
    unread = 0;
    paintBadge();
    send({ type: SEEN });
    remember();
  }
  function noteIncoming(el) {
    if (!enabled || attentive()) return;
    unread += 1;
    paintBadge();
    const text = el ? String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160) : '';
    send({ type: NOTE, text: config.supportMessagePreview === false ? '' : text, unread, desktop: config.supportDesktopNotifications !== false, badge: config.supportUnreadBadge !== false });
    remember();
  }

  /* The widget's iframe is same-origin — the vendor's own embedder reads its
     contentDocument — so new rows in the transcript are ours to watch. A row
     carries data-testid="message-container"; while the chat is hidden each one   becomes a badge count and a desktop note. */
  function watchChat() {
    const current = frame();
    const iframe = current && current.querySelector('iframe');
    let doc;
    try { doc = iframe && iframe.contentDocument; } catch { return; }
    if (!doc || !doc.body || watchedDoc === doc) return;
    if (chatObserver) chatObserver.disconnect();
    watchedDoc = doc;
    doc.addEventListener('input', remember);
    doc.addEventListener('change', remember);
    restoreDraft(doc);
    chatObserver = new MutationObserver(records => {
      restoreDraft(doc);
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType !== 1 || !node.querySelectorAll) continue;
          if (node.matches && node.matches(MESSAGE)) noteIncoming(node);
          for (const hit of node.querySelectorAll(MESSAGE)) noteIncoming(hit);
        }
      }
      remember();
    });
    chatObserver.observe(doc.body, { childList: true, subtree: true });
  }
  // Capture on window runs before the portal's target/bubble handler, which
  // calls its vendor launcher again and destroys the existing iframe on restore.
  addEventListener('click', event => {
    if (!enabled || !event.target.closest || !event.target.closest('[data-chat-launch-button]')) return;
    const current = frame();
    if (!current) return; // first launch remains the portal's responsibility
    event.preventDefault();
    event.stopImmediatePropagation();
    if (minimizedByUs || !chatVisible()) restoreInPlace();
    else minimize();
  }, true);

  function nudge(panel, dx, dy) {
    const base = saved || positionOf(panel) || anchor() || { left: 0, top: 0 };
    saved = place(panel, { left: base.left + dx, top: base.top + dy });
    persist();
  }

  /* The grip is ours, but it lives inside the vendor's frame so it hides with
     the chat and moves with it. React owns that frame and re-creates it when
     the widget relaunches, so the grip is re-added whenever it goes missing. */
  function wire(grip, panel) {
    grip.addEventListener('pointerdown', event => {
      if (event.target.closest('button')) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      const current = panel();
      if (!current) return;
      event.preventDefault();
      grip.focus({ preventScroll: true });
      const base = place(current);
      drag = { pointerId: event.pointerId == null ? 0 : event.pointerId, x: event.clientX, y: event.clientY, base };
      try { grip.setPointerCapture(event.pointerId); } catch {}
      addEventListener('pointermove', move);
      addEventListener('pointerup', end);
      addEventListener('pointercancel', end);
    });
    function move(event) {
      if (!drag || (event.pointerId != null && event.pointerId !== drag.pointerId)) return;
      const current = panel();
      if (!current) return;
      saved = place(current, { left: drag.base.left + event.clientX - drag.x, top: drag.base.top + event.clientY - drag.y });
    }
    function end(event) {
      if (!drag || (event.pointerId != null && event.pointerId !== drag.pointerId)) return;
      drag = null;
      try { grip.releasePointerCapture(event.pointerId); } catch {}
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', end);
      removeEventListener('pointercancel', end);
      persist();
    }
    grip.addEventListener('keydown', event => {
      if (event.target.closest('button')) return;
      const step = event.shiftKey ? 1 : NUDGE;
      const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
      const current = panel();
      if (!current || (!delta && event.key !== 'Enter')) return;
      event.preventDefault();
      if (delta) nudge(current, delta[0], delta[1]);
      else { saved = null; place(current); persist(); } // Enter snaps it back
    });
  }

  function ensureGrip(current) {
    let grip = current.querySelector(`.${GRIP}`);
    if (grip) return grip;
    grip = document.createElement('div');
    grip.className = GRIP;
    grip.tabIndex = 0;
    grip.setAttribute('aria-label', 'Move the UBIF support chat');
    grip.title = 'Drag to move the support chat. Arrow keys nudge it; Enter snaps it back under UBIF Support.';
    grip.textContent = 'UBIF support';
    const min = document.createElement('button');
    min.className = MIN;
    min.type = 'button';
    min.setAttribute('aria-label', 'Minimize the UBIF support chat');
    min.title = 'Minimize the chat — the conversation keeps running. Click UBIF Support to come back.';
    min.textContent = '–';
    min.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      minimize();
    });
    const pop = document.createElement('button');
    pop.className = POP;
    pop.type = 'button';
    pop.textContent = '↗';
    pop.setAttribute('aria-label', 'Open this support conversation in a new tab');
    pop.title = 'Continue this conversation in a new tab';
    pop.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      openInTab(pop);
    });
    grip.append(min, pop);
    wire(grip, () => panelOf(frame()));
    current.append(grip);
    return grip;
  }

  /* Fullscreen mode marks every body container except the widget itself inert
     and calls the chat a modal. The whole point of this feature is the opposite:
     the conversation stays open while the portal keeps working. */
  function releaseInert() {
    let cleared = false;
    for (const node of document.querySelectorAll(`[${INERT}]`)) {
      node.removeAttribute('inert');
      node.removeAttribute(INERT);
      cleared = true;
    }
    if (cleared) {
      const panel = panelOf(frame());
      if (panel) panel.removeAttribute('aria-modal');
    }
  }

  function apply() {
    pending = false;
    if (!enabled) return;
    restoreWidget();
    const current = frame();
    if (!current) return;
    style();
    const panel = panelOf(current);
    if (panel) place(panel);
    ensureGrip(current);
    releaseInert();
    watchChat();
    paintBadge();
    if (attentive()) { minimizedByUs = false; clearUnread(); }
  }
  function schedule() {
    if (!enabled || pending) return;
    pending = true;
    requestAnimationFrame(apply);
    // Chrome suspends animation frames in tabs it considers hidden, and a tab
    // opened in the background would otherwise never be styled. apply() clears
    // pending, so this second call is a no-op whenever the frame did run.
    setTimeout(() => { if (pending) apply(); }, 250);
  }
  function teardown() {
    document.documentElement.classList.remove(HIDDEN);
    for (const grip of document.querySelectorAll(`.${GRIP}, .ubif-plus-chat-status, #${DOCK}`)) grip.remove();
    for (const panel of document.querySelectorAll(`.${PANEL}`)) {
      panel.classList.remove(PANEL);
      panel.style.removeProperty(LEFT);
      panel.style.removeProperty(TOP);
    }
    const node = document.getElementById(STYLE_ID);
    if (node) node.remove();
    for (const badge of document.querySelectorAll(`.${BADGE}`)) badge.remove();
    for (const button of document.querySelectorAll(`.${LAUNCH}`)) button.classList.remove(LAUNCH);
    if (chatObserver) { chatObserver.disconnect(); chatObserver = null; watchedDoc = null; }
    if (unread) { unread = 0; send({ type: SEEN }); }
    minimizedByUs = false;
  }

  // The widget mounts, relaunches and marks the page inert long after load.
  if (document.body) {
    new MutationObserver(records => {
      if (records.some(record => record.type === 'childList' || record.attributeName === 'inert')) schedule();
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['inert'] });
  }
  addEventListener('pageshow', schedule);
  addEventListener('pagehide', remember);
  // Covers vendor visibility changes and session establishment even if neither
  // produces a transcript row. Do not write during recovery before it mounts.
  setInterval(() => {
    if (!enabled) return;
    schedule();
    if (!recovery) remember();
  }, 1000);
  addEventListener('resize', schedule);
  addEventListener('focus', () => { if (attentive()) clearUnread(); });
  document.addEventListener('visibilitychange', () => {
    schedule(); // a tab brought back into view needs the panel re-anchored
    if (attentive()) clearUnread();
  });
  // The embedder forwards the widget's own "new message" call to the page as a
  // safety net, in case the transcript DOM is ever out of reach.
  addEventListener('message', event => {
    const data = event && event.data;
    if (enabled && handoff && handoff.session === session() && event.origin === location.origin && event.source === handoff.target &&
        data && data.type === READY && data.id === handoff.id) {
      handoff = null;
      const notice = frame() && frame().querySelector('.ubif-plus-chat-status');
      if (notice) notice.remove();
      minimize();
      return;
    }
    const iframe = frame() && frame().querySelector('iframe');
    if (!iframe || event.source !== iframe.contentWindow || event.origin !== location.origin) return;
    if (enabled && incomingHandoff && data && data.call === 'amazon-connect-chat-started' && session()) {
      try {
        if (window.opener) window.opener.postMessage({ type: READY, id: incomingHandoff.id }, location.origin);
        window.opener = null;
      } catch {}
      incomingHandoff = null;
    }
    if (data && data.call === CHAT_CALL) noteIncoming(null);
  });
  const area = storageArea();
  if (area && area.get) area.get(POS_KEY).then(data => {
    const position = data && data[POS_KEY];
    if (position && Number.isFinite(Number(position.left)) && Number.isFinite(Number(position.top))) {
      saved = { left: Number(position.left), top: Number(position.top) };
      schedule();
    }
  }, () => {});

  const setEnabled = settings => {
    config = settings || {};
    const next = config.support !== false;
    if (enabled) paintBadge();
    if (!next || config.supportDesktopNotifications === false || config.supportUnreadBadge === false) send({ type: 'ubif-plus-chat-preferences', desktop: next && config.supportDesktopNotifications !== false, badge: next && config.supportUnreadBadge !== false });
    if (next === enabled) { if (next) schedule(); return; }
    enabled = next;
    // The rule set is in place before the widget opens, so the first frame of
    // the panel is already the size of the chat.
    if (next) { style(); schedule(); } else teardown();
  };
  if (S) { S.get().then(setEnabled, () => {}); S.subscribe(setEnabled); } else setEnabled({});
})();
