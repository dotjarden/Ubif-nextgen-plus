/* Read-only adapter for the shared R92.4 ChatPanel. SystemJS exposes the
 * existing global store; no dispatch, messaging API call, or data persistence. */
(() => {
  'use strict';
  if (globalThis.__ubifPlusMessagesPage) return;
  globalThis.__ubifPlusMessagesPage = true;
  let launch = null, serial = 0, previous = '', bound = null, employeePrevious = null;
  const text = value => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  function readCard(node, expectedCustomer = '') {
    let found = null;
    const key = Object.keys(node).find(key => key.startsWith('__reactFiber$'));
    let fiber = key ? node[key] : null, root = fiber;
    while (root?.return) root = root.return;
    if (root?.stateNode?.current && root.stateNode.current !== root) fiber = fiber?.alternate || fiber;
    for (let depth = 0; fiber && depth++ < 50; fiber = fiber.return) {
      const p = fiber.memoizedProps;
      // Arrivals' customer-device-card receives these props before opening
      // the common ChatPanel. Read only its displayed customer/device/time.
      if (p?.customer?.customerId && p.device && (!expectedCustomer || text(p.customer.customerId) === expectedCustomer)) {
        const c = p.customer;
        found = { customerId: text(c.customerId), record: {
          customer: { fullName: text(c.fullName), firstName: text(c.firstName), lastName: text(c.lastName),
            primaryPhone: text(c.primaryPhone), primaryEmail: text(c.primaryEmail || c.email) },
          customerDevice: { deviceName: text(p.device.deviceName || p.device.model), modelName: text(p.device.model) },
          deviceIssues: Array.isArray(p.device.issues) ? p.device.issues.map(text) : [], appointment: text(p.time)
        } };
      }
      // The card's parent keeps the original arrival even when its summary
      // omits appointment time (e.g. an arrival opened from check-in).
      const arrival = p?.arrival;
      if (arrival?.customer?.customerId && (!expectedCustomer || text(arrival.customer.customerId) === expectedCustomer) && (!found || text(arrival.customer.customerId) === found.customerId)) {
        const c = arrival.customer, d = arrival.customerDevice || {};
        found = { customerId: text(c.customerId), record: {
          arrivalId: text(arrival.arrivalId),
          workorderId: text(arrival.workorderId),
          customer: { fullName: text(c.fullName), firstName: text(c.firstName), lastName: text(c.lastName), primaryPhone: text(c.primaryPhone), primaryEmail: text(c.primaryEmail) },
          customerDevice: { deviceName: text(d.deviceName || d.modelName), modelName: text(d.modelName) },
          deviceIssues: (arrival.deviceIssues || []).map(issue => text(issue?.name || issue)),
          appointment: found?.record.appointment || text(arrival.appointment),
          storeTimeZone: text(p.store?.storeTimeZone), nextUpdate: text(arrival.nextUpdate)
        } }; break;
      }
    }
    return found;
  }
  function capture(event) {
    const button = event.target.closest?.('[aria-label="chat panel"], [aria-label="Toggle chat panel"]');
    if (!button) return;
    launch = readCard(button); serial++;
  }
  function mountedArrival(customerId) {
    if (!customerId) return null;
    const matches = [];
    for (const card of document.querySelectorAll('[data-testid="customer-device-card"]')) {
      let visible = true;
      for (let node = card; node && node !== document.body; node = node.parentElement) {
        if (node.hidden || node.getAttribute('aria-hidden') === 'true' || getComputedStyle(node).display === 'none') { visible = false; break; }
      }
      if (!visible) continue;
      const value = readCard(card, customerId);
      if (value) matches.push(value);
    }
    // Never guess between two different arrivals for the same customer.
    if (matches.length === 1) return matches[0];
    const selected = matches.filter(value => value.record.arrivalId && value.record.arrivalId === launch?.record.arrivalId);
    return selected.length === 1 ? selected[0] : null;
  }
  function publish(module) {
    try {
      const state = module.store.getState();
      const user = module.selectCurrentUser?.(state) || module.selectUser?.(state) || state.currentUser || state.auth?.user || state.session?.user || state.user?.profile || state.user;
      const firstName = text(user?.firstName || user?.givenName || user?.employee?.firstName).trim();
      if (employeePrevious !== firstName) { employeePrevious = firstName; window.postMessage({ source: 'ubif-plus', type: 'employee-context', firstName }, '*'); }
      const open = module.selectChatPanelOpen(state), chat = module.selectChatPanelData(state);
      if (!open) launch = null;
      const customerId = text(chat?.customerId);
      // Recover when chat was already open before injection, the click was
      // missed, or React refreshed the arrival after its launcher was clicked.
      if (open && !chat?.workorderId) {
        const mounted = mountedArrival(customerId);
        if (mounted) {
          if (launch?.record.arrivalId && mounted.record.arrivalId !== launch.record.arrivalId) serial++;
          launch = mounted;
        }
      }
      const source = launch?.customerId === customerId ? launch.record : {};
      const customer = source.customer || {};
      const record = { ...source, workorderId: text(chat?.workorderId || source.workorderId), customer: {
        ...customer, fullName: text(chat?.customerName || customer.fullName),
        primaryPhone: text(chat?.customerPhone || customer.primaryPhone)
      } };
      const payload = { source: 'ubif-plus', type: 'message-context', open: !!open, customerId,
        key: `${customerId}:${text(chat?.workorderId)}:${serial}:${location.pathname}`, record };
      const fingerprint = JSON.stringify(payload);
      if (fingerprint !== previous) { previous = fingerprint; window.postMessage(payload, '*'); }
    } catch { /* Portal state not ready; do not affect its chat. */ }
  }
  function connect() {
    try {
      const system = globalThis.System;
      const module = system?.get(system.resolve('@ubif/util-store'));
      if (!module?.store?.getState || !module.selectChatPanelData || !module.selectChatPanelOpen) return;
      if (bound !== module.store) { bound = module.store; module.store.subscribe(() => publish(module)); }
      publish(module);
    } catch { /* Import map/store may mount after this adapter. */ }
  }
  document.addEventListener('click', capture, true);
  addEventListener('message', event => {
    if (event.source === window && event.data?.source === 'ubif-plus' && event.data.type === 'message-context-request') { previous = ''; employeePrevious = null; connect(); }
  });
  setInterval(connect, 500);
  connect();
})();
