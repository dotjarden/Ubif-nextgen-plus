(() => {
  'use strict';
  if (globalThis.__ubifPlusBoardStarted) return;
  globalThis.__ubifPlusBoardStarted = true;
  // A reinjected content script shares this document with the instance it
  // replaces; only the newest one may add its tab and host.
  const owner = `${Date.now()}-${Math.random()}`;
  document.documentElement.dataset.ubifPlusBoardOwner = owner;
  const owns = () => document.documentElement.dataset.ubifPlusBoardOwner === owner;
  const M = globalThis.UBIFPlusBoard;
  const S = globalThis.UBIFPlusSettings;
  const fallback = { board: true, boardRefreshSec: 60, boardIncludeTomorrow: false };
  let config = { ...fallback };
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
    dialog{--line:var(--aui-outline-variant,#e4e4e7);--muted:var(--aui-on-surface-soft,#66636d);--paper:var(--aui-elevated-level-03,#fff);--wash:var(--aui-surface-variant,#f7f7f8);width:min(1040px,calc(100vw - 48px));max-width:none;max-height:calc(100dvh - 48px);padding:0;border:1px solid var(--line);border-radius:12px;background:var(--paper);color:inherit;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 24px 80px #18141f40;font:400 14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}dialog:not([open]){display:none}dialog::backdrop{background:#17151d80;backdrop-filter:blur(3px)}
    dialog button{border-radius:6px;padding:10px 16px;font-size:13px;font-weight:600;min-height:40px;transition:background .12s,border-color .12s}dialog button:hover:not(:disabled){background:var(--wash);border-color:var(--muted)}dialog input,dialog select,dialog textarea{width:100%;min-width:0;border-radius:6px;border-color:var(--aui-outline,#bcbac3);font-size:14px;line-height:1.5;padding:10px 12px}dialog textarea{resize:vertical;min-height:90px;max-height:220px}dialog input[type=datetime-local]{min-height:44px;font-variant-numeric:tabular-nums}
    .dialog-head{display:flex;align-items:flex-start;gap:20px;padding:28px 32px 24px;flex-shrink:0}.head-text{min-width:0;flex:1}.eyebrow{display:block;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:5px}.dialog-head h2{margin:0;font-size:26px;font-weight:600;line-height:1.25;letter-spacing:-.025em;overflow-wrap:anywhere}.order-device{margin:8px 0 0;color:var(--muted);font-size:14px;overflow-wrap:anywhere}.head-actions{display:flex;align-items:center;gap:20px;flex-shrink:0}.head-actions a{font-size:13px;text-decoration:none;color:var(--muted)}.head-actions a:hover{text-decoration:underline;color:inherit}.head-actions .close{width:34px;min-height:34px;padding:0;border:0;background:transparent;font-size:24px;font-weight:400;line-height:1;color:var(--muted)}
    .feedback{margin:0;padding:10px 28px;border-top:1px solid var(--line);background:var(--wash);font-size:13px;flex-shrink:0}.feedback:empty{display:none}.feedback[data-error=true]{color:var(--aui-status-error,#b42318)}
    .dialog-body{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain}.order-meta{display:flex;gap:32px;align-items:flex-start;padding:16px 32px;border-block:1px solid var(--line);background:var(--wash)}.meta-item{min-width:0}.meta-label{display:block;font-size:12px;color:var(--muted);margin-bottom:5px}.pill{display:inline-flex;align-items:center;gap:7px;font-size:14px;font-weight:500;overflow-wrap:anywhere}.status-pill::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--aui-primary,#8224ce);flex-shrink:0}.pill[data-tone=overdue]{color:var(--aui-status-error,#b42318)}
    .workspace{display:grid;grid-template-columns:minmax(0, .9fr) minmax(0, 1.1fr)}.update-column{padding:28px 32px 32px}.notes-column{padding:28px 32px 32px;border-left:1px solid var(--line)}.panel{padding:0;margin:0 0 24px}.panel:last-child{margin-bottom:0}.panel h3{margin:0 0 22px;font-size:16px;line-height:1.4;font-weight:600;letter-spacing:-.01em}.panel p{margin:0 0 12px;font-size:12px;line-height:1.5}.panel .hint{color:var(--muted)}.status-panel{padding-top:24px;border-top:1px solid var(--line)}.status-panel h3{font-size:15px;margin-bottom:18px}.field{display:flex;flex-direction:column;gap:8px;margin:0 0 14px;font-size:13px;font-weight:500}.field input,.field select,.field textarea{font-weight:400}.chips{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 20px}.chips button{padding:5px 9px;min-height:30px;font-size:12px;font-weight:500;background:transparent;border-color:var(--line)}.chips button[aria-pressed=true]{color:var(--aui-primary,#8224ce);border-color:var(--aui-primary,#8224ce);background:var(--wash)}
    .actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.primary,dialog .primary{background:var(--aui-primary,#8224ce);color:var(--aui-on-primary,#fff);border-color:transparent}dialog .primary:hover:not(:disabled){background:var(--aui-primary,#8224ce);border-color:transparent;filter:brightness(.92)}.schedule-actions{margin-top:24px}.schedule-actions button{width:100%}.note-composer{margin-bottom:28px}.note-composer .field{margin-bottom:12px}.composer-footer{display:flex;align-items:center;justify-content:space-between;gap:12px}.composer-footer .hint{font-size:12px;margin:0}.history-heading{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding-top:24px;border-top:1px solid var(--line)}.history-heading h4{margin:0;font-size:13px;font-weight:600}.history-heading .status{font-size:12px;min-height:0;margin:0;text-align:right;color:var(--muted)}.history-heading .status[data-error=true]{color:var(--aui-status-error,#b42318)}
    .notes{max-height:260px;overflow:auto;overscroll-behavior:contain;padding-right:4px}.note{position:relative;margin-left:3px;padding:16px 0 2px 16px;border-left:1px solid var(--line);font-size:14px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6}.note::before{content:'';position:absolute;left:-3px;top:23px;width:5px;height:5px;border-radius:50%;background:var(--aui-outline,#bcbac3)}.note small{display:block;margin-bottom:6px;color:var(--muted);font-size:12px}.note:last-child{padding-bottom:12px}
    .notes-heading{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:22px}.notes-heading h3{margin:0}.notes-heading .reload{min-height:0;padding:0;border:0;border-radius:2px;background:transparent;font-size:12px;font-weight:500;color:var(--muted);text-decoration:underline;text-decoration-color:var(--line);text-underline-offset:3px}.notes-heading .reload:hover:not(:disabled){background:transparent;text-decoration-color:currentColor}.hidden{display:none!important}
    @media(max-width:700px){dialog{width:calc(100vw - 24px);max-height:calc(100dvh - 24px)}.dialog-head{padding:20px;gap:12px}.dialog-head h2{font-size:22px}.head-actions{gap:10px}.head-actions a{font-size:12px}.order-meta{padding:12px 20px;gap:20px;flex-wrap:wrap}.workspace{grid-template-columns:minmax(0,1fr)}.update-column,.notes-column{padding:20px}.notes-column{border-left:0;border-top:1px solid var(--line)}.feedback{padding:10px 20px}.notes{max-height:none}}
    @media(prefers-reduced-motion:reduce){dialog button{transition:none}}

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
  const dialog = el('dialog', '', { 'aria-labelledby': 'ubif-board-order-title', 'aria-describedby': 'ubif-board-order-context' });
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
    for (const state of M.statuses.filter(s => (config.boardShowEmpty !== false && permanent.has(s.id)) || rows.some(r => Number(r.workorderStatusId) === s.id))) {
      const items = rows.filter(r => Number(r.workorderStatusId) === state.id);
      const lane = el('section', '', { class: 'lane', 'aria-label': state.name, 'data-status': state.id });
      const heading = el('h3', state.name); heading.append(el('span', String(items.length))); lane.append(heading);
      if (![2, 3, 7, 8].includes(state.id)) lane.append(el('p', 'Progress this step in Portal', { class: 'native' }));
      lane.addEventListener('dragover', event => {
        const row = records.find(r => String(r.workorderId) === dragId);
        if (config.boardDragDrop !== false && row && M.canMove(row.workorderStatusId, state.id)) { event.preventDefault(); lane.dataset.drop = 'true'; event.dataTransfer.dropEffect = 'move'; }
      });
      lane.addEventListener('dragleave', () => delete lane.dataset.drop);
      lane.addEventListener('drop', event => {
        event.preventDefault(); delete lane.dataset.drop;
        const row = records.find(r => String(r.workorderId) === dragId); dragId = null;
        if (config.boardDragDrop !== false && row && M.canMove(row.workorderStatusId, state.id)) openOrder(row.workorderId, state.id);
      });
      for (const row of items) {
        const card = el('article', '', { class: 'card', draggable: String(config.boardDragDrop !== false && M.statuses.some(s => M.canMove(row.workorderStatusId, s.id))) });
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
  function panel(title, lead) {
    const node = el('section', '', { class: 'panel' });
    node.append(el('h3', title));
    if (lead) node.append(el('p', lead, { class: 'hint' }));
    return node;
  }
  function closeDialog() { if (saving) return; detailController?.abort(); selected = null; snapshot = null; refreshOpenNotes = null; dialog.close(); }
  async function openOrder(id, target) {
    if (saving) return;
    detailController?.abort(); detailController = new AbortController(); const controller = detailController;
    selected = Number(id); snapshot = null; refreshOpenNotes = null;
    dialog.replaceChildren();
    const info = el('p', 'Loading current order…', { class: 'status', role: 'status', 'aria-live': 'polite' });
    const headText = el('div', '', { class: 'head-text' });
    headText.append(el('span', `Update Today / WO #${id}`, { class: 'eyebrow', id: 'ubif-board-order-context' }), el('h2', `WO #${id}`, { id: 'ubif-board-order-title' }));
    info.className = 'feedback';
    const link = el('a', 'Open in Portal ↗', { href: `/repair/workorder/${id}`, 'aria-label': `Open full work order ${id} in Portal` });
    const close = el('button', '×', { type: 'button', class: 'close', 'aria-label': 'Close', autofocus: '' }); close.onclick = closeDialog;
    const headActions = el('div', '', { class: 'head-actions' }); headActions.append(link, close);
    const header = el('div', '', { class: 'dialog-head' }); header.append(headText, headActions);
    const body = el('div', '', { class: 'dialog-body' });
    dialog.append(header, info, body);
    if (!dialog.open) dialog.showModal();
    try {
      const fresh = await api.detail(id, controller.signal);
      if (selected !== Number(id) || controller.signal.aborted) return;
      snapshot = fresh;
      info.textContent = ''; info.dataset.error = 'false';
      const listed = records.find(r => Number(r.workorderId) === Number(id));
      headText.querySelector('h2').textContent = fresh.customer?.fullName || listed?.customer?.fullName || `WO #${id}`;
      const device = fresh.deviceCatalog?.name || listed?.deviceCatalog?.name;
      if (device) headText.append(el('p', device, { class: 'order-device' }));
      const statusPill = el('span', '', { class: 'pill status-pill' });
      const duePill = el('span', '', { class: 'pill' });
      function renderMeta() {
        statusPill.textContent = M.status(snapshot.workorderStatusId)?.name || 'Portal status';
        const due = M.localInput(snapshot.nextUpdate);
        const overdue = !!due && due.slice(0, 10) < M.localInput(new Date()).slice(0, 10);
        duePill.textContent = due
          ? `${overdue ? 'Overdue · ' : ''}${new Date(due).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`
          : 'No update time set';
        duePill.dataset.tone = overdue ? 'overdue' : 'due';
      }
      renderMeta();
      const meta = el('div', '', { class: 'order-meta' });
      for (const [label, value] of [['Current status', statusPill], ['Next customer update', duePill]]) {
        const item = el('div', '', { class: 'meta-item' });
        item.append(el('span', label, { class: 'meta-label' }), value); meta.append(item);
      }
      const workspace = el('div', '', { class: 'workspace' });
      const updateColumn = el('div', '', { class: 'update-column' });
      const notesColumn = el('div', '', { class: 'notes-column' });
      workspace.append(updateColumn, notesColumn); body.append(meta, workspace);
      // Schedule
      const date = el('input', '', { type: 'datetime-local', required: '', 'aria-label': 'Next update date and time' });
      date.value = target ? M.nextDate() : M.localInput(fresh.nextUpdate) || M.nextDate();
      const chips = el('div', '', { class: 'chips', role: 'group', 'aria-label': 'Quick update dates' });
      for (const [text, days] of [['Tomorrow', 1], ['In 2 days', 2], ['In 1 week', 7]]) {
        const chip = el('button', text, { type: 'button', 'aria-pressed': 'false' });
        chip.onclick = () => { date.value = M.nextDate(days); chips.querySelectorAll('button').forEach(n => n.setAttribute('aria-pressed', String(n === chip))); };
        chips.append(chip);
      }
      date.oninput = () => chips.querySelectorAll('button').forEach(n => n.setAttribute('aria-pressed', 'false'));
      const schedule = el('button', 'Save update time', { type: 'button', class: 'primary' });
      const scheduleActions = el('div', '', { class: 'actions schedule-actions' }); scheduleActions.append(schedule);
      const schedulePanel = panel('Schedule next update');
      schedulePanel.append(field('Date & time', date), chips);
      updateColumn.append(schedulePanel);
      // Status change
      const moveSelect = el('select', '', { 'aria-label': 'Move to status' });
      moveSelect.append(el('option', 'Keep current status', { value: '' }));
      for (const state of M.statuses.filter(s => M.canMove(fresh.workorderStatusId, s.id))) moveSelect.append(el('option', state.name, { value: state.id }));
      if (target && M.canMove(fresh.workorderStatusId, target)) moveSelect.value = String(target);
      const moveNote = el('textarea', '', { rows: '3', maxlength: '2000', 'aria-label': 'Reason for status change' });
      const noteField = field('Reason for change', moveNote);
      const moveHint = el('p', 'Use at least 10 non-space characters. For parts on order, schedule the update for the expected arrival.', { class: 'hint' });
      const move = el('button', 'Save status + update time', { type: 'button', class: 'primary' });
      const statusPanel = panel('Change status');
      statusPanel.classList.add('status-panel');
      statusPanel.append(field('Move to', moveSelect), noteField, moveHint);
      scheduleActions.append(move);
      updateColumn.append(statusPanel, scheduleActions);
      // Portal notes
      const noteText = el('textarea', '', { rows: '3', maxlength: '2000', 'aria-label': 'New work order note', placeholder: 'What did you discuss or work on?' });
      const add = el('button', 'Add note to Portal', { type: 'button' });
      const addActions = el('div', '', { class: 'composer-footer' });
      addActions.append(el('span', '10–2,000 characters', { class: 'hint', id: 'ubif-note-help' }), add);
      noteText.setAttribute('aria-describedby', 'ubif-note-help');
      const noteStatus = el('p', 'Loading notes…', { role: 'status', class: 'status' });
      const notes = el('div', '', { class: 'notes', 'aria-label': 'Portal work order notes' });
      const notesPanel = panel('Notes & activity');
      const composer = el('div', '', { class: 'note-composer' });
      composer.append(field('Add a note', noteText), addActions);
      const historyHeading = el('div', '', { class: 'history-heading' });
      historyHeading.append(el('h4', 'Order history'), noteStatus);
      const reload = el('button', 'Refresh', { type: 'button', class: 'reload', 'aria-label': 'Refresh order / notes', title: 'Refresh order and notes' });
      const notesHeading = el('div', '', { class: 'notes-heading' });
      notesHeading.append(notesPanel.querySelector('h3'), reload);
      notesPanel.append(notesHeading, composer, historyHeading, notes);
      notesColumn.append(notesPanel);
      let uncertain = false;
      // The status note, its guidance and its save button only belong on screen
      // once a destination status is chosen.
      function updateMove() {
        const moving = !!moveSelect.value;
        move.disabled = uncertain || !moving;
        noteField.classList.toggle('hidden', !moving);
        moveHint.classList.toggle('hidden', !moving);
        move.classList.toggle('hidden', !moving);
        schedule.classList.toggle('hidden', moving);
        schedule.disabled = uncertain || moving;
        add.disabled = uncertain;
      }
      moveSelect.onchange = updateMove; updateMove();
      async function loadNotes() {
        try {
          const rows = await api.notes(id, controller.signal);
          if (selected !== Number(id) || controller.signal.aborted) return;
          notes.replaceChildren();
          for (const row of rows) {
            const note = el('div', '', { class: 'note' });
            note.append(el('small', [row.createdAt ? new Date(row.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '', row.noteType === 2 ? 'Manual note' : 'Portal event'].filter(Boolean).join(' · ')), el('div', row.noteText || ''));
            notes.append(note);
          }
          notes.classList.toggle('hidden', !rows.length);
          noteStatus.textContent = rows.length ? `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}` : 'No notes yet.';
          noteStatus.dataset.error = 'false';
        } catch (error) { if (!controller.signal.aborted) { noteStatus.textContent = error.message; noteStatus.dataset.error = 'true'; } }
      }
      async function save(work, success) {
        if (saving) return;
        generation++; listController?.abort(); loading = false; refresh.disabled = false;
        saving = true; dialog.querySelectorAll('button,input,select,textarea').forEach(n => n.disabled = true);
        info.textContent = 'Saving to Portal…'; info.dataset.error = 'false';
        let confirmed = false;
        try {
          const result = await work(); confirmed = true;
          if (result) snapshot = result;
          else snapshot = await api.detail(id);
          const index = records.findIndex(r => Number(r.workorderId) === Number(id));
          if (index >= 0) records[index] = { ...records[index], workorderStatusId: snapshot.workorderStatusId, nextUpdate: snapshot.nextUpdate, updatedAt: snapshot.updatedAt };
          renderMeta(); info.textContent = success; info.dataset.error = 'false'; render(); await loadNotes();
        } catch (error) {
          uncertain = confirmed || /unknown|Status was saved|did not retain|differs/.test(error.message);
          info.dataset.error = String(!confirmed);
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
          date.value = M.localInput(next.nextUpdate) || M.nextDate(); date.oninput(); renderMeta();
          info.textContent = 'Order refreshed. Your unsent note is preserved.'; info.dataset.error = 'false'; await loadNotes(); }
        catch (error) { if (!controller.signal.aborted) { info.textContent = error.message; info.dataset.error = 'true'; } }
      };
      refreshOpenNotes = loadNotes;
      await loadNotes();
    } catch (error) {
      if (controller.signal.aborted) return;
      info.textContent = error.message; info.dataset.error = 'true';
      const retry = el('button', 'Retry', { type: 'button' }); retry.onclick = () => openOrder(id, target);
      const actions = el('div', '', { class: 'actions' }); actions.append(retry); body.append(actions);
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
  /* Applies the settings record: the feature toggle mounts or removes the tab,
     the default fills in the toolbar checkbox, and the refresh cadence restarts. */
  function apply(next) {
    if (!owns()) return;
    const previous = config;
    config = { ...fallback, ...(next || {}) };
    if (previous.boardIncludeTomorrow !== config.boardIncludeTomorrow) tomorrow.checked = !!config.boardIncludeTomorrow;
    if (!refreshTimer || ['board', 'boardAutoRefresh', 'boardRefreshSec'].some(key => previous[key] !== config[key])) scheduleRefresh();
    mount();
    if (config.board) render();
  }
  function mount() {
    if (!globalThis.document?.body || !owns()) return;
    if (!config.board || !/^\/repair\/workorders\/?$/.test(location.pathname)) { if (active) deactivate(); tab.remove(); host.remove(); return; }
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
  let refreshTimer = null;
  function scheduleRefresh() {
    clearInterval(refreshTimer);
    if (config.boardAutoRefresh === false) return;
    refreshTimer = setInterval(() => { if (config.board && !document.hidden) load(); }, config.boardRefreshSec * 1000);
  }
  window.addEventListener('focus', () => load());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  channel?.addEventListener('message', () => load());
  window.addEventListener('pagehide', () => { observer.disconnect(); listController?.abort(); detailController?.abort(); });
  window.addEventListener('pageshow', () => { mount(); observer.observe(document.body, { childList: true, subtree: true }); if (active) load(); });
  // Settings arrive after the first paint so the default behavior is immediate.
  apply();
  if (S) { S.get().then(apply, () => {}); S.subscribe(apply); }
})();
