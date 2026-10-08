(() => {
  'use strict';
  if (globalThis.__ubifPlusBoardStarted) return;
  globalThis.__ubifPlusBoardStarted = true;
  const M = globalThis.UBIFPlusBoard;
  const el = (tag, text = '', attrs = {}) => {
    const node = document.createElement(tag); node.textContent = text;
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  };
  let active = false, records = [], loading = false, listController, detailController, generation = 0;
  let refreshOpenNotes = null;
  let selected, snapshot, saving = false, dragId, lastURL = location.href, lastSync = '', selectedTab;
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('workOrderUpdate') : null;
  const api = M.createAPI(globalThis.fetch.bind(globalThis), id => channel?.postMessage({ windowId: 'ubif-plus-board', workOrderId: id }));
  const style = el('style');
  style.textContent = `[data-ubif-board-tabs]{max-width:100%;overflow-x:auto} [data-ubif-board-hidden]{display:none!important}#ubif-update-today-tab{font:inherit;white-space:nowrap;cursor:pointer;padding:12px 16px;border:0;background:transparent;color:inherit}#ubif-update-today-tab[aria-selected=true]{color:var(--aui-primary,#8224ce);box-shadow:inset 0 -3px var(--aui-primary,#8224ce)}#ubif-update-today-board{display:block;width:100%;min-width:0}#ubif-update-today-board[hidden]{display:none}`;
  document.head.append(style);
  const tab = el('button', 'Update Today', { id: 'ubif-update-today-tab', type: 'button', role: 'tab', 'aria-selected': 'false', 'aria-controls': 'ubif-update-today-board', 'data-ubif-board-tab': '' });
  const host = el('section', '', { id: 'ubif-update-today-board', role: 'tabpanel', 'aria-labelledby': tab.id, hidden: '' });
  const shadow = host.attachShadow({ mode: 'open' });
  const css = el('style');
  css.textContent = `
    :host{font:inherit;color:var(--aui-on-surface,#242128)}*{box-sizing:border-box}button,input,textarea,select{font:inherit;color:inherit}button,a,input,select,textarea{outline-offset:3px}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--aui-primary,#8224ce)}
    button{cursor:pointer;border:1px solid var(--aui-outline,#c8c2cd);border-radius:20px;padding:8px 14px;background:var(--aui-elevated-level-01,#fff)}button:disabled{opacity:.5;cursor:default}a{color:var(--aui-primary,#8224ce)}
    .toolbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:24px 0 12px}.toolbar h2{margin:0 auto 0 0;font-size:24px}.toolbar label{display:flex;align-items:center;gap:8px;font-size:14px}.toolbar input[type=search]{max-width:260px}
    input,select,textarea{border:1px solid var(--aui-outline,#bbb);border-radius:8px;padding:10px;background:var(--aui-elevated-level-01,#fff)}.hint,.status{font-size:14px;color:var(--aui-on-surface-soft,#64606b)}.status{min-height:22px}.status[data-error=true]{color:var(--aui-status-error,#b42318)}
    .lanes{display:flex;gap:16px;overflow-x:auto;align-items:flex-start;padding:12px 2px 24px;min-height:240px}.lane{flex:0 0 275px;padding:12px;border-radius:14px;background:var(--aui-surface-variant,#f3f0f6);min-height:200px;border:2px solid transparent}.lane[data-drop=true]{border-color:var(--aui-primary,#8224ce)}.lane h3{font-size:15px;margin:2px 0 14px}.lane h3 span{float:right;font-weight:400}.card{margin:10px 0;padding:14px;border:1px solid var(--aui-outline-variant,#e3dfe8);border-radius:12px;background:var(--aui-elevated-level-01,#fff);box-shadow:0 2px 4px #00000008}.card[draggable=true]{cursor:grab}.card p{margin:7px 0;font-size:14px;overflow-wrap:anywhere}.card .number{font-weight:700}.card button{margin-top:8px;width:100%;font-size:13px}.due{color:var(--aui-on-surface-soft,#62576b)}.overdue{color:var(--aui-status-error,#b42318)}.empty{padding:16px;font-size:14px}.native{font-size:12px;color:var(--aui-on-surface-soft,#62576b)}
    dialog{width:min(620px,calc(100vw - 32px));max-height:85vh;overflow:auto;padding:24px;border:1px solid var(--aui-outline,#bbb);border-radius:16px;background:var(--aui-elevated-level-03,#fff);color:inherit}dialog::backdrop{background:#0007}.dialog-head{display:flex;align-items:center;gap:16px}.dialog-head h2{margin:0 auto 0 0;font-size:22px}.field{display:flex;flex-direction:column;gap:8px;margin:20px 0}.actions{display:flex;gap:8px;flex-wrap:wrap}.primary{background:var(--aui-primary,#8224ce);color:var(--aui-on-primary,#fff);border-color:transparent}.notes{max-height:260px;overflow:auto}.note{border-top:1px solid var(--aui-outline-variant,#ddd);padding:12px 0;font-size:14px;white-space:pre-wrap;overflow-wrap:anywhere}.note small{display:block;color:var(--aui-on-surface-soft,#62576b)}.hidden{display:none!important}
  `;
  const toolbar = el('div', '', { class: 'toolbar' });
  const search = el('input', '', { type: 'search', placeholder: 'Find an order or customer', 'aria-label': 'Filter Update Today orders' });
  const tomorrow = el('input', '', { type: 'checkbox' }); const tomorrowLabel = el('label', 'Include tomorrow'); tomorrowLabel.prepend(tomorrow);
  const refresh = el('button', 'Refresh', { type: 'button' });
  toolbar.append(el('h2', 'Update Today'), search, tomorrowLabel, refresh);
  const hint = el('p', 'Active orders due today or earlier. Drag to a supported status, or open a card to schedule an update and add notes.', { class: 'hint' });
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const message = el('p', '', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const lanes = el('div', '', { class: 'lanes', 'aria-label': 'Work order status columns' });
  const dialog = el('dialog', '', { 'aria-labelledby': 'ubif-board-order-title' });
  shadow.append(css, toolbar, hint, message, lanes, dialog);
  shadow.addEventListener('keydown', event => {
    if (event.target.matches('input,textarea,select')) event.stopPropagation();
  });
  function say(text, error = false) { message.textContent = text; message.dataset.error = String(error); }
  function visible() {
    const query = search.value.trim().toLowerCase();
    return records.filter(r => M.due(r, new Date(), tomorrow.checked) && (!query ||
      [r.workorderId, r.customer?.fullName, r.deviceCatalog?.name, r.workorderStatusName].join(' ').toLowerCase().includes(query)))
      .sort((a, b) => M.localInput(a.nextUpdate).localeCompare(M.localInput(b.nextUpdate)) || Number(a.workorderId) - Number(b.workorderId));
  }
  function render() {
    const rows = visible(); lanes.replaceChildren();
    const permanent = new Set([2, 3, 7, 8, 9, 10, 13]);
    for (const state of M.statuses.filter(s => permanent.has(s.id) || rows.some(r => Number(r.workorderStatusId) === s.id))) {
      const items = rows.filter(r => Number(r.workorderStatusId) === state.id);
      const lane = el('section', '', { class: 'lane', 'aria-label': state.name, 'data-status': state.id });
      const heading = el('h3', state.name); heading.append(el('span', String(items.length))); lane.append(heading);
      if (![2, 3, 7, 8].includes(state.id)) lane.append(el('p', 'Progress this step in Portal', { class: 'native' }));
      lane.addEventListener('dragover', event => {
        const row = records.find(r => String(r.workorderId) === dragId);
        if (row && M.canMove(row.workorderStatusId, state.id)) { event.preventDefault(); lane.dataset.drop = 'true'; event.dataTransfer.dropEffect = 'move'; }
      });
      lane.addEventListener('dragleave', () => delete lane.dataset.drop);
      lane.addEventListener('drop', event => {
        event.preventDefault(); delete lane.dataset.drop;
        const row = records.find(r => String(r.workorderId) === dragId); dragId = null;
        if (row && M.canMove(row.workorderStatusId, state.id)) openOrder(row.workorderId, state.id);
      });
      for (const row of items) {
        const card = el('article', '', { class: 'card', draggable: String(M.statuses.some(s => M.canMove(row.workorderStatusId, s.id))) });
        card.append(el('a', `WO #${row.workorderId}`, { class: 'number', href: `/repair/workorder/${row.workorderId}` }),
          el('p', row.customer?.fullName || 'Customer'), el('p', row.deviceCatalog?.name || 'Device'),
          el('p', `${M.localInput(row.nextUpdate).slice(0, 10) < M.localInput(new Date()).slice(0, 10) ? 'Overdue · ' : ''}${new Date(M.localInput(row.nextUpdate)).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`, { class: 'due' }));
        const button = el('button', 'Update / notes', { type: 'button', 'aria-label': `Update or add notes to WO ${row.workorderId}` });
        button.onclick = () => openOrder(row.workorderId); card.append(button);
        card.addEventListener('dragstart', event => { dragId = String(row.workorderId); event.dataTransfer.setData('text/plain', dragId); event.dataTransfer.effectAllowed = 'move'; });
        card.addEventListener('dragend', () => { dragId = null; lanes.querySelectorAll('[data-drop]').forEach(n => delete n.dataset.drop); });
        lane.append(card);
      }
      if (!items.length) lane.append(el('p', 'No updates due', { class: 'native' }));
      lanes.append(lane);
    }
    if (!rows.length) lanes.prepend(el('p', records.length ? 'No matching updates due in this date range.' : 'No active work orders loaded.', { class: 'empty' }));
  }
  async function load() {
    if (!active || loading || saving) return;
    loading = true; refresh.disabled = true; listController = new AbortController(); const token = generation;
    say('Refreshing from Portal…');
    try {
      const next = await api.list(listController.signal);
      if (!active || token !== generation) return;
      records = next; lastSync = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); render();
      const unscheduled = records.filter(r => !M.localInput(r.nextUpdate)).length;
      say(`${visible().length} orders · Synced ${lastSync} · Times in ${zone}${unscheduled ? ` · ${unscheduled} without an update date excluded` : ''}`);
      if (!saving) await refreshOpenNotes?.();
    } catch (error) { if (active && token === generation) say(`${error.message}${lastSync ? ` Showing last sync from ${lastSync}.` : ''}`, true); }
    finally { if (token === generation) { loading = false; refresh.disabled = false; } }
  }
  function field(label, control) { const node = el('label', label, { class: 'field' }); node.append(control); return node; }
  function closeDialog() { if (saving) return; detailController?.abort(); selected = null; snapshot = null; refreshOpenNotes = null; dialog.close(); }
  async function openOrder(id, target) {
    if (saving) return;
    detailController?.abort(); detailController = new AbortController(); const controller = detailController;
    selected = Number(id); snapshot = null; refreshOpenNotes = null;
    dialog.replaceChildren();
    const header = el('div', '', { class: 'dialog-head' });
    const close = el('button', 'Close', { type: 'button' }); close.onclick = closeDialog;
    header.append(el('h2', `WO #${id}`, { id: 'ubif-board-order-title' }), close);
    const link = el('a', 'Open full work order in Portal', { href: `/repair/workorder/${id}` });
    const info = el('p', 'Loading current order…', { class: 'status', role: 'status', 'aria-live': 'polite' });
    dialog.append(header, link, info);
    if (!dialog.open) dialog.showModal();
    try {
      const fresh = await api.detail(id, controller.signal);
      if (selected !== Number(id) || controller.signal.aborted) return;
      snapshot = fresh;
      info.textContent = `${M.status(fresh.workorderStatusId)?.name || 'Portal status'} · Times in ${zone}`;
      const date = el('input', '', { type: 'datetime-local', required: '', 'aria-label': 'Next update date and time' });
      date.value = target ? M.nextDate() : M.localInput(fresh.nextUpdate) || M.nextDate();
      const plusTwo = el('button', 'In 2 days', { type: 'button' }); plusTwo.onclick = () => { date.value = M.nextDate(); };
      const schedule = el('button', 'Save update time', { type: 'button', class: 'primary' });
      const moveSelect = el('select', '', { 'aria-label': 'Move to status' });
      moveSelect.append(el('option', 'Keep current status', { value: '' }));
      for (const state of M.statuses.filter(s => M.canMove(fresh.workorderStatusId, s.id))) moveSelect.append(el('option', state.name, { value: state.id }));
      if (target && M.canMove(fresh.workorderStatusId, target)) moveSelect.value = String(target);
      const moveNote = el('textarea', '', { rows: '3', maxlength: '2000', 'aria-label': 'Reason for status change' });
      const move = el('button', 'Save status + update time', { type: 'button' });
      const moveHint = el('p', 'A status move needs a note of at least 10 non-space characters. Set the update time to the parts arrival date when applicable. Other transitions use the full Portal workflow.', { class: 'hint' });
      const noteText = el('textarea', '', { rows: '3', maxlength: '2000', 'aria-label': 'New work order note', placeholder: 'Add a note to this work order…' });
      const add = el('button', 'Add note to Portal', { type: 'button' });
      const noteStatus = el('p', 'Loading notes…', { role: 'status', class: 'status' });
      const notes = el('div', '', { class: 'notes', 'aria-label': 'Portal work order notes' });
      const reload = el('button', 'Refresh order / notes', { type: 'button' });
      const actions = el('div', '', { class: 'actions' }); actions.append(plusTwo, schedule);
      dialog.append(field('Next update', date), actions, field('Move to', moveSelect), moveHint, field('Status-change note', moveNote), move,
        el('h3', 'Portal notes'), noteStatus, notes, field('New note (10–2,000 characters)', noteText), add, reload);
      let uncertain = false;
      function updateMove() { move.disabled = uncertain || !moveSelect.value; moveNote.closest('label').classList.toggle('hidden', !moveSelect.value); schedule.disabled = uncertain || !!moveSelect.value; add.disabled = uncertain; }
      moveSelect.onchange = updateMove; updateMove();
      async function loadNotes() {
        try {
          const rows = await api.notes(id, controller.signal);
          if (selected !== Number(id) || controller.signal.aborted) return;
          notes.replaceChildren();
          for (const row of rows) {
            const note = el('div', '', { class: 'note' });
            note.append(el('small', [row.createdAt ? new Date(row.createdAt).toLocaleString() : '', row.noteType === 2 ? 'Manual note' : 'Portal event'].filter(Boolean).join(' · ')), el('div', row.noteText || ''));
            notes.append(note);
          }
          noteStatus.textContent = rows.length ? `${rows.length} notes · Synced from Portal` : 'No notes yet.';
        } catch (error) { if (!controller.signal.aborted) noteStatus.textContent = error.message; }
      }
      async function save(work, success) {
        if (saving) return;
        generation++; listController?.abort(); loading = false; refresh.disabled = false;
        saving = true; dialog.querySelectorAll('button,input,select,textarea').forEach(n => n.disabled = true); info.textContent = 'Saving to Portal…';
        let confirmed = false;
        try {
          const result = await work(); confirmed = true;
          if (result) snapshot = result;
          else snapshot = await api.detail(id);
          const index = records.findIndex(r => Number(r.workorderId) === Number(id));
          if (index >= 0) records[index] = { ...records[index], workorderStatusId: snapshot.workorderStatusId, nextUpdate: snapshot.nextUpdate, updatedAt: snapshot.updatedAt };
          info.textContent = success; render(); await loadNotes();
        } catch (error) {
          uncertain = confirmed || /unknown|Status was saved|did not retain|differs/.test(error.message);
          info.textContent = confirmed ? `${success} Could not refresh the order. Use Refresh order / notes before another save.` : error.message;
        }
        finally { saving = false; dialog.querySelectorAll('button,input,select,textarea').forEach(n => n.disabled = false); updateMove(); load(); }
      }
      schedule.onclick = () => save(() => api.schedule(snapshot, date.value), 'Update time saved in Portal.');
      add.onclick = () => save(async () => { await api.addNote(snapshot, noteText.value); noteText.value = ''; }, 'Note saved in Portal.');
      move.onclick = () => save(async () => {
        const result = await api.move(snapshot, Number(moveSelect.value), date.value, moveNote.value);
        moveNote.value = ''; moveSelect.value = '';
        for (const option of [...moveSelect.options].slice(1)) option.remove();
        for (const state of M.statuses.filter(s => M.canMove(result.workorderStatusId, s.id))) moveSelect.append(el('option', state.name, { value: state.id }));
        return result;
      }, 'Status, update time, and note saved in Portal.');
      reload.onclick = async () => {
        if (saving) return;
        try { const next = await api.detail(id, controller.signal); if (controller.signal.aborted) return; snapshot = next; uncertain = false;
          const targetValue = moveSelect.value;
          for (const option of [...moveSelect.options].slice(1)) option.remove();
          for (const state of M.statuses.filter(s => M.canMove(next.workorderStatusId, s.id))) moveSelect.append(el('option', state.name, { value: state.id }));
          moveSelect.value = M.canMove(next.workorderStatusId, Number(targetValue)) ? targetValue : ''; updateMove();
          date.value = M.localInput(next.nextUpdate) || M.nextDate(); info.textContent = 'Order refreshed. Your unsent note is preserved.'; await loadNotes(); }
        catch (error) { if (!controller.signal.aborted) info.textContent = error.message; }
      };
      refreshOpenNotes = loadNotes;
      await loadNotes();
    } catch (error) {
      if (controller.signal.aborted) return;
      info.textContent = error.message;
      const retry = el('button', 'Retry', { type: 'button' }); retry.onclick = () => openOrder(id, target); dialog.append(retry);
    }
  }
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
  refresh.onclick = load;
  search.oninput = () => { render(); say(`${visible().length} matching orders · Synced ${lastSync || 'never'} · Times in ${zone}`); };
  tomorrow.onchange = () => { render(); say(`${visible().length} matching orders · Synced ${lastSync || 'never'} · Times in ${zone}`); };
  function restore() {
    document.querySelectorAll('[data-ubif-board-hidden]').forEach(n => n.removeAttribute('data-ubif-board-hidden'));
    if (selectedTab?.isConnected) selectedTab.setAttribute('aria-selected', 'true');
    selectedTab = null;
  }
  function deactivate() {
    active = false; generation++; loading = false; refresh.disabled = false; listController?.abort();
    if (!saving) closeDialog();
    host.hidden = true; tab.setAttribute('aria-selected', 'false'); restore();
    document.documentElement.removeAttribute('data-ubif-board-active');
  }
  function mount() {
    if (!globalThis.document?.body) return;
    if (!/^\/repair\/workorders\/?$/.test(location.pathname)) { if (active) deactivate(); tab.remove(); host.remove(); return; }
    const ready = [...document.querySelectorAll('[role=tab]')].find(n => !n.hasAttribute('data-ubif-board-tab') && /ready for pickup/i.test(n.textContent));
    if (!ready) { if (active) deactivate(); tab.remove(); host.remove(); return; }
    const list = ready.closest('[role=tablist]') || ready.parentElement;
    list.setAttribute('data-ubif-board-tabs', '');
    if (!list.contains(tab)) list.append(tab);
    if (!active) return;
    for (const native of list.querySelectorAll('[role=tab][aria-selected=true]:not([data-ubif-board-tab])')) {
      if (!selectedTab?.isConnected) selectedTab = native;
      native.setAttribute('aria-selected', 'false');
    }
    const table = [...document.querySelectorAll('table')].find(n => n.querySelector('th[data-column-id]'));
    let container = list.parentElement;
    if (table) while (container && !container.contains(table)) container = container.parentElement;
    if (!container || container === document.body || container === document.documentElement) container = list.parentElement;
    // Hide native content branches below the tabs, retaining React's DOM and handlers.
    let branch = list;
    while (branch && branch !== container) {
      for (const sibling of branch.parentElement.children) {
        if (sibling !== branch && sibling !== host && (branch.compareDocumentPosition(sibling) & Node.DOCUMENT_POSITION_FOLLOWING)) sibling.setAttribute('data-ubif-board-hidden', '');
      }
      branch = branch.parentElement;
    }
    if (host.parentElement !== container) container.append(host);
  }
  tab.onclick = event => {
    event.stopPropagation(); if (active) return;
    active = true; selectedTab = document.querySelector('[role=tab][aria-selected=true]:not([data-ubif-board-tab])');
    selectedTab?.setAttribute('aria-selected', 'false'); tab.setAttribute('aria-selected', 'true');
    document.documentElement.setAttribute('data-ubif-board-active', ''); host.hidden = false;
    mount(); render(); load();
  };
  tab.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); tab.previousElementSibling?.focus(); }
    if (event.key === 'Escape' && active) { const previous = selectedTab; deactivate(); previous?.focus(); }
  });
  document.addEventListener('click', event => {
    const native = event.target.closest?.('[role=tab]:not([data-ubif-board-tab])');
    if (active && native) deactivate();
  }, true);
  let queued = false;
  const observer = new MutationObserver(() => {
    if (!queued) { queued = true; queueMicrotask(() => { queued = false; observer.disconnect(); mount(); if (globalThis.document?.body) observer.observe(document.body, { childList: true, subtree: true }); }); }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  setInterval(() => { if (location.href !== lastURL) { lastURL = location.href; if (active) deactivate(); mount(); } }, 400);
  setInterval(() => { if (!document.hidden) load(); }, 60000);
  window.addEventListener('focus', () => load());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  channel?.addEventListener('message', () => load());
  window.addEventListener('pagehide', () => { observer.disconnect(); listController?.abort(); detailController?.abort(); });
  window.addEventListener('pageshow', () => { mount(); observer.observe(document.body, { childList: true, subtree: true }); if (active) load(); });
  mount();
})();
