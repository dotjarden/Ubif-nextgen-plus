/* Portal R92.4 work order API adapter. No customer data is persisted. */
(() => {
  'use strict';
  const statuses = [
    [2, 'Need to order', 'need_to_order'], [3, 'Awaiting item', 'awaiting_item'],
    [7, 'Awaiting callback', 'awaiting_callback'], [8, 'Ready for work', 'ready_for_work'],
    [24, 'Ready for diagnostics', 'ready_for_diag'], [5, 'Awaiting diagnostics', 'awaiting_diagnostics'],
    [9, 'Diagnostics', 'diagnostics'], [10, 'Work in progress', 'work_in_progress'],
    [11, 'Quality check', 'quality_check'], [12, 'Repair summary', 'repair_summary'],
    [13, 'Ready for pickup', 'ready_for_pickup'], [4, 'Awaiting device', 'awaiting_device'],
    [6, 'Awaiting partner approval', 'awaiting_partner_approval'], [17, 'Device abandoned', 'device_abandoned'],
    [26, 'Send to depot', 'send_to_depot'], [27, 'Shipped by depot', 'shipped_by_depot']
  ].map(([id, name, tag]) => ({ id, name, tag }));
  const activeIds = statuses.map(s => s.id);
  const status = id => statuses.find(s => s.id === Number(id));
  function idOf(value) {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid work order number.');
    return id;
  }
  function localInput(value) {
    if (!value) return '';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00`) : new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  function due(record, now = new Date(), includeTomorrow = false) {
    if (!activeIds.includes(Number(record.workorderStatusId))) return false;
    const input = localInput(record.nextUpdate);
    if (!input) return false;
    const end = new Date(now); end.setHours(0, 0, 0, 0); end.setDate(end.getDate() + (includeTomorrow ? 2 : 1));
    return new Date(input).getTime() < end.getTime();
  }
  function nextDate(days = 2, now = new Date()) {
    const date = new Date(now); date.setDate(date.getDate() + days); date.setSeconds(0, 0);
    return localInput(date);
  }
  function toISO(value) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Choose the next update date and time.');
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()) || localInput(date) !== value) throw new Error('Choose a valid local date and time.');
    return date.toISOString();
  }
  // Common manual-override destinations across the observed workflows. Native-only
  // destinations stay visible but never bypass diagnostic/partner/checkout steps.
  function canMove(from, to) {
    from = Number(from); to = Number(to);
    return activeIds.includes(from) && from !== 13 && from !== to &&
      (from === 12 ? to === 8 : [2, 3, 7, 8].includes(to));
  }
  const fingerprint = r => JSON.stringify([Number(r.workorderStatusId), r.nextUpdate || null, r.updatedAt || null]);
  function createAPI(fetcher = globalThis.fetch.bind(globalThis), changed = () => {}) {
    const pending = new Set();
    async function request(path, method = 'GET', body, signal) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (signal?.aborted) abort();
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, 20000);
      try {
        const response = await fetcher(`/api/${path}`, { method, credentials: 'same-origin', cache: 'no-store',
          signal: controller.signal, ubifPlusBoard: true,
          headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}) });
        if (!response.ok) {
          let detail = '';
          try { const json = await response.json(); detail = typeof json.message === 'string' ? json.message.slice(0, 300) : ''; } catch (_) { /* no JSON */ }
          throw new Error(response.status === 401 || response.status === 403 ? 'Portal session or permissions need attention.' : `Portal rejected the request (${response.status}). ${detail}`.trim());
        }
        if (response.status === 204) return null;
        return await response.json();
      } catch (error) {
        if (error.name === 'AbortError' || error instanceof TypeError || error.name === 'SyntaxError') {
          throw new Error(method === 'GET' || path === 'workorders' ? 'Portal could not be reached. Refresh to try again.' : 'Save outcome is unknown. Refresh the order and notes before trying again.');
        }
        throw error;
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    }
    async function list(signal) {
      const records = new Map();
      for (let page = 1; page <= 200; page++) {
        const json = await request('workorders', 'POST', { page, pageSize: 100, primaryFilter: 'Active', tab: 'All',
          workOrderStatusIds: activeIds, deviceTypeIds: [], programIds: [], serviceOutcome: [], needsAttention: false,
          order: 'nextUpdate,ASC', isCrossStoreSearch: false }, signal);
        if (!Array.isArray(json?.workOrders) || !Number.isFinite(json.rowCount) || json.rowCount < 0) throw new Error('Unexpected Portal work order response. Board was not replaced.');
        const before = records.size;
        for (const row of json.workOrders) records.set(idOf(row.workorderId), row);
        if (records.size >= json.rowCount) return [...records.values()];
        if (!json.workOrders.length || before === records.size) throw new Error('Portal pagination did not advance. Refresh to load the complete board.');
      }
      throw new Error('Too many orders to load completely. Board was not replaced.');
    }
    async function detail(id, signal) {
      id = idOf(id);
      const json = await request(`workorder/${id}`, 'GET', undefined, signal);
      if (Number(json?.workorder?.workorderId) !== id) throw new Error('Portal returned a different work order.');
      return json.workorder;
    }
    async function notes(id, signal) {
      id = idOf(id); const records = []; const seen = new Set();
      for (let page = 0; page < 200; page++) {
        const json = await request(`note?workorderId=${id}&offset=${records.length}&limit=50`, 'GET', undefined, signal);
        if (!Array.isArray(json?.notes) || !Number.isFinite(json.total)) throw new Error('Unexpected Portal notes response.');
        for (const note of json.notes) {
          if (Number(note.workorderId) !== id || !note.noteId || seen.has(note.noteId)) throw new Error('Portal returned unexpected notes. Open the order to review them.');
          records.push(note); seen.add(note.noteId);
        }
        if (records.length >= json.total) return records;
        if (!json.notes.length) throw new Error('Portal notes pagination did not advance.');
      }
      throw new Error('Too many notes. Open the order to review its history.');
    }
    async function exclusive(id, work) {
      id = idOf(id);
      if (pending.has(id)) throw new Error('This order is already saving.');
      pending.add(id);
      try { return await work(id); } finally { pending.delete(id); }
    }
    async function current(snapshot) {
      const fresh = await detail(snapshot.workorderId);
      if (fingerprint(fresh) !== fingerprint(snapshot)) throw new Error('This order changed in Portal. Refresh it before saving.');
      return fresh;
    }
    function noteBody(record, text, target = record.workorderStatusId) {
      text = String(text || '').trim();
      if (text.replace(/\s/g, '').length < 10 || text.length > 2000) throw new Error('Enter at least 10 non-space characters, up to 2,000 total.');
      const customerId = idOf(record.CustomerDevice?.customerId);
      const tag = status(target)?.tag;
      if (!tag) throw new Error('This status requires notes in the native order page.');
      return { workorderId: idOf(record.workorderId), customerId, noteText: text, noteTag: tag, noteType: 2 };
    }
    async function schedule(snapshot, input) {
      const nextUpdate = toISO(input);
      return exclusive(snapshot.workorderId, async id => {
        await current(snapshot);
        await request(`workorder/${id}/fields`, 'PATCH', { workorderId: id, nextUpdate });
        changed(id);
        const fresh = await detail(id);
        if (new Date(fresh.nextUpdate).getTime() !== new Date(nextUpdate).getTime()) throw new Error('Portal did not retain that update time. Refresh to see its current value.');
        return fresh;
      });
    }
    async function addNote(snapshot, text) {
      return exclusive(snapshot.workorderId, async id => {
        const fresh = await current(snapshot);
        await request('note', 'POST', noteBody(fresh, text));
        changed(id);
      });
    }
    async function move(snapshot, target, input, text) {
      target = Number(target); const nextUpdate = toISO(input);
      if (!canMove(snapshot.workorderStatusId, target)) throw new Error('Complete this transition in the native Portal workflow.');
      return exclusive(snapshot.workorderId, async id => {
        const fresh = await current(snapshot); const body = noteBody(fresh, text, target);
        const program = await request(`program-attributes/${idOf(fresh.programId)}`);
        if (!program || typeof program !== 'object' || Array.isArray(program)) throw new Error('Could not verify program workflow rules.');
        if (program.UseISP) throw new Error('This program requires status changes in the native Portal workflow.');
        const audit = await request(`workorder-audit-trail/${id}`);
        if (!Array.isArray(audit)) throw new Error('Could not verify the work order workflow history.');
        await request(`workorder/${id}/status`, 'PATCH', { workorderStatusId: target, nextUpdate });
        changed(id);
        try {
          if (audit.some(entry => [9, 10, 11, 12].includes(Number(entry.workorderStatusId)))) {
            await request(`workorder/reset-audit-trail/${id}`, 'PUT', { workorderId: id, resetWorkorderStatuses: [9, 10, 11, 12] });
          }
          await request('note', 'POST', body);
          changed(id);
          const result = await detail(id);
          if (Number(result.workorderStatusId) !== target || new Date(result.nextUpdate).getTime() !== new Date(nextUpdate).getTime()) throw new Error('The saved status or update time differs from the requested value.');
          return result;
        } catch (error) { throw new Error(`Status was saved, but follow-up work needs review in Portal. ${error.message}`); }
      });
    }
    return { list, detail, notes, schedule, addNote, move };
  }
  globalThis.UBIFPlusBoard = { statuses, status, activeIds, due, localInput, nextDate, toISO, canMove, fingerprint, createAPI };
})();
