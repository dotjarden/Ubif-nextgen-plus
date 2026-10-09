/* Fictional, in-memory Portal responses for the local preview only. */
(() => {
  const date = (days, hour) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d.toISOString(); };
  const rows = [
    [10001234, 9, 'Alex Morgan', 'Samsung Galaxy S25 · Charging issue', -2, 11],
    [10001235, 3, 'Taylor Reed', 'PlayStation 5 · HDMI port', 0, 15],
    [10001236, 2, 'Sam Rivera', 'iPhone 16 · Screen repair', -1, 14],
    [10001237, 7, 'Casey Lee', 'Pixel 9 · Battery', 0, 12],
    [10001238, 8, 'Morgan Quinn', 'MacBook Air · No power', 0, 17],
    [10001239, 10, 'Jamie Park', 'iPad Air · Display', 0, 16],
    [10001240, 13, 'Robin Ellis', 'iPhone 15 · Charging port', 0, 10],
    [10001241, 3, 'Drew Avery', 'Galaxy S24 · Rear glass', 1, 14]
  ].map(([workorderId, workorderStatusId, name, device, days, hour]) => ({ workorderId, workorderStatusId, programId: 20001,
    customer: { fullName: name }, deviceCatalog: { name: device }, CustomerDevice: { customerId: workorderId + 100 },
    nextUpdate: date(days, hour), updatedAt: date(-3, 9) }));
  const notes = new Map(rows.map(r => [r.workorderId, [{ noteId: r.workorderId, workorderId: r.workorderId, noteType: 2,
    createdAt: date(-2, 10), noteText: 'Fictional preview note. Customer expects an update at the scheduled time.' }]]));
  const fetchOriginal = window.fetch.bind(window);
  window.fetch = async (path, options = {}) => {
    if (!String(path).startsWith('/api/')) return fetchOriginal(path, options);
    const url = new URL(path, location.origin); const body = options.body ? JSON.parse(options.body) : {};
    const id = Number(url.pathname.match(/\/(\d+)(?:\/|$)/)?.[1] || url.searchParams.get('workorderId') || body.workorderId);
    const row = rows.find(r => r.workorderId === id);
    let data;
    if (url.pathname === '/api/workorders') data = { workOrders: rows, rowCount: rows.length };
    else if (url.pathname.startsWith('/api/program-attributes/')) data = {};
    else if (url.pathname.startsWith('/api/workorder-audit-trail/')) data = [{ workorderStatusId: 9 }];
    else if (url.pathname.startsWith('/api/workorder/reset-audit-trail/')) data = [];
    else if (url.pathname === '/api/note' && options.method === 'POST') {
      data = { ...body, noteId: Date.now(), createdAt: new Date().toISOString() }; notes.get(id).unshift(data);
    } else if (url.pathname === '/api/note') data = { notes: notes.get(id), total: notes.get(id).length };
    else if (row && options.method === 'PATCH') { Object.assign(row, body, { updatedAt: new Date().toISOString() }); data = row; }
    else if (row) data = { workorder: row };
    else return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
})();
