/* Column catalog and layout helpers shared by the content script, the demo
   preview and the tests. Field readers are pure functions over a workorder
   record; this file never stores customer data itself.

   Every column has one stable logical id. `portalIds` lists the header ids the
   portal's own tables use for that column: when the current table renders one
   of them the portal's cell is used, otherwise the same column is offered as a
   data column filled from the portal's own workorder feed. That keeps the
   column list free of duplicates and makes the portal's default columns
   available on every tab. */
(() => {
  const text = v => (v === null || v === undefined ? '' : String(v));
  const digits = v => text(v).replace(/\D/g, '');
  const formatPhone = raw => {
    let d = digits(raw);
    if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
    return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : text(raw);
  };
  const pad = n => String(n).padStart(2, '0');
  const dateLines = iso => {
    const value = text(iso);
    if (!value) return { a: '', b: '' };
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return { a: value, b: '' };
    const now = new Date();
    const today = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    const h24 = d.getHours();
    return {
      a: today ? 'Today' : `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`,
      b: `${h24 % 12 || 12}:${pad(d.getMinutes())}${h24 < 12 ? 'am' : 'pm'}`
    };
  };
  const money = v => {
    const s = text(v);
    if (!s) return '';
    const n = Number(s);
    return Number.isFinite(n) ? `$${n.toFixed(2)}` : s;
  };
  const contactFlags = customer => {
    if (!customer) return '';
    const flags = [];
    if (Number(customer.canSms)) flags.push('SMS');
    if (Number(customer.canCall)) flags.push('Call');
    if (Number(customer.canEmail)) flags.push('Email');
    return flags.join(' · ');
  };
  const joined = v => (Array.isArray(v) ? v.filter(Boolean).join(', ') : text(v));
  const of = obj => obj || {};

  const textColumn = (read, sub) => r => ({ a: text(read(r)), b: sub ? text(sub(r)) : '' });
  const dateColumn = key => r => dateLines(r[key]);

  /* Logical columns. `group` is the section used in the Columns dialog,
     `portalIds` are the header ids the portal tables have used for it. */
  const COLUMNS = [
    // Workorder
    { id: 'woId', label: 'WO #', group: 'Workorder', portalIds: ['woId'], width: 130,
      display: r => ({ a: text(r.workorderId), b: '' }), read: r => r.workorderId },
    { id: 'status', label: 'Status', group: 'Workorder', portalIds: ['woStatus', 'status'], width: 170,
      display: textColumn(r => r.workorderStatusName), read: r => r.workorderStatusName },
    { id: 'location', label: 'Location', group: 'Workorder', portalIds: ['location', 'woLocation', 'locationBin'], width: 140,
      display: textColumn(r => r.locationBin), read: r => r.locationBin },
    { id: 'total', label: 'Total', group: 'Workorder', portalIds: ['workorderTotal', 'total'], width: 120,
      display: r => ({ a: money(r.workorderTotal), b: '' }), read: r => money(r.workorderTotal) },
    { id: 'nextUpdate', label: 'Next update', group: 'Workorder', portalIds: ['nextUpdate'], width: 155, date: true,
      display: dateColumn('nextUpdate'), read: r => r.nextUpdate },
    { id: 'lastUpdate', label: 'Last update', group: 'Workorder', portalIds: ['lastUpdate', 'updated'], width: 155, date: true,
      display: dateColumn('updatedAt'), read: r => r.updatedAt },
    { id: 'created', label: 'Created', group: 'Workorder', portalIds: ['createdDate', 'createdAt'], width: 155, date: true,
      display: dateColumn('createdAt'), read: r => r.createdAt },
    { id: 'completed', label: 'Completed', group: 'Workorder', portalIds: ['completed'], width: 155, date: true,
      display: dateColumn('rfpWorkorderStatusDate'), read: r => r.rfpWorkorderStatusDate },
    { id: 'outcome', label: 'Service outcome', group: 'Workorder', portalIds: [], width: 190,
      display: textColumn(r => r.serviceOutcome), read: r => r.serviceOutcome },
    { id: 'waitingSince', label: 'Waiting since', group: 'Workorder', portalIds: [], width: 150, date: true,
      display: dateColumn('rfpWorkorderStatusDate'), read: r => r.rfpWorkorderStatusDate },
    // Program
    { id: 'program', label: 'Program', group: 'Program', portalIds: ['woProgram', 'program'], width: 180,
      display: textColumn(r => r.programName), read: r => r.programName },
    { id: 'claim', label: 'Claim #', group: 'Program', portalIds: [], width: 130,
      display: textColumn(r => r.claimNumber), read: r => r.claimNumber },
    { id: 'client', label: 'Client ID', group: 'Program', portalIds: [], width: 110,
      display: textColumn(r => r.clientId), read: r => r.clientId },
    // Customer
    { id: 'customerName', label: 'Customer', group: 'Customer', portalIds: ['customerName'], width: 175,
      display: textColumn(r => of(r.customer).fullName), read: r => of(r.customer).fullName },
    { id: 'phone', label: 'Phone', group: 'Customer', portalIds: [], width: 175,
      display: textColumn(r => formatPhone(of(r.customer).primaryPhoneNumber), r => contactFlags(r.customer)),
      read: r => of(r.customer).primaryPhoneNumber },
    { id: 'email', label: 'Email', group: 'Customer', portalIds: [], width: 230,
      display: textColumn(r => of(r.customer).email), read: r => of(r.customer).email },
    { id: 'csuId', label: 'Customer ID', group: 'Customer', portalIds: [], width: 150,
      display: textColumn(r => of(r.customer).csuCustomerId), read: r => of(r.customer).csuCustomerId },
    // Device
    { id: 'deviceIssue', label: 'Device/Issue', group: 'Device', portalIds: ['deviceCatalogName'], width: 240,
      display: r => ({ a: text(of(of(r.deviceCatalog).name || of(r.customerDevice).name)), b: joined(r.deviceIssues) }),
      read: r => of(of(r.deviceCatalog).name || of(r.customerDevice).name) },
    { id: 'deviceName', label: 'Device name', group: 'Device', portalIds: [], width: 175,
      display: textColumn(r => of(r.customerDevice).name), read: r => of(r.customerDevice).name },
    { id: 'serial', label: 'Serial/IMEI', group: 'Device', portalIds: [], width: 155,
      display: textColumn(r => of(r.customerDevice).serial || of(r.customerDevice).imei),
      read: r => of(r.customerDevice).serial || of(r.customerDevice).imei },
    { id: 'imei', label: 'IMEI', group: 'Device', portalIds: [], width: 155,
      display: textColumn(r => of(r.customerDevice).imei), read: r => of(r.customerDevice).imei },
    // The portal sends an encrypted blob here, never the code itself.
    { id: 'passcode', label: 'Passcode set', group: 'Device', portalIds: [], width: 130,
      display: r => ({ a: of(r.customerDevice).passcode ? 'Set' : '—', b: '' }),
      read: r => (of(r.customerDevice).passcode ? 'Set' : '') },
    { id: 'issues', label: 'Issues', group: 'Device', portalIds: [], width: 240,
      display: textColumn(r => joined(r.deviceIssues)), read: r => joined(r.deviceIssues) },
    { id: 'items', label: 'Items with device', group: 'Device', portalIds: [], width: 160,
      display: textColumn(r => r.itemswithdevice), read: r => r.itemswithdevice }
  ];
  COLUMNS.forEach(col => {
    col.sortValue = record => {
      if (!record) return '';
      if (col.date) {
        const t = Date.parse(col.read(record) || '');
        return Number.isNaN(t) ? '' : t;
      }
      const { a, b } = col.display(record);
      return `${a} ${b}`.trim().toLowerCase();
    };
  });

  /* 'Table' holds columns the portal renders that this catalog does not know,
     and every column on pages without a workorder feed (Arrivals). */
  const GROUPS = ['Workorder', 'Program', 'Customer', 'Device', 'Table'];
  const PRESETS = [
    { id: 'portal', label: 'Portal only', extras: [] },
    { id: 'contact', label: 'Contact', extras: ['phone', 'email', 'csuId'] },
    { id: 'ops', label: 'Ops board', extras: ['status', 'location', 'total', 'lastUpdate', 'issues'] },
    { id: 'all', label: 'Everything', extras: 'all' }
  ];

  const clamp = v => Math.min(600, Math.max(100, Math.round(v)));
  const idsOf = columns => new Set(columns.map(c => c.id));
  /* Layouts saved before logical ids existed carry the portal's header id or an
     `x.*` data id; both are folded onto the logical id. */
  const LAYOUT_VERSION = 3;
  const LEGACY_IDS = {
    deviceCatalogName: 'deviceIssue', createdDate: 'created', woStatus: 'status',
    woProgram: 'program', workorderTotal: 'total',
    'x.status': 'status', 'x.outcome': 'outcome', 'x.rfpDate': 'waitingSince',
    'x.program': 'program', 'x.claim': 'claim', 'x.client': 'client',
    'x.phone': 'phone', 'x.email': 'email', 'x.csuId': 'csuId',
    'x.deviceName': 'deviceName', 'x.serial': 'serial', 'x.imei': 'imei',
    'x.passcode': 'passcode', 'x.issues': 'issues', 'x.items': 'items',
    'x.bin': 'location', 'x.total': 'total', 'x.updated': 'lastUpdate',
    'x.nextUpdate': 'nextUpdate'
  };
  const logicalId = id => LEGACY_IDS[id] || id;

  /* A layout is { v, order, hidden, widths, sort }. Columns the current table
     does not supply keep their saved preference so a tab switch never loses it.
     defaultHidden lists columns that only appear once the user opts in: the
     data columns the table is not rendering itself. */
  const normalize = (columns, saved, defaultHidden) => {
    const ids = idsOf(columns);
    const legacy = !saved || saved.v !== LAYOUT_VERSION;
    const mapId = id => (legacy ? logicalId(id) : id);
    const defaults = (Array.isArray(defaultHidden) ? defaultHidden : []).filter(id => ids.has(id));
    const defaultSet = new Set(defaults);
    const order = [...new Set((Array.isArray(saved?.order) ? saved.order : []).map(mapId).filter(id => ids.has(id)))];
    for (const { id } of columns) if (!order.includes(id)) order.push(id);
    let hidden = [];
    if (Array.isArray(saved?.hidden)) {
      for (const id of saved.hidden) {
        const target = mapId(id);
        // A legacy data column that the table now renders itself stays visible.
        if (legacy && id !== target && id.startsWith('x.') && !defaultSet.has(target)) continue;
        if (ids.has(target) && !hidden.includes(target)) hidden.push(target);
      }
    } else {
      hidden = [...defaults];
    }
    // Data columns are opt-in until the layout says otherwise; the version marker
    // means the saved hidden list is already in logical ids and is authoritative.
    if (legacy) for (const id of defaults) if (!hidden.includes(id)) hidden.push(id);
    if (hidden.length === order.length) hidden = hidden.filter(id => id !== order[0]);
    const savedWidths = saved?.widths && typeof saved.widths === 'object' ? saved.widths : {};
    const widths = {};
    for (const [key, value] of Object.entries(savedWidths)) if (Number.isFinite(value)) widths[mapId(key)] = clamp(value);
    const orderedWidths = {};
    for (const id of order) if (Number.isFinite(widths[id])) orderedWidths[id] = widths[id];
    const rawSort = saved?.sort;
    const sortId = rawSort && typeof rawSort.id === 'string' ? mapId(rawSort.id) : null;
    const sort = sortId && ids.has(sortId) && (rawSort.dir === 'asc' || rawSort.dir === 'desc') && !hidden.includes(sortId)
      ? { id: sortId, dir: rawSort.dir } : null;
    return { v: LAYOUT_VERSION, order, hidden, widths: orderedWidths, sort };
  };

  /* Presets reset order and visibility but keep the widths already chosen.
     Columns the table renders itself are never hidden by a preset. */
  const applyPreset = (columns, defaultHidden, presetId, previous) => {
    const preset = PRESETS.find(p => p.id === presetId) || PRESETS[0];
    const extras = preset.extras === 'all' ? columns.filter(c => c.extra).map(c => c.id) : preset.extras;
    const hidden = columns
      .filter(c => c.extra && !extras.includes(c.id))
      .map(c => c.id);
    return normalize(columns, { v: LAYOUT_VERSION, order: columns.map(c => c.id), hidden, widths: previous?.widths, sort: null }, defaultHidden);
  };

  globalThis.UBIFPlusModel = { normalize, COLUMNS, GROUPS, PRESETS, LAYOUT_VERSION, applyPreset, logicalId, formatPhone, dateLines, money };
})();
