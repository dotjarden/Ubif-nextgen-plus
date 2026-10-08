(() => {
  'use strict';
  if (globalThis.__ubifPlusStarted) return;
  globalThis.__ubifPlusStarted = true;
  const { normalize, COLUMNS, GROUPS, PRESETS, applyPreset, LAYOUT_VERSION } = globalThis.UBIFPlusModel;
  const PREFIX = 'ubif-plus.columns.v1.';
  const owner = `${Date.now()}-${Math.random()}`;
  document.documentElement.dataset.ubifPlusOwner = owner;
  // A content-script reinjection can have a different JS global while sharing
  // this document. Remove UI left by that instance before mounting our own.
  document.querySelectorAll('#ubif-plus-columns, #ubif-plus-table-style, [data-ubif-handle], [data-ubif-extra]').forEach(el => el.remove());
  document.querySelectorAll('table[data-ubif-plus]').forEach(table => table.removeAttribute('data-ubif-plus'));
  let profiles = {}, ready = false, storageError = false, current = null, pending = false, suspended = false;
  let writeQueue = Promise.resolve();
  // Records arrive from the portal's own /api/workorders responses (see page.js).
  const feed = { records: new Map(), requestBody: null, version: 0, fetching: false, tried: false, lastTab: null };
  const style = document.createElement('style');
  style.id = 'ubif-plus-table-style';
  const element = (tag, text, attrs = {}) => {
    const el = document.createElement(tag);
    if (text) el.textContent = text;
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    return el;
  };
  const escapeHtml = value => String(value).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const pageKind = () => /^\/repair\/workorders\/?$/.test(location.pathname) ? 'workorders' : /^\/check-in\/arrivals\/?$/.test(location.pathname) ? 'arrivals' : null;
  const stripCount = name => String(name || '').replace(/\s*\(\d+\)\s*$/, '').trim();
  const tabName = kind => kind === 'arrivals'
    ? (new URL(location.href).searchParams.get('tab') || 'Arrivals')
    : (stripCount(document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('aria-label') || document.querySelector('[role="tab"][aria-selected="true"]')?.textContent) || new URL(location.href).searchParams.get('tab') || 'All');
  const tabNames = () => {
    const names = [...document.querySelectorAll('[role="tab"]')].map(el => stripCount(el.getAttribute('aria-label') || el.textContent)).filter(Boolean);
    return names.length ? [...new Set(names)] : [tabName('workorders')];
  };
  const profileKey = (kind, tab) => PREFIX + (kind === 'arrivals' ? `arrivals.${tab}` : tab);
  function saveableLayout(layout, previous) {
    const activeIds = new Set(current.columns.map(c => c.id).concat(current.defaultHidden));
    const oldOrder = Array.isArray(previous?.order) ? previous.order.filter(id => !activeIds.has(id)) : [];
    const oldHidden = Array.isArray(previous?.hidden) ? previous.hidden.filter(id => !activeIds.has(id)) : [];
    const oldWidths = Object.fromEntries(Object.entries(previous?.widths || {}).filter(([id]) => !activeIds.has(id)));
    return {
      v: LAYOUT_VERSION,
      order: [...layout.order, ...oldOrder],
      hidden: [...layout.hidden, ...oldHidden],
      widths: { ...oldWidths, ...layout.widths },
      sort: layout.sort === undefined ? (previous?.sort || null) : layout.sort
    };
  }
  function discover() {
    for (const table of document.querySelectorAll('table')) {
      const heads = [...(table.tHead?.rows[0]?.cells || [])].filter(h => !h.dataset.ubifExtra);
      const columns = heads.map(h => ({ portalId: h.dataset.columnId, label: h.textContent.trim() }));
      if (columns.length >= 2 && columns.every(c => c.portalId) && new Set(columns.map(c => c.portalId)).size === columns.length && table.tBodies[0]) {
        return { table, columns };
      }
    }
    return null;
  }
  /* One catalog entry per logical column. Headers the table renders become the
     portal's own columns (cells and handlers stay React-owned); every other
     catalog column is offered as a data column filled from the workorder feed,
     so a portal default like Status or Device/Issue is selectable on any tab. */
  function catalogFor(found, kind) {
    const workorders = kind === 'workorders';
    const byPortalId = new Map();
    const byId = new Map();
    if (workorders) for (const entry of COLUMNS) {
      byId.set(entry.id, entry);
      for (const portalId of entry.portalIds) if (!byPortalId.has(portalId)) byPortalId.set(portalId, entry);
    }
    const claimed = new Set();
    const catalog = [];
    const adopt = (entry, head) => {
      claimed.add(entry.id);
      catalog.push({ ...entry, label: head.label || entry.label, portalId: head.portalId, native: true, extra: false });
    };
    for (const head of found.columns) {
      const entry = byPortalId.get(head.portalId) || (byId.has(head.portalId) && !claimed.has(head.portalId) ? byId.get(head.portalId) : null);
      if (entry && !claimed.has(entry.id)) { adopt(entry, head); continue; }
      catalog.push({
        id: head.portalId, label: head.label, group: 'Table', portalIds: [head.portalId], width: kind === 'arrivals' ? (/customer/i.test(head.portalId) ? 280 : /device/i.test(head.portalId) ? 240 : 170) : 150,
        portalId: head.portalId, native: true, extra: false,
        display: () => ({ a: '', b: '' }), read: () => '', sortValue: () => ''
      });
    }
    if (workorders) for (const entry of COLUMNS) if (!claimed.has(entry.id)) {
      catalog.push({ ...entry, portalId: null, native: false, extra: true });
    }
    return catalog;
  }
  const defaultHiddenFor = catalog => catalog.filter(c => !c.native).map(c => c.id);
  function cleanup() {
    if (current) {
      current.events.abort();
      current.dialog.close();
      current.host.remove();
      document.querySelectorAll('[data-ubif-arrivals-toolbar]').forEach(el => el.removeAttribute('data-ubif-arrivals-toolbar'));
      current.table.querySelectorAll('[data-ubif-handle]').forEach(el => el.remove());
      current.table.querySelectorAll('[data-ubif-extra]').forEach(el => el.remove());
      current.table.removeAttribute('data-ubif-plus');
    }
    style.remove(); current = null;
  }
  function ownsPage() { return document.documentElement.dataset.ubifPlusOwner === owner; }

  function recordForRow(row) {
    const anchor = row.querySelector('a[href*="/repair/workorder/"]');
    const match = anchor && /\/repair\/workorder\/(\d+)/.exec(anchor.getAttribute('href') || '');
    if (match) return feed.records.get(match[1]) || null;
    const index = current ? current.columns.findIndex(c => c.id === 'woId') : -1;
    if (index >= 0 && row.cells[index]) {
      const digits = (row.cells[index].textContent || '').replace(/\D/g, '');
      if (digits) return feed.records.get(digits) || null;
    }
    return null;
  }
  function cellMarkup(col, record) {
    if (!record) return '<div class="ubif-x"><span class="ubif-x1 ubif-x-none">—</span></div>';
    const { a, b } = col.display(record);
    const primary = escapeHtml(a || '') || '—';
    return `<div class="ubif-x"><span class="ubif-x1">${primary}</span>${b ? `<span class="ubif-x2">${escapeHtml(b)}</span>` : ''}</div>`;
  }
  const cellFor = (row, id) => row.querySelector(`td[data-ubif-extra="${id}"]`);
  const cellCss = id => id.replace(/"/g, '\\"');

  /* Adds/removes the data cells this layout needs. React owns the rows, so this
     only ever touches cells marked as ours and never rewrites portal cells. */
  function syncCells() {
    const { table, columns, catalog, layout, version } = current;
    const wanted = layout.order.filter(id => !layout.hidden.includes(id) && catalog.some(c => c.id === id && c.extra));
    const head = table.tHead?.rows[0];
    if (!head) return;
    for (const th of [...head.cells]) if (th.dataset.ubifExtra && !wanted.includes(th.dataset.ubifExtra)) th.remove();
    for (const id of wanted) if (!head.querySelector(`th[data-ubif-extra="${id}"]`)) head.append(makeTh(id));
    const inOrder = cells => cells.slice(columns.length).every(c => c.dataset.ubifExtra)
      && cells.slice(0, columns.length).every(c => !c.dataset.ubifExtra);
    const park = (container, cells) => {
      if (inOrder(cells)) return;
      for (const id of wanted) { const el = container.querySelector(`[data-ubif-extra="${id}"]`); if (el) container.append(el); }
    };
    park(head, [...head.cells]);
    const tbody = table.tBodies[0];
    if (!tbody) return;
    for (const row of tbody.rows) {
      const cells = [...row.cells];
      const portalCells = cells.filter(c => !c.dataset.ubifExtra);
      const injectable = portalCells.length === columns.length
        && !portalCells.some(c => { const span = c.getAttribute('colspan'); return span && span !== '1'; });
      if (!injectable) { cells.filter(c => c.dataset.ubifExtra).forEach(c => c.remove()); continue; }
      for (const td of cells) if (td.dataset.ubifExtra && !wanted.includes(td.dataset.ubifExtra)) td.remove();
      for (const id of wanted) if (!cellFor(row, id)) row.append(makeTd(id));
      park(row, [...row.cells]);
      const record = recordForRow(row);
      const stamp = `${record ? record.workorderId : ''}:${version}`;
      for (const id of wanted) {
        const td = cellFor(row, id);
        if (td && td.dataset.ubifStamp !== stamp) {
          td.innerHTML = cellMarkup(catalog.find(c => c.id === id), record);
          td.dataset.ubifStamp = stamp;
        }
      }
    }
  }
  function makeTh(id) {
    const col = current.catalog.find(c => c.id === id);
    const reference = current.table.tHead.rows[0].cells[0];
    const th = element('th');
    th.className = reference ? reference.className : '';
    th.setAttribute('data-column-id', id);
    th.setAttribute('data-ubif-extra', id);
    th.append(element('div', null, { class: 'ubif-xh' }));
    th.firstChild.append(element('span', col.label, { class: 'ubif-xlabel' }));
    return th;
  }
  function makeTd(id) {
    const reference = [...current.table.tBodies[0].rows[0]?.cells || []].find(c => !c.dataset.ubifExtra);
    const td = element('td');
    td.className = reference ? reference.className : '';
    td.setAttribute('data-ubif-extra', id);
    td.dataset.ubifStamp = '';
    return td;
  }

  function sortValueFor(col, record) { return record && col.sortValue ? col.sortValue(record) : ''; }
  function applySort() {
    if (!current) return;
    const { table, layout, catalog } = current;
    const tbody = table.tBodies[0];
    if (!tbody) return;
    const rows = [...tbody.rows];
    const sort = layout.sort;
    if (!sort || !catalog.some(c => c.id === sort.id)) {
      for (const row of rows) if (row.style.order) row.style.order = '';
      return;
    }
    const col = catalog.find(c => c.id === sort.id);
    const factor = sort.dir === 'asc' ? 1 : -1;
    const ranked = rows.map((row, index) => ({ row, index, key: sortValueFor(col, recordForRow(row)) }));
    ranked.sort((a, b) => {
      const left = a.key, right = b.key;
      const cmp = typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right));
      return (cmp || a.index - b.index) * factor;
    });
    ranked.forEach((entry, position) => { entry.row.style.order = String(position + 1); });
  }
  function cycleSort(id) {
    const sort = current.layout.sort;
    const next = !sort || sort.id !== id ? { id, dir: 'asc' } : sort.dir === 'asc' ? { id, dir: 'desc' } : null;
    current.layout.sort = next;
    commitLayout();
  }

  function apply() {
    if (!current) return;
    const { table, columns, catalog, layout } = current;
    const visible = layout.order.filter(id => !layout.hidden.includes(id));
    const widthOf = id => layout.widths[id]
      || catalog.find(c => c.id === id)?.width
      || (id === 'deviceIssue' ? 240 : 140);
    const minWidth = visible.reduce((sum, id) => sum + widthOf(id), 0);
    const template = visible.map(id => layout.widths[id] ? `${layout.widths[id]}px` : `minmax(${widthOf(id)}px, 1fr)`).join(' ');
    const root = 'table[data-ubif-plus]';
    syncCells();
    // CSS placement keeps React-owned cells and their original event handlers intact.
    let css = `${root}{display:block!important;overflow-x:auto!important;width:100%!important;}
      ${root}>thead,${root}>tfoot{display:block!important;min-width:100%;width:max(100%, ${minWidth}px);}
      ${root}>tbody{display:flex!important;flex-direction:column!important;min-width:100%;width:max(100%, ${minWidth}px);}
      ${root}>*>tr{display:grid!important;grid-template-columns:${template}!important;min-width:100%;}
      ${root}>*>tr>th,${root}>*>tr>td{box-sizing:border-box;min-width:0!important;max-width:none!important;width:auto!important;grid-row:1;padding-left:28px!important;padding-right:16px!important;}
      ${root}>*>tr>td[colspan]:not([colspan="1"]){display:block!important;grid-column:1/-1!important;}
      ${root} th{position:relative!important;padding-left:28px!important;}
      ${root} [data-ubif-handle]{position:absolute;z-index:2;touch-action:none;}
      ${root} [data-ubif-handle="move"]{left:5px;top:50%;transform:translateY(-50%);border:0;background:transparent;color:var(--aui-on-surface-soft,#707070);padding:4px;cursor:grab;opacity:0;font:18px/1 system-ui;}
      ${root} [data-ubif-handle="move"]::before{content:'⠿';}
      ${root} th:hover [data-ubif-handle],${root} [data-ubif-handle]:focus-visible{opacity:1;}
      ${root} [data-ubif-handle="resize"]{right:0;top:12%;height:76%;width:7px;cursor:col-resize;border-right:2px solid transparent;}
      ${root} [data-ubif-handle="resize"]:hover,${root} [data-ubif-handle="resize"]:focus-visible{border-color:var(--aui-primary,#8224cf);outline:none;}
      ${root} th[data-ubif-drop]{box-shadow:inset 3px 0 var(--aui-primary,#8224cf);}
      ${root} [data-ubif-handle]:focus-visible{outline:2px solid var(--aui-primary,#8224cf);}`;
    columns.forEach(({ id }, index) => {
      const selector = `${root}>*>tr>th:nth-child(${index + 1}),${root}>*>tr>td:nth-child(${index + 1}):not([colspan])`;
      css += `${selector}{${layout.hidden.includes(id) ? 'display:none!important;' : `grid-column:${visible.indexOf(id) + 1}!important;`}}`;
      // The portal's tooltip/text wrappers have their own fixed widths. Let those
      // wrappers track the column while preserving the original text and links.
      if (current.kind !== 'arrivals' && /customer|device|program|location/i.test(id)) {
        const cell = `${root}>tbody>tr>td:nth-child(${index + 1})`;
        css += `${cell} div,${cell} a{box-sizing:border-box;min-width:0!important;max-width:100%!important;width:auto!important;}
          ${cell}>div{width:100%!important;}
          ${cell} a:not(:has(img)){display:block;}
          ${cell} div:not(:has(img)),${cell} a:not(:has(img)){text-overflow:ellipsis;}
          ${cell} img{flex-shrink:0;}
        `;
        if (/device/i.test(id)) css += `${cell}>div{display:flex;align-items:center;}
          ${cell}>div>a:has(img){flex:0 0 auto!important;}
          ${cell}>div>div{flex:1 1 0%!important;width:0!important;}
        `;
      }
    });
    if (current.kind === 'arrivals') {
      // Flex rows must not shrink to fit the portal's scrolling body. Preserve
      // avatar/icon dimensions instead of applying workorder wrapper overrides.
      css += `${root}>tbody>tr{flex:0 0 auto!important;height:auto!important;min-height:104px;align-items:center;}
        ${root}>tbody>tr>td{height:auto!important;max-height:none!important;min-height:0!important;padding-top:16px!important;padding-bottom:16px!important;white-space:normal;overflow-wrap:anywhere;}
        ${root}>thead>tr{align-items:center;min-height:48px;}
        ${root}>thead>tr>th{align-self:center;}
        [data-ubif-arrivals-toolbar]{display:flex!important;align-items:center;gap:12px!important;flex-wrap:wrap;}
        [data-ubif-arrivals-toolbar]>button{margin-left:auto!important;}
        [data-ubif-arrivals-toolbar]>#ubif-plus-columns{margin-left:0!important;}
      `;
    }
    for (const id of layout.order) {
      if (!catalog.some(c => c.id === id && c.extra)) continue;
      const index = visible.indexOf(id);
      css += index < 0
        ? `${root} [data-ubif-extra="${cellCss(id)}"]{display:none!important;}`
        : `${root} [data-ubif-extra="${cellCss(id)}"]{grid-column:${index + 1}!important;}`;
    }
    css += `
      ${root} [data-ubif-extra] .ubif-x{display:block;min-width:0;}
      ${root} [data-ubif-extra] .ubif-x>span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      ${root} [data-ubif-extra] .ubif-x2{font-size:12px;line-height:1.35;color:var(--aui-on-surface-soft,#6b6577);margin-top:2px;}
      ${root} [data-ubif-extra] .ubif-x-none{color:var(--aui-on-surface-soft,#9a94a3);}
      ${root} th[data-ubif-extra]{padding-right:42px!important;}
      ${root} th[data-ubif-extra] .ubif-xh{display:block;min-width:0;}
      ${root} th[data-ubif-extra] .ubif-xlabel{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      ${root} th [data-ubif-handle="sort"]{position:absolute;right:24px;top:50%;transform:translateY(-50%);border:0;background:transparent;color:var(--aui-on-surface-soft,#707070);font:14px/1 system-ui;padding:5px;cursor:pointer;border-radius:4px;}
      ${root} th [data-ubif-handle="sort"]:hover{background:var(--aui-fills-surface-contrast,#f1eef6);}`;
    if (style.textContent !== css) style.textContent = css;
    if (!style.isConnected) document.head.append(style);
    table.setAttribute('data-ubif-plus', '');
    attachHandles();
    applySort();
    const sort = layout.sort;
    for (const th of table.tHead.rows[0].cells) {
      if (!th.dataset.ubifExtra) continue;
      const button = th.querySelector('[data-ubif-handle="sort"]');
      const active = sort && sort.id === th.dataset.ubifExtra;
      th.setAttribute('aria-sort', active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
      if (button) {
        const label = active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕';
        if (button.textContent !== label) button.textContent = label;
        button.title = active ? 'Sorted. Click to reverse, click again to clear.' : 'Click to sort these rows.';
      }
    }
    for (const resize of table.querySelectorAll('[data-ubif-handle=resize]')) resize.setAttribute('aria-valuenow', String(Math.round(resize.parentElement.getBoundingClientRect().width)));
    current.summary.textContent = `${current.tab} · ${visible.length} of ${catalog.length} columns`;
    current.status.textContent = `${visible.length} of ${catalog.length} columns shown`;
    if (current.open.textContent !== `Columns (${visible.length})`) current.open.textContent = `Columns (${visible.length})`;
  }
  function commitLayout() { apply(); persist(current.layout); }
  function moveColumn(source, target) {
    if (!source || source === target) return;
    const order = current.layout.order;
    const from = order.indexOf(source), to = order.indexOf(target);
    if (from < 0 || to < 0) return;
    order.splice(from, 1); order.splice(to, 0, source);
    commitLayout();
  }
  function attachHandles() {
    const state = current;
    const signal = state.events.signal;
    // Header ids are the portal's own; map them back to the logical column so
    // widths, order and labels are stored the same way everywhere.
    const keyOf = th => th.dataset.ubifExtra
      || (state.columns.find(c => c.portalId === th.dataset.columnId) || {}).id
      || th.dataset.columnId;
    for (const th of state.table.tHead.rows[0].cells) {
      if (state.boundHeaders.has(th)) continue;
      state.boundHeaders.add(th);
      const id = keyOf(th);
      const column = state.catalog.find(c => c.id === id) || { label: th.dataset.columnId };
      const label = column.label;
      const grip = element('button', '', { type: 'button', 'data-ubif-handle': 'move', 'aria-label': `Move ${label}`, title: 'Drag to reorder. Use Left or Right arrow keys to move.' });
      const resize = element('span', '', { 'data-ubif-handle': 'resize', role: 'separator', tabindex: '0', 'aria-orientation': 'vertical', 'aria-valuemin': '100', 'aria-valuemax': '600', 'aria-valuenow': String(state.layout.widths[id] || 140), 'aria-label': `Resize ${label}`, title: 'Drag to resize. Use Left or Right arrow keys to resize.' });
      grip.addEventListener('click', e => e.stopPropagation(), {signal});
      grip.addEventListener('dragstart', e => { state.dragId = id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); e.stopPropagation(); }, {signal});
      let moving;
      grip.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        moving = { x: e.clientX, y: e.clientY, target: null };
        grip.setPointerCapture(e.pointerId);
      }, {signal});
      grip.addEventListener('pointermove', e => {
        if (!moving || Math.hypot(e.clientX - moving.x, e.clientY - moving.y) < 5) return;
        const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('th[data-column-id]');
        clearDrop();
        moving.target = target && target.closest('table') === state.table ? keyOf(target) : null;
        if (moving.target && moving.target !== id) target.setAttribute('data-ubif-drop', '');
      }, {signal});
      grip.addEventListener('pointerup', e => {
        if (!moving) return;
        const target = moving.target; moving = null; clearDrop();
        if (grip.hasPointerCapture(e.pointerId)) grip.releasePointerCapture(e.pointerId);
        moveColumn(id, target);
      }, {signal});
      grip.addEventListener('pointercancel', () => { moving = null; clearDrop(); }, {signal});
      const clearDrop = () => state.table.querySelectorAll('[data-ubif-drop]').forEach(el => el.removeAttribute('data-ubif-drop'));
      grip.addEventListener('dragend', () => { state.dragId = null; clearDrop(); }, {signal});
      th.addEventListener('dragover', e => { if (state.dragId) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; clearDrop(); th.setAttribute('data-ubif-drop', ''); } }, {signal});
      th.addEventListener('drop', e => { if (state.dragId) { e.preventDefault(); e.stopPropagation(); moveColumn(state.dragId, keyOf(th)); state.dragId = null; clearDrop(); } }, {signal});
      grip.addEventListener('keydown', e => {
        if (!['ArrowLeft','ArrowRight'].includes(e.key)) return;
        e.preventDefault(); e.stopPropagation();
        const visible = state.layout.order.filter(key => !state.layout.hidden.includes(key));
        moveColumn(id, visible[visible.indexOf(id) + (e.key === 'ArrowLeft' ? -1 : 1)]);
      }, {signal});
      resize.addEventListener('click', e => e.stopPropagation(), {signal});
      resize.addEventListener('keydown', e => {
        if (!['ArrowLeft','ArrowRight'].includes(e.key)) return;
        e.preventDefault(); e.stopPropagation();
        state.layout.widths[id] = Math.min(600, Math.max(100, Math.round(th.getBoundingClientRect().width) + (e.key === 'ArrowLeft' ? -10 : 10)));
        commitLayout();
      }, {signal});
      let resizing;
      resize.addEventListener('pointerdown', e => { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); resizing = { x: e.clientX, width: th.getBoundingClientRect().width }; resize.setPointerCapture(e.pointerId); }, {signal});
      resize.addEventListener('pointermove', e => {
        if (!resizing) return;
        state.layout.widths[id] = Math.min(600, Math.max(100, Math.round(resizing.width + e.clientX - resizing.x)));
        apply();
      }, {signal});
      const finish = () => { if (resizing) { resizing = null; commitLayout(); } };
      resize.addEventListener('pointerup', finish, {signal});
      resize.addEventListener('pointercancel', finish, {signal});
      th.append(grip, resize);
      if (th.dataset.ubifExtra) {
        const sortButton = element('button', '↕', { type: 'button', 'data-ubif-handle': 'sort', 'aria-label': `Sort rows by ${label}` });
        sortButton.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); cycleSort(id); }, {signal});
        th.append(sortButton);
      } else {
        // A portal sort re-orders rows server side, so our own order is stale then.
        th.addEventListener('click', () => { if (state.layout.sort) { state.layout.sort = null; commitLayout(); } }, {signal});
      }
    }
  }

  function setNotice(text, isError) {
    current.notice.textContent = text;
    if (isError) current.notice.setAttribute('data-error', ''); else current.notice.removeAttribute('data-error');
    current.save.textContent = text;
    if (isError) current.save.setAttribute('data-error', ''); else current.save.removeAttribute('data-error');
  }
  function persistTo(key, layout, quiet) {
    const stored = JSON.parse(JSON.stringify(saveableLayout(layout, profiles[key])));
    profiles[key] = stored;
    if (!quiet) setNotice('Saving…', false);
    writeQueue = writeQueue.catch(() => {}).then(() => chrome.storage.local.set({ [key]: stored }));
    if (quiet) return writeQueue;
    return writeQueue.then(() => {
      storageError = false;
      setNotice('Saved', false);
    }, () => {
      storageError = true;
      setNotice('Could not save. Changes apply until you reload.', true);
    });
  }
  function persist(layout) { return persistTo(current.key, layout, false); }
  function persistAllTabs(layout) {
    const keys = tabNames().map(name => profileKey(current.kind, name)).filter(key => key !== current.key);
    return Promise.all(keys.map(key => persistTo(key, layout, true)))
      .then(() => keys.length, () => 0);
  }

  /* The portal's design tokens are custom properties on the page, so the dialog
     follows the portal's own light/dark theme without knowing about it. */
  const UI_CSS = `
    :host{--s0:var(--aui-surface,#ffffff);--s1:var(--aui-surface-variant,#faf9fc);--s2:var(--aui-sub-surface,#f1f0f4);
      --ink:var(--aui-on-surface,#1a1c1e);--ink-soft:var(--aui-on-surface-soft,#5d5e61);
      --line:var(--aui-outline,#c6c6ca);--line-soft:var(--aui-outline-soft,#eeedf1);
      --brand:var(--aui-primary,#8223d2);--brand-ink:var(--aui-on-primary,#ffffff);
      --hit:var(--aui-fills-surface-contrast,#0c0e110a);--err:var(--aui-status-error,#b91a24);
      --r-xs:var(--aui-border-radius-050,0.25rem);--r-sm:var(--aui-border-radius-100,0.5rem);
      --r-lg:var(--aui-border-radius-200,1rem);--r-pill:var(--aui-action-border-radius,10000rem);
      display:block;font:inherit;color:var(--ink);margin:0 0 12px}
    :host([data-inline]){display:inline-flex;position:relative;flex:0 0 auto;align-self:center;margin:0;vertical-align:middle}
    *{box-sizing:border-box}button,input{font:inherit;color:inherit}
    button:focus-visible,input:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
    .bar{display:flex;align-items:center;justify-content:flex-end;gap:12px;position:relative}
    .summary{display:none}
    .bar>button{cursor:pointer;background:var(--s0);color:var(--ink);border:1px solid var(--line);
      font:var(--native-font,inherit);border-radius:var(--native-radius,var(--r-xs));padding:var(--native-padding,8px 12px);
      height:var(--native-height,32px);display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
    .bar>button:hover{background:var(--s1)}
    .bar>.status{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
    .bar>.status[data-error]{position:absolute;top:100%;right:0;width:280px;height:auto;overflow:visible;clip-path:none;
      background:var(--s0);color:var(--err);border:1px solid var(--line);border-radius:var(--r-xs);padding:8px 10px;font-size:13px;z-index:5}
    dialog{font:inherit;color:var(--ink);background:var(--s0);border:0;border-radius:var(--r-lg);padding:0;
      width:min(560px,calc(100vw - 24px));max-height:min(88vh,760px);overflow:hidden;
      box-shadow:0 24px 64px #0c0e1133,0 2px 10px #0c0e111a}
    dialog[open]{display:flex;flex-direction:column}
    dialog:not([open]){display:none}
    dialog::backdrop{background:var(--aui-scrim-overlay,#0c0e1180)}
    header{padding:24px 24px 14px;display:flex;flex-direction:column;gap:12px}
    .head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
    h2{margin:0;font-size:24px;line-height:1.2;font-weight:400}
    p{margin:4px 0 0;color:var(--ink-soft);font-size:14px;line-height:1.45}
    .close{width:40px;height:40px;flex:0 0 auto;border-radius:var(--r-pill);border:1px solid var(--line);
      background:var(--s0);color:var(--ink);font-size:20px;line-height:1;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
    .close:hover{background:var(--s2)}
    .search{width:100%;height:40px;padding:0 12px;border:1px solid var(--line);border-radius:var(--r-xs);background:var(--s0)}
    .search::placeholder{color:var(--ink-soft)}
    .presets{display:flex;gap:8px;flex-wrap:wrap}
    .preset{cursor:pointer;padding:7px 14px;font-size:13px;border-radius:var(--r-pill);border:1px solid var(--line);background:var(--s0);color:var(--ink)}
    .preset:hover{background:var(--s2)}
    .preset[aria-pressed=true]{background:var(--brand);border-color:transparent;color:var(--brand-ink)}
    .list{padding:0 16px 8px;overflow:auto;flex:1 1 auto;min-height:140px}
    .group{position:sticky;top:0;z-index:1;background:var(--s0);display:flex;justify-content:space-between;
      font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-soft);font-weight:600;margin:16px 8px 4px}
    .row{display:flex;gap:8px;align-items:center;padding:7px 8px;border-radius:var(--r-xs)}
    .row:hover{background:var(--s1)}
    .row label{display:flex;align-items:center;gap:10px;flex:1;min-width:0;cursor:pointer;font-size:14px}
    .row .name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .row input[type=checkbox]{appearance:none;-webkit-appearance:none;width:18px;height:18px;flex:0 0 auto;cursor:pointer;margin:0;
      border:2px solid var(--line);border-radius:var(--r-xs);background:var(--s0);display:inline-grid;place-content:center}
    .row input[type=checkbox]:checked{background:var(--brand);border-color:var(--brand)}
    .row input[type=checkbox]:checked::after{content:'';width:9px;height:5px;margin-top:-2px;
      border-left:2px solid var(--brand-ink);border-bottom:2px solid var(--brand-ink);transform:rotate(-45deg)}
    .row input[type=checkbox]:disabled{opacity:.45;cursor:default}
    .tag{flex:0 0 auto;font-size:10px;letter-spacing:.05em;text-transform:uppercase;color:var(--ink-soft);
      border:1px solid var(--line-soft);border-radius:var(--r-pill);padding:2px 7px}
    .move{display:flex;gap:2px}
    .move button{cursor:pointer;padding:5px 7px;font-size:13px;line-height:1;border-radius:var(--r-xs);
      border:1px solid transparent;background:transparent;color:var(--ink-soft)}
    .move button:hover{background:var(--s2);color:var(--ink)}
    .move button:disabled{opacity:.3;cursor:default;background:transparent}
    .empty{color:var(--ink-soft);font-size:14px;padding:16px 8px;margin:0}
    footer{border-top:1px solid var(--line-soft);padding:12px 24px 20px;display:flex;flex-direction:column;gap:10px}
    .foot-top{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:13px;color:var(--ink-soft)}
    .save[data-error]{color:var(--err)}
    .hint{font-size:12px;color:var(--ink-soft);margin:0;line-height:1.45}
    .foot-actions{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
    .utility{display:flex;gap:2px;flex-wrap:wrap}
    .utility button{cursor:pointer;border:0;background:transparent;color:var(--ink-soft);font-size:13px;
      padding:8px 10px;border-radius:var(--r-xs);text-decoration:underline;text-underline-offset:3px}
    .utility button:hover{background:var(--s2);color:var(--ink)}
    .primary{cursor:pointer;background:var(--brand);color:var(--brand-ink);border:1px solid transparent;
      border-radius:var(--r-pill);padding:9px 24px;font-size:14px}
    .primary:hover{background:var(--brand);filter:brightness(1.1)}
    @media(max-width:440px){header{padding:16px 16px 12px}footer{padding:12px 16px 16px}.list{padding:0 8px 8px}
      .row label{font-size:13px}.presets{gap:6px}.utility button{padding:8px 6px}}
  `;

  function mount(found, tab, kind) {
    const catalog = catalogFor(found, kind);
    const defaultHidden = defaultHiddenFor(catalog);
    const grouped = catalog.length > found.columns.length;
    const host = element('div');
    host.id = 'ubif-plus-columns';
    const shadow = host.attachShadow({ mode: 'open' });
    const uiStyle = element('style');
    uiStyle.textContent = UI_CSS;
    const bar = element('div', null, { class: 'bar' });
    const summary = element('span', '', { class: 'summary' });
    const open = element('button', 'Columns', { type: 'button', 'aria-haspopup': 'dialog' });
    bar.append(summary, open);
    const notice = element('span', '', { class: 'status', role: 'status' });
    bar.append(notice);
    const dialog = element('dialog', null, { 'aria-labelledby': 'columns-title' });
    const header = element('header');
    const head = element('div', null, { class: 'head' });
    head.append(element('h2', 'Columns', { id: 'columns-title' }));
    const close = element('button', '×', { type: 'button', class: 'close', 'aria-label': 'Close column settings' });
    head.append(close);
    header.append(head, element('p', grouped
      ? `Show or hide columns for ${tab}. Changes apply immediately; each tab keeps its own layout.`
      : `Show columns in ${tab}.`));
    const search = element('input', null, { type: 'search', class: 'search', placeholder: 'Search columns', 'aria-label': 'Search columns' });
    const presets = element('div', null, { class: 'presets', role: 'group', 'aria-label': 'Column presets' });
    header.append(search, presets);
    const list = element('div', null, { class: 'list' });
    const footer = element('footer');
    const status = element('span', '', { class: 'counts', role: 'status' });
    const save = element('span', '', { class: 'save' });
    if (storageError) save.textContent = 'Storage unavailable. Changes apply until you reload.';
    const utility = element('div', null, { class: 'utility' });
    const reset = element('button', 'Reset layout', { type: 'button' });
    const showAll = element('button', 'Show all', { type: 'button' });
    const applyAll = element('button', 'Apply to all tabs', { type: 'button' });
    utility.append(reset, showAll, applyAll);
    const actions = element('div', null, { class: 'actions' });
    const done = element('button', 'Done', { type: 'button', class: 'primary' });
    actions.append(done);
    const footTop = element('div', null, { class: 'foot-top' });
    footTop.append(status, save);
    const footActions = element('div', null, { class: 'foot-actions' });
    footActions.append(utility, actions);
    footer.append(
      element('p', grouped
        ? '“table” columns come from the page itself; the rest are filled in from workorder data. Drag a header handle to reorder or resize.'
        : 'Drag a header handle to reorder or resize.', { class: 'hint' }),
      footTop, footActions
    );
    dialog.append(header, list, footer);
    shadow.append(uiStyle, bar, dialog);
    const buttons = [...document.querySelectorAll('button')];
    const filter = buttons.find(b => b.textContent.trim() === 'Device type');
    const program = buttons.find(b => b.textContent.trim() === 'Program');
    let filterRow = filter?.parentElement;
    // Insert beside the whole dropdown, never inside its stacked trigger/menu wrapper.
    while (filterRow && !filterRow.contains(program)) filterRow = filterRow.parentElement;
    if (kind === 'workorders' && filter && program && filterRow && !filterRow.contains(found.table)) {
      let branch = filter;
      while (branch.parentElement !== filterRow) branch = branch.parentElement;
      const native = getComputedStyle(filter);
      let visual = filter;
      while (visual !== branch && parseFloat(getComputedStyle(visual).borderTopWidth) === 0) visual = visual.parentElement;
      const controlStyle = getComputedStyle(visual);
      host.style.setProperty('--native-font', native.font);
      host.style.setProperty('--native-padding', '0 12px');
      host.style.setProperty('--native-border', parseFloat(controlStyle.borderTopWidth) > 0 ? controlStyle.border : '1px solid #bdbdbd');
      host.style.setProperty('--native-radius', parseFloat(controlStyle.borderRadius) > 0 ? controlStyle.borderRadius : '4px');
      const height = visual.getBoundingClientRect().height;
      if (height > 0) host.style.setProperty('--native-height', `${height}px`);
      host.setAttribute('data-inline', '');
      branch.after(host);
    } else if (kind === 'arrivals') {
      const add = buttons.find(b => b.textContent.trim() === 'Add new');
      if (add) {
        const native = getComputedStyle(add);
        host.style.setProperty('--native-font', native.font);
        host.style.setProperty('--native-radius', native.borderRadius || '10000px');
        const addHeight = add.getBoundingClientRect().height;
        if (addHeight > 0) host.style.setProperty('--native-height', `${addHeight}px`);
        add.parentElement.setAttribute('data-ubif-arrivals-toolbar', '');
        host.setAttribute('data-inline', '');
        add.after(host);
      } else found.table.before(host);
    } else found.table.before(host);
    const nativeColumns = found.columns
      .map(head => catalog.find(c => c.native && c.portalId === head.portalId))
      .filter(Boolean);
    current = {
      events: new AbortController(), boundHeaders: new WeakSet(), ...found,
      columns: nativeColumns,
      host, dialog, summary, status, save, notice, open, tab, kind, catalog, grouped, defaultHidden,
      key: profileKey(kind, tab),
      layout: normalize(catalog, profiles[profileKey(kind, tab)], defaultHidden)
    };
    const byId = id => catalog.find(c => c.id === id);
    const visibleIds = () => current.layout.order.filter(id => !current.layout.hidden.includes(id));
    function render(focusId) {
      const keep = list.scrollTop;
      list.replaceChildren();
      const query = search.value.trim().toLowerCase();
      let shown = 0;
      for (const group of GROUPS) {
        const ids = current.layout.order.filter(id => {
          const col = byId(id);
          return col && col.group === group && (!query || col.label.toLowerCase().includes(query));
        });
        if (!ids.length) continue;
        if (grouped) list.append(element('div', `${group} (${ids.length})`, { class: 'group' }));
        for (const id of ids) { list.append(rowFor(id)); shown++; }
      }
      if (!shown) list.append(element('p', 'No columns match that search.', { class: 'empty' }));
      syncPresets();
      list.scrollTop = keep;
      if (focusId) [...list.querySelectorAll('[data-focus]')].find(el => el.dataset.focus === focusId)?.focus();
    }
    function rowFor(id) {
      const column = byId(id);
      const row = element('div', null, { class: 'row' });
      const label = element('label');
      const checkbox = element('input', null, { type: 'checkbox', 'data-focus': `${id}-check` });
      checkbox.checked = !current.layout.hidden.includes(id);
      checkbox.disabled = checkbox.checked && visibleIds().length === 1;
      checkbox.addEventListener('change', () => setColumn(id, checkbox.checked));
      label.append(checkbox, element('span', column.label, { class: 'name' }));
      if (column.native) label.append(element('span', 'table', { class: 'tag', title: 'Rendered by this tab’s table' }));
      row.append(label);
      if (grouped) {
        const position = current.layout.order.indexOf(id);
        const holder = element('div', null, { class: 'move' });
        const up = element('button', '↑', { type: 'button', 'aria-label': `Move ${column.label} up`, title: 'Move up' });
        const down = element('button', '↓', { type: 'button', 'aria-label': `Move ${column.label} down`, title: 'Move down' });
        up.disabled = position === 0;
        down.disabled = position === current.layout.order.length - 1;
        const shift = delta => {
          const target = position + delta;
          if (target < 0 || target >= current.layout.order.length) return;
          const order = current.layout.order;
          [order[position], order[target]] = [order[target], order[position]];
          render(`${id}-check`);
          commitLayout();
        };
        up.addEventListener('click', () => shift(-1));
        down.addEventListener('click', () => shift(1));
        holder.append(up, down);
        row.append(holder);
      }
      return row;
    }
    // Live apply: every change is written straight to the table and to storage.
    function setColumn(id, on) {
      const hidden = new Set(current.layout.hidden);
      if (on) hidden.delete(id); else hidden.add(id);
      if (current.layout.order.every(key => hidden.has(key))) { render(`${id}-check`); return; }
      current.layout.hidden = [...hidden];
      render(`${id}-check`);
      commitLayout();
    }
    function applyLayout(next, note) {
      current.layout = next;
      render();
      commitLayout();
      if (note) save.textContent = note;
    }
    const presetExtras = preset => (preset.extras === 'all' ? catalog.filter(c => c.extra).map(c => c.id) : preset.extras);
    const presetMatches = preset => {
      const extras = presetExtras(preset);
      const target = catalog.filter(c => c.extra && !extras.includes(c.id)).map(c => c.id).sort().join(' ');
      const actual = current.layout.hidden.filter(id => byId(id)?.extra).sort().join(' ');
      return target === actual;
    };
    function syncPresets() {
      for (const button of presets.children) {
        const preset = PRESETS.find(p => p.id === button.dataset.preset);
        button.setAttribute('aria-pressed', String(preset && presetMatches(preset)));
      }
    }
    open.addEventListener('click', () => { search.value = ''; render(); dialog.showModal(); });
    close.addEventListener('click', () => dialog.close());
    done.addEventListener('click', () => dialog.close());
    search.addEventListener('input', () => { list.scrollTop = 0; render(); });
    for (const preset of PRESETS) {
      const button = element('button', preset.label, { type: 'button', class: 'preset' });
      button.dataset.preset = preset.id;
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => applyLayout(applyPreset(catalog, defaultHidden, preset.id, current.layout)));
      presets.append(button);
    }
    reset.addEventListener('click', () => applyLayout(normalize(catalog, null, defaultHidden)));
    showAll.addEventListener('click', () => applyLayout({ ...current.layout, hidden: [] }));
    applyAll.addEventListener('click', () => {
      persist(current.layout);
      persistAllTabs(current.layout).then(count => {
        save.textContent = count ? `Layout copied to ${count} other tab${count === 1 ? '' : 's'}.` : 'No other tabs to copy to.';
      });
    });
    dialog.addEventListener('close', () => open.focus());
  }

  function ingest(records) {
    if (!Array.isArray(records)) return;
    let found = 0;
    for (const record of records) {
      const id = record && record.workorderId;
      if (id !== undefined && id !== null) { feed.records.set(String(id), record); found++; }
    }
    if (found) { feed.version++; schedule(); }
  }
  /* Fallback for the one case interception cannot cover: the portal's own
     response was missed, so repeat its last request once to fill the cells. */
  function ensureRecords() {
    if (feed.records.size || !feed.requestBody || feed.fetching || feed.tried || typeof fetch !== 'function') return;
    feed.fetching = true;
    fetch('/api/workorders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: feed.requestBody,
      credentials: 'same-origin'
    })
      .then(res => (res && res.ok ? res.json() : null))
      .then(json => { if (json && Array.isArray(json.workOrders)) ingest(json.workOrders); })
      .catch(() => {})
      .then(() => { feed.fetching = false; feed.tried = true; });
  }
  addEventListener('message', event => {
    const data = event.data;
    if (!data || data.source !== 'ubif-plus') return;
    if (data.type === 'workorders-request') {
      if (typeof data.body === 'string') feed.requestBody = data.body;
    } else if (data.type === 'workorders') {
      ingest(data.records);
    }
  });

  function refresh() {
    pending = false;
    if (!ownsPage()) { suspended = true; observer.disconnect(); cleanup(); clearInterval(urlTimer); return; }
    if (suspended) return;
    observer.disconnect();
    try {
      const kind = pageKind();
      if (!ready || !kind) { cleanup(); return; }
      const found = discover();
      if (!found) { cleanup(); return; }
      const tab = tabName(kind);
      if (feed.lastTab !== tab) { feed.lastTab = tab; feed.tried = false; }
      const signature = JSON.stringify(found.columns);
      if (!current || current.table !== found.table || current.tab !== tab || current.kind !== kind || current.signature !== signature || !current.host.isConnected) {
        cleanup(); mount(found, tab, kind); current.signature = signature;
      }
      apply();
      if (kind === 'workorders') ensureRecords();
    } finally { observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-selected', 'data-column-id'] }); }
  }
  function schedule() { if (suspended) return; if (!pending) { pending = true; requestAnimationFrame(refresh); } }
  const observer = new MutationObserver(schedule);
  // SPA pushState does not emit popstate; a cheap URL check covers navigation without patching the portal.
  let lastUrl = location.href;
  const urlTimer = setInterval(() => { if (!ownsPage()) { schedule(); return; } if (lastUrl !== location.href) { lastUrl = location.href; schedule(); } }, 400);
  addEventListener('popstate', schedule);
  addEventListener('pagehide', () => { suspended = true; observer.disconnect(); });
  addEventListener('pageshow', () => { suspended = false; schedule(); });
  chrome.storage.local.get(null).then(data => { profiles = data || {}; }, () => { storageError = true; }).finally(() => { ready = true; schedule(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const [key, change] of Object.entries(changes)) if (key.startsWith(PREFIX)) {
      profiles[key] = change.newValue;
      if (current && key === current.key && !current.dialog.open) { current.layout = normalize(current.catalog, change.newValue, current.defaultHidden); schedule(); }
    }
  });
})();
