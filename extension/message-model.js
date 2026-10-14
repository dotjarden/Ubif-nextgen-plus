/* Template definitions contain placeholders, never resolved customer data. */
(() => {
  'use strict';
  const text = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  const first = (...values) => values.map(text).find(Boolean) || '';
  const date = (value, timeZone) => {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return text(value);
    try { return parsed.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short', ...(timeZone ? { timeZone } : {}) }); }
    catch { return parsed.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); }
  };
  const fields = [
    ['employee.firstName', 'Employee first name', 'Employee'],
    ['customer.firstName', 'First name', 'Customer'], ['customer.name', 'Full name', 'Customer'],
    ['customer.phone', 'Phone', 'Customer'], ['customer.email', 'Email', 'Customer'],
    ['device.name', 'Device', 'Device'], ['device.model', 'Model', 'Device'],
    ['device.issues', 'Reported issues', 'Device'],
    ['workorder.number', 'Work order number', 'Work order'], ['workorder.status', 'Status', 'Work order'],
    ['workorder.nextUpdate', 'Next update', 'Work order'],
    ['appointment.date', 'Appointment', 'Appointment']
  ];
  function data(record = {}) {
    const d = record.customerDevice || record.CustomerDevice || {}, c = record.customerData || record.customer || record.CustomerDatum || d.CustomerDatum || {}, a = record.appointment || record.appointmentAt;
    const catalog = record.deviceCatalog || d.DeviceCatalog || {};
    const model = catalog.DeviceModel || {};
    const name = first(c.fullName, [c.firstName || c.givenName, c.lastName || c.familyName].filter(Boolean).join(' '));
    return {
      'customer.firstName': first(c.firstName, c.givenName, name.split(/\s+/)[0]), 'customer.name': name,
      'customer.phone': first(c.primaryPhoneNumber, c.primaryPhone, c.phoneNumber, record.primaryPhoneNumber),
      'customer.email': first(c.primaryEmail, c.primaryEmailAddress, c.email, record.primaryEmailAddress),
      'device.name': first(catalog.name, d.deviceName, d.name, d.modelName, model.modelNumber),
      'device.model': first(d.modelName, catalog.modelName, model.modelNumber),
      'device.issues': Array.isArray(record.deviceIssues) ? record.deviceIssues.map(value => text(value?.name || value)).filter(Boolean).join(', ') : text(record.deviceIssues),
      'workorder.number': text(record.workorderId), 'workorder.status': first(record.workorderStatusName, record.WorkorderStatus?.name, record.workorderStatus?.name),
      'workorder.nextUpdate': date(record.nextUpdate),
      'appointment.date': date(typeof a === 'object' && a !== null ? first(a.startDateTime, a.appointmentDate, a.date) : a, record.storeTimeZone || record.store?.storeTimeZone)
    };
  }
  function render(body, values = {}) {
    const missing = new Set(), unknown = new Set();
    const output = String(body).replace(/\{\{\s*([^{}|]+?)(?:\|([^{}]*))?\s*\}\}/g, (_, rawKey, fallback) => {
      const key = rawKey.trim();
      if (!fields.some(field => field[0] === key)) { unknown.add(key); return ''; }
      if (text(values[key])) return text(values[key]);
      missing.add(key);
      return fallback === undefined ? '' : fallback.trim();
    });
    if (output.includes('{{') || output.includes('}}')) unknown.add('Invalid placeholder');
    return { text: output, missing: [...missing], unknown: [...unknown] };
  }
  const defaults = [
    { id: 'update', name: 'Repair update', body: 'Hi {{customer.firstName|there}}, here is an update on {{device.name|your device}}: ' },
    { id: 'pickup', name: 'Ready for pickup', body: 'Hi {{customer.firstName|there}}, {{device.name|your device}} is ready for pickup. Please contact us if you have any questions.' },
    { id: 'appointment', name: 'Appointment reminder', body: 'Hi {{customer.firstName|there}}, this is a reminder about your repair appointment: {{appointment.date}}. Please contact us if you need to reschedule.' },
    { id: 'rt-iphone', name: 'RT iPhone', body: 'Hello! This is {{employee.firstName}} with uBreakiFix. I was just calling to confirm your appointment for {{appointment.date}} with one of our mobile techs. Whenever they are on the way, they will text you and let you know their ETA. Please make sure to have Stolen Protection turned off before the technician arrives. If you have any questions, you can reach back out to us, OR if you need to reschedule you can do so by reaching out to Asurion. Thank you, and have a great day!' },
    { id: 'rt-android', name: 'RT Android', body: 'Hello! This is {{employee.firstName}} with uBreakiFix. I was just calling to confirm your appointment for {{appointment.date}} with one of our mobile techs. Whenever they are on the way, they will text you and let you know their ETA. If you have any questions, you can reach back out to us, OR if you need to reschedule you can do so by reaching out to Asurion. Thank you, and have a great day!' }
  ];
  function sanitize(value) {
    if (!Array.isArray(value)) return defaults.map(row => ({ ...row }));
    const ids = new Set();
    return value.filter(row => row && typeof row.id === 'string' && row.id && !ids.has(row.id) && ids.add(row.id) && typeof row.name === 'string' && row.name.trim() && typeof row.body === 'string')
      .slice(0, 100).map(row => ({ id: row.id.slice(0, 100), name: row.name.trim().slice(0, 100), body: row.body.slice(0, 10000) }));
  }
  globalThis.UBIFPlusMessageModel = { fields, data, render, defaults, sanitize };
})();
