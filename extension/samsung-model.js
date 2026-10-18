/* Samsung exception requests on Sprinklr: the three forms, the values each
   needs, and how they are read from a Portal work order. Shared by the work
   order button (samsung.js), the background worker that opens the form, and
   the Sprinklr filler (sprinklr.js). No DOM access here.

   Work-order sources (Portal R92.4 frontend): GET /api/workorder/:id returns
   CustomerDevice.imei, CustomerDevice.DeviceCatalog.name, and the GSPN ticket
   as PartnerJob.PartnerJobAttributes[] with partnerJobAttributeTypeId 53
   (PartnerJobAttributeType.GspnTicketNo). The signed-in user and store come
   from @ubif/util-store: auth.user.email and auth.currentStore.storeName. */
(() => {
  'use strict';
  const FORM_URL = 'https://forms-prod.sprinklr.com/guided-workflows/6544db26d4b8393a0b65ebb7?gwId=744690&viewType=FULL_PAGE';
  const FORM_ORIGIN = 'https://forms-prod.sprinklr.com';
  const GSPN_TICKET_ATTRIBUTE = 53;
  const JOB_TTL_MS = 15 * 60 * 1000;

  /* Values the technician can see and edit before the form opens. */
  const FIELDS = Object.freeze({
    email: { label: 'Your email', type: 'email' },
    techName: { label: 'Technician name' },
    storeNumber: { label: 'Store #', pattern: /^\d{1,6}$/ },
    storeEmail: { label: 'Store email', type: 'email' },
    repairType: { label: 'Repair location type', choices: ['Store', 'Kiosk'] },
    gdVersion: { label: 'Galaxy Diagnostic Tool version' },
    sku: { label: 'Device full SKU' },
    gspn: { label: 'GSPN ticket #', pattern: /^\d{6,}$/ },
    workorder: { label: 'Work order #', pattern: /^\d+$/ },
    imei: { label: 'IMEI', pattern: /^\d{14,17}$/ }
  });

  const common = [
    { label: 'Email Address', key: 'email' },
    { label: 'UBIF Location', key: 'storeNumber', dropdown: true, number: true },
    { label: 'Repair Location Type', key: 'repairType', dropdown: true },
    { label: 'Store Email Address', key: 'storeEmail' },
    { label: 'Technician Name', key: 'techName' }
  ];
  /* Sprinklr fields in page order. Later fields appear only after the
     dropdowns before them are chosen, so the filler waits for each label. */
  const FORMS = Object.freeze({
    gd: Object.freeze({
      name: 'GD Bypass', title: 'Galaxy Diagnostic Tool exception', canSubmit: true,
      fields: [...common,
        { label: 'Issue Type', value: 'Exception Request', dropdown: true },
        { label: 'Exception Type', value: 'Galaxy Diagnostic Tool', dropdown: true },
        { label: 'Galaxy Diagnostic Exception Reason', value: 'Asurion Repair', dropdown: true },
        { label: 'Galaxy Diagnostic Tool Version', key: 'gdVersion' },
        { label: 'Device Full SKU', key: 'sku' },
        { label: 'GSPN Ticket Number', key: 'gspn' },
        { label: 'Portal Work Order Number', key: 'workorder' },
        { label: 'IMEI', key: 'imei' },
        { label: 'Subject', value: 'Asurion Repair' },
        { label: 'Description', value: 'Asurion Repair' }]
    }),
    fenrir: Object.freeze({
      name: 'Fenrir Bypass', title: 'Fenrir exception', canSubmit: false,
      note: 'Attach the SVC connection screenshot in Sprinklr, then submit.',
      fields: [...common,
        { label: 'Issue Type', value: 'Exception Request', dropdown: true },
        { label: 'Exception Type', value: 'Fenrir', dropdown: true },
        { label: 'Fenrir Exception Reason', value: 'Customer Declined SW Update', dropdown: true },
        { label: 'SVC Connection Performed', value: 'Yes', dropdown: true },
        { label: 'GSPN Ticket Number', key: 'gspn' },
        { label: 'Portal Work Order Number', key: 'workorder' },
        { label: 'IMEI', key: 'imei' },
        { label: 'Subject', value: 'Customer Declined SW Update' },
        { label: 'Description', value: 'Customer Declined SW Update' }]
    }),
    wer: Object.freeze({
      name: 'WER Request', title: 'WER process request', canSubmit: true,
      fields: [...common,
        { label: 'Issue Type', value: 'Process Requests', dropdown: true },
        { label: 'Process Request Type', value: 'WER Request', dropdown: true },
        { label: 'Portal Work Order Number', key: 'workorder' },
        { label: 'IMEI', key: 'imei' },
        { label: 'Subject', value: 'WER Request' },
        { label: 'Description', value: 'WER Request' }]
    })
  });

  const text = value => (value === null || value === undefined ? '' : String(value)).trim();
  const keysFor = form => [...new Set((FORMS[form]?.fields || []).filter(f => f.key).map(f => f.key))];

  /* "Manchester CT #878" -> "878". Falls back to the numeric store id. */
  function storeNumber(storeName, storeId) {
    const match = text(storeName).match(/#\s*(\d{1,6})\b/) || text(storeName).match(/^(\d{3,6})\b/) || text(storeName).match(/\b(\d{3,6})$/);
    if (match) return match[1];
    return /^\d{1,6}$/.test(text(storeId)) ? text(storeId) : '';
  }

  /* Store mailboxes follow the store name: "Manchester CT #878" ->
     "manchesterct@ubreakifix.com". A guess the technician can correct. */
  function storeEmail(storeName) {
    const local = text(storeName).replace(/#?\s*\b\d{1,6}\b/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return local ? `${local}@ubreakifix.com` : '';
  }

  function gspnFromNotes(notes) {
    for (const note of Array.isArray(notes) ? notes : []) {
      const body = text(note?.noteText).replace(/<[^>]*>/g, ' ');
      const match = body.match(/GSPN[^\n]{0,80}?ticket(?:\s*(?:no\.?|number|#))?\s*:?\s*#?\s*(\d{6,})/i) ||
        body.match(/ticket\s*no\.?\s*#?\s*(\d{6,})/i);
      if (match) return match[1];
    }
    return '';
  }

  /* GET /api/workorder/:id -> form values. */
  function fromWorkorder(workorder) {
    const device = workorder?.CustomerDevice || {};
    const attributes = workorder?.PartnerJob?.PartnerJobAttributes;
    const ticket = Array.isArray(attributes) ? attributes.find(a => Number(a?.partnerJobAttributeTypeId) === GSPN_TICKET_ATTRIBUTE) : null;
    return {
      workorder: text(workorder?.workorderId),
      imei: text(device.imei).replace(/\D/g, ''),
      sku: text(device.DeviceCatalog?.name || device.name || workorder?.deviceCatalog?.name).replace(/\s*\(none\)\s*$/i, ''),
      gspn: text(ticket?.value).replace(/\D/g, '')
    };
  }

  function isSamsung(workorder) {
    const values = fromWorkorder(workorder);
    const name = `${values.sku} ${text(workorder?.CustomerDevice?.DeviceCatalog?.DeviceModel?.name)}`;
    return Boolean(values.gspn) || /\b(samsung|galaxy)\b/i.test(name);
  }

  /* The keys a form needs that are empty or malformed, in field order. */
  function missing(form, values) {
    return keysFor(form).filter(key => {
      const value = text(values?.[key]), field = FIELDS[key];
      if (!value) return true;
      if (field.pattern && !field.pattern.test(value)) return true;
      if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return true;
      return Boolean(field.choices && !field.choices.includes(value));
    });
  }

  /* A complete, bounded job for the background worker; null if invalid. */
  function job(form, values, autoSubmit) {
    if (!FORMS[form] || missing(form, values).length) return null;
    const clean = Object.fromEntries(keysFor(form).map(key => [key, text(values[key]).slice(0, 200)]));
    return { form, values: clean, autoSubmit: Boolean(autoSubmit) && FORMS[form].canSubmit, createdAt: Date.now() };
  }

  /* The ordered Sprinklr steps for a job: label, value, and how to set it. */
  function steps(job) {
    const form = FORMS[job?.form];
    if (!form) return [];
    return form.fields.map(field => ({ label: field.label, value: field.key ? text(job.values?.[field.key]) : field.value,
      dropdown: Boolean(field.dropdown), number: Boolean(field.number) }));
  }

  globalThis.UBIFPlusSamsung = Object.freeze({
    FORM_URL, FORM_ORIGIN, JOB_TTL_MS, FIELDS, FORMS, keysFor, storeNumber, storeEmail, gspnFromNotes,
    fromWorkorder, isSamsung, missing, job, steps
  });
})();
