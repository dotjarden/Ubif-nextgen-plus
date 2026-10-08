/* Verified against the portal R92.4 global-search API definitions. */
(() => {
  'use strict';
  const categories = ['Customers', 'Work orders', 'Items', 'Claims', 'Serial numbers'];
  const defaults = { isCrossStoreSearch: true, order: 'createdDate,DESC', includeCounts: false };
  const enc = encodeURIComponent;
  function plan(value) {
    const q = value.trim();
    const get = (category, path, kind) => ({ category, path: `/api/${path}`, kind });
    const wo = (category, filter) => ({ category, path: '/api/workorders', body: { ...filter, ...defaults }, kind: 'workorders' });
    if (q.length < 3 || q.length > 200) return [];
    const requests = [get('Customers', `customers?searchTerm=${enc(q)}`, 'customers'), get('Items', `repair/available-parts?searchTerm=${enc(q)}`, 'items')];
    if (/^\d{5,}$/.test(q) && Number.isSafeInteger(Number(q))) requests.push(wo('Work orders', { workorderId: Number(q) }));
    if (q.length >= 6) {
      requests.push(wo('Claims', { claimNumber: q }));
      requests.push(get('Claims', `arrivals/upcoming-arrivals?claimNumber=${enc(q)}&isCrossStoreSearch=true`, 'arrivals'));
    }
    if (/^(?:[Ii]-\d{10}|(?:[A-Za-z]-)?\d{4,6}-\d{10})$/.test(q)) requests.push(get('Serial numbers', `boh/inventory/${enc(q)}?includeQuarantineInfo=false&includeSalvageInfo=false`, 'serial'));
    return requests;
  }
  function rows(request, json, query) {
    const list = request.kind === 'workorders' ? json?.workOrders : request.kind === 'arrivals' ? json?.data : request.kind === 'serial' ? (json?.ItemNumber ? [json] : []) : json;
    if (!Array.isArray(list)) throw new Error('Unexpected search response');
    return list.map(r => {
      switch (request.kind) {
        case 'customers': return { key: `customer:${r.clientId || 1}:${r.id}`, title: r.fullName || [r.firstName, r.lastName].filter(Boolean).join(' '), detail: [r.primaryPhone, r.primaryEmail].filter(Boolean).join(' · '), href: r.customerTypeId === 2 ? `/admin/business-clients/${enc(r.id)}` : `/customer/${enc(r.id)}?${new URLSearchParams({ searchTerm: query, showBreadcrumb: 'true', clientId: r.clientId || 1 })}` };
        case 'workorders': return { key: `wo:${r.workorderId}`, title: `WO #${r.workorderId} · ${r.customer?.fullName || ''}`, detail: [r.deviceCatalog?.name, r.workorderStatusName, r.claimNumber].filter(Boolean).join(' · '), href: `/repair/workorder/${enc(r.workorderId)}` };
        case 'items': return { key: `item:${r.itemNumber}`, title: r.name || r.itemNumber, detail: [r.itemNumber, r.AvailableQuantity == null ? '' : `${r.AvailableQuantity} available`].filter(Boolean).join(' · '), href: `/boh/inventory/store-products/${enc(r.itemNumber)}` };
        case 'arrivals': return { key: `arrival:${r.arrivalId}`, title: r.customer?.fullName || `Arrival #${r.arrivalId}`, label: r.appointment && r.appointment !== '--' ? 'Appointment' : 'Arrival', detail: [r.customerDevice?.deviceName, r.arrivalStatus?.name, r.appointment].filter(Boolean).join(' · '), href: `/check-in/arrivals/${enc(r.arrivalId)}` };
        case 'serial': return { key: `serial:${query}`, title: r.ProductName || r.ItemNumber, detail: [query, r.SerialStatus, r.Store].filter(Boolean).join(' · '), href: `/boh/inventory/store-products/${enc(r.ItemNumber)}` };
      }
    });
  }
  globalThis.UBIFPlusSearch = { categories, plan, rows };
})();
