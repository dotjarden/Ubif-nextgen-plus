/* Adapter for the shared Portal ChatPanel. Board launches use the native
 * store; message composition and sending remain entirely Portal-owned. */
(() => {
  'use strict';
  if (globalThis.__ubifPlusMessagesPage) return;
  globalThis.__ubifPlusMessagesPage = true;
  let launch = null, serial = 0, previous = '', bound = null, employeePrevious = null, techPrevious = null;
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
      // Signed-in technician and store for the Samsung exception forms.
      const store = module.selectCurrentStore?.(state) || state.auth?.currentStore;
      const tech = { email: text(user?.email).trim(), name: [user?.givenName, user?.familyName].map(part => text(part).trim()).filter(Boolean).join(' '),
        storeId: text(store?.storeId), storeName: text(store?.storeName).trim() };
      const techFingerprint = JSON.stringify(tech);
      if (techPrevious !== techFingerprint) { techPrevious = techFingerprint; window.postMessage({ source: 'ubif-plus', type: 'tech-context', ...tech }, '*'); }
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
  async function openBoardChat(request) {
    const id = String(request.workorderId || '');
    const token = request.requestId;
    const editor = document.querySelector('#ubif-update-today-board')?.shadowRoot?.querySelector('dialog[open]');
    const valid = () => /^\/repair\/workorders\/?$/.test(location.pathname) && editor?.isConnected && editor.open && editor.dataset.messageRequest === token && editor.dataset.workorderId === id;
    if (!/^\d+$/.test(id) || typeof token !== 'string' || !valid()) return;
    const reply = error => window.postMessage({ source: 'ubif-plus', type: 'board-chat-result', requestId: token, workorderId: id, error }, '*');
    try {
      const system = globalThis.System;
      const module = system?.get(system.resolve('@ubif/util-store'));
      if (!module?.store?.dispatch || !module.setChatPanelData || !module.setChatPanelOpen) throw new Error('Portal messaging is not ready. Please try again.');
      const read = async path => {
        const response = await fetch(path, { credentials: 'same-origin' });
        if (!response.ok) throw new Error('Could not load customer messaging. Please try again.');
        return response.json();
      };
      const detail = (await read(`/api/workorder/${id}`)).workorder;
      const customerId = detail?.CustomerDevice?.customerId;
      if (!customerId) throw new Error('This order has no customer available for messaging.');
      const jobs = await read(`/api/customer/recent-jobs/${encodeURIComponent(customerId)}`);
      const customer = jobs.customer;
      if (!customer) throw new Error('Could not verify customer contact details. Open the order in Portal.');
      if (!valid()) return;
      const state = module.store.getState(), existing = module.selectChatPanelData(state);
      if (module.selectChatPanelOpen(state)) {
        if (String(existing?.customerId) !== String(customerId) || String(existing?.workorderId) !== id) throw new Error('Close the current message conversation before opening another order.');
        reply(''); return;
      }
      const recentJobs = [
        ...(jobs.workorders || []).map(job => ({ id: `workorder-${job.workorderId}`, jobType: 'workorder', title: job.deviceName, subtitle: `WO #${job.workorderId}`, tag: job.workorderStatus, workorderNumber: String(job.workorderId), deviceName: job.deviceName })),
        ...(jobs.arrivals || []).map(job => ({ id: `arrival-${job.arrivalId}`, jobType: 'arrival', title: job.deviceName, subtitle: job.appointmentAt || job.createdAt, tag: job.arrivalStatus, appointmentAt: job.appointmentAt || job.createdAt, deviceName: job.deviceName, arrivalStatusId: job.arrivalStatusId }))
      ];
      module.store.dispatch(module.setChatPanelData({
        customerId, workorderId: id,
        customerName: customer.fullName || [customer.givenName, customer.familyName].filter(Boolean).join(' '),
        primaryPhoneNumber: customer.primaryPhoneNumber, contactPhoneNumber: customer.contactPhoneNumber,
        customerPhone: customer.contactPhoneNumber || customer.primaryPhoneNumber || '', canSms: customer.canSms,
        preferredContactMethod: [customer.canCall && 'Call', customer.canEmail && 'Email'].filter(Boolean).join(', '),
        recentJobs, hasActiveWorkorder: (jobs.workorders || []).length > 0, allowSMSForArrival: jobs.allowSMSForArrival
      }));
      module.store.dispatch(module.setChatPanelOpen(true));
      reply('');
    } catch (error) { if (valid()) reply(error.message || 'Could not open Portal messaging.'); }
  }
  /* Closes the conversation the Update Today editor opened, and only that one:
     a conversation for another order or customer is left alone. */
  function closeBoardChat(request) {
    try {
      const id = String(request.workorderId || '');
      const system = globalThis.System;
      const module = system?.get(system.resolve('@ubif/util-store'));
      if (!/^\d+$/.test(id) || !module?.store?.dispatch || !module.setChatPanelOpen) return;
      const state = module.store.getState();
      if (!module.selectChatPanelOpen(state) || String(module.selectChatPanelData(state)?.workorderId) !== id) return;
      module.store.dispatch(module.setChatPanelOpen(false));
    } catch { /* Portal keeps its own close button. */ }
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
    if (event.source === window && event.data?.source === 'ubif-plus' && event.data.type === 'board-chat-open') openBoardChat(event.data);
    if (event.source === window && event.data?.source === 'ubif-plus' && event.data.type === 'board-chat-close') closeBoardChat(event.data);
    if (event.source === window && event.data?.source === 'ubif-plus' && event.data.type === 'message-context-request') { previous = ''; employeePrevious = null; techPrevious = null; connect(); }
  });
  setInterval(connect, 500);
  connect();
})();
