/* Verified against the portal R92.4 global-search API definitions. */
(() => {
  'use strict';
  const categories = ['Customers', 'Work orders', 'Items', 'Claims', 'Serial numbers'];
  const defaults = { isCrossStoreSearch: true, order: 'createdDate,DESC', includeCounts: false };
  const enc = encodeURIComponent;
  function plan(value, minChars = 3) {
    const q = value.trim();
    const get = (category, path, kind) => ({ category, path: `/api/${path}`, kind });
    const wo = (category, filter) => ({ category, path: '/api/workorders', body: { ...filter, ...defaults }, kind: 'workorders' });
    // The configured floor only raises the shared minimum; work orders and
    // claims keep their own larger portal minimums below.
    const minimum = Math.max(3, Math.round(Number(minChars) || 3));
    if (q.length < minimum || q.length > 200) return [];
    const requests = [get('Customers', `customers?searchTerm=${enc(q)}`, 'customers'), get('Items', `repair/available-parts?searchTerm=${enc(q)}`, 'items')];
    // Work orders only accept their own 5-10 digit ids; longer numbers are
    // barcodes (UPC/IMEI) that the item and customer searches already cover.
    if (/^\d{5,10}$/.test(q) && Number.isSafeInteger(Number(q))) requests.push(wo('Work orders', { workorderId: Number(q) }));
    if (q.length >= 6) {
      requests.push(wo('Claims', { claimNumber: q }));
      requests.push(get('Claims', `arrivals/upcoming-arrivals?claimNumber=${enc(q)}&isCrossStoreSearch=true`, 'arrivals'));
    }
    if (/^(?:[Ii]-\d{10}|(?:[A-Za-z]-)?\d{4,6}-\d{10})$/.test(q)) requests.push(get('Serial numbers', `boh/inventory/${enc(q)}?includeQuarantineInfo=false&includeSalvageInfo=false`, 'serial'));
    return requests;
  }
  function statusTone(value) {
    if (/^(Not confirmed)$/i.test(value)) return 'warn';
    if (/^(Confirmed)$/i.test(value)) return 'success';
    if (/missed|cancelled/i.test(value)) return 'error';
    if (/need to order|awaiting|abandoned/i.test(value)) return 'orange';
    if (/initial check|ready|diagnostic|progress|quality|repair summary/i.test(value)) return 'green';
    if (/sale complete/i.test(value)) return 'dark';
    return 'light';
  }
  function tags(record, kind) {
    const result = [], add = (text, tone = 'light') => { if (typeof text === 'string' && text.trim() && !result.some(t => t.text === text)) result.push({ text, tone }); };
    const clients = {1:'UBIF',2:'Verizon',3:'AT&T',4:'Cricket',5:'Amazon',6:'Cox',7:'USCC',8:'Bell',9:'Google',10:'Verizon'};
    if (record.clientId != null) add(clients[record.clientId] || 'Unknown client', clients[record.clientId] ? 'dark' : 'light');
    add(record.programName || record.program?.name, /asurion/i.test(record.programName || record.program?.name || '') ? 'purple' : 'light');
    add(record.source, 'dark');
    const status = record.workorderStatusName || record.workorderStatus?.name || record.arrivalStatus?.name || record.SerialStatus;
    add(status, statusTone(status || ''));
    if (record.claimNumber) add(`Claim ${record.claimNumber}`, 'light');
    if (kind === 'arrivals') add(record.appointment && record.appointment !== '--' ? 'Appointment' : 'Arrival', 'light');
    return result;
  }
  // The barcode Portal prints is the full SKU-serial, never the I- shorthand.
  function labelSerial(record, query) {
    if (typeof record.SerialNumber === 'string' && record.SerialNumber.trim()) return record.SerialNumber.trim();
    const q = query.trim(), short = /^[Ii]-(\d{10})$/.exec(q), prefixed = /^[A-Za-z]-(\d{4,6}-\d{10})$/.exec(q);
    if (/^\d{4,6}-\d{10}$/.test(q)) return q;
    if (prefixed) return prefixed[1];
    return short && /^\d{4,6}$/.test(String(record.ItemNumber)) ? `${record.ItemNumber}-${short[1]}` : '';
  }
  // Mirrors Portal's Reprint Label guard: available stock only, never the buyback SKU.
  function reprint(record, query) {
    const serial = labelSerial(record, query), text = String(record.ProductName || '').trim();
    if (String(record.SerialStatus || '').trim().toLowerCase() !== 'available' || String(record.ItemNumber) === 'BB0001' || !serial || !text) return {};
    return { reprint: { serial, text } };
  }
  // Sold serials, and parts reserved to a work order (attached but not yet
  // sold), print from that work order's cart line.
  function buybackSerial(record) {
    const status = String(record.SerialStatus || '').trim().toLowerCase();
    return status === 'sold' || (status === 'reserved' && /^\d+$/.test(String(record.WorkOrderId || '')));
  }
  function rows(request, json, query) {
    const list = request.kind === 'workorders' ? json?.workOrders : request.kind === 'arrivals' ? json?.data : request.kind === 'serial' ? (json?.ItemNumber ? [json] : []) : json;
    if (!Array.isArray(list)) throw new Error('Unexpected search response');
    return list.map(r => {
      switch (request.kind) {
        case 'customers': return { key: `customer:${r.clientId || 1}:${r.id}`, title: r.fullName || [r.firstName, r.lastName].filter(Boolean).join(' '), detail: [r.primaryPhone, r.primaryEmail].filter(Boolean).join(' · '), href: r.customerTypeId === 2 ? `/admin/business-clients/${enc(r.id)}` : `/customer/${enc(r.id)}?${new URLSearchParams({ searchTerm: query, showBreadcrumb: 'true', clientId: r.clientId || 1 })}` };
        case 'workorders': return { key: `wo:${r.workorderId}`, title: `WO #${r.workorderId} · ${r.customer?.fullName || ''}`, detail: [r.deviceCatalog?.name].filter(Boolean).join(' · '), href: `/repair/workorder/${enc(r.workorderId)}` };
        case 'items': return { buyback: { sku: String(r.itemNumber) }, key: `item:${r.itemNumber}`, title: r.name || r.itemNumber, detail: [r.itemNumber, r.AvailableQuantity == null ? '' : `${r.AvailableQuantity} available`].filter(Boolean).join(' · '), href: `/boh/inventory/store-products/${enc(r.itemNumber)}` };
        case 'arrivals': return { key: `arrival:${r.arrivalId}`, title: r.customer?.fullName || `Arrival #${r.arrivalId}`, label: r.appointment && r.appointment !== '--' ? 'Appointment' : 'Arrival', detail: [r.customerDevice?.deviceName, r.appointment].filter(Boolean).join(' · '), href: `/check-in/arrivals/${enc(r.arrivalId)}` };
        case 'serial': return { ...(buybackSerial(r) ? { buyback: { sku: String(r.ItemNumber), serial: query } } : {}), ...reprint(r, query), key: `serial:${query}`, title: r.ProductName || r.ItemNumber, detail: [query, r.Store].filter(Boolean).join(' · '), href: `/boh/inventory/store-products/${enc(r.ItemNumber)}` };
      }
    }).map((row, index) => ({ ...row, tags: tags(list[index], request.kind) }));
  }
  globalThis.UBIFPlusSearch = { categories, plan, rows };
})();
