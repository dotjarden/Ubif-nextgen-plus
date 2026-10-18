/* Note templates: work-order status notes, lead notes and check-in device
   notes. The wording follows the Tech FOH Cheat Sheet (as collected by WD40's
   Portal Pro). Edited wording is stored per template in extension storage;
   an unedited template always uses the current default, so wording updates
   reach everyone who has not customized it. Shared by the Portal picker
   (note-picker.js), keyboard shortcuts and the settings page. */
(() => {
  'use strict';
  const KEY = 'ubif-plus.note-templates.v1';
  const MAX = 2000; // Portal's notes limit

  const GROUPS = Object.freeze([
    { id: 'status', name: 'Status notes', where: 'notes' },
    { id: 'leads', name: 'Lead notes', where: 'notes' },
    { id: 'checkin', name: 'Check-in notes', where: 'checkin' }
  ]);

  const bullets = (title, lines) => [title, ...lines.map(line => `• ${line}`)].join('\n');
  const plain = (title, lines) => [title, ...lines].join('\n');
  const DEFAULTS = Object.freeze([
    { id: 'repairInProgress', group: 'status', name: 'Repair/Diag In Progress', summary: 'Issue, complications, pretest, next steps',
      text: bullets('Repair/Diag In Progress:', ['Device Issue:', 'Possible Complications:', 'Is the device pretestable? (Y/N):', 'Ideal Outcome:', 'Next steps:']) },
    { id: 'awaitingDiag', group: 'status', name: 'Awaiting Diag', summary: 'Repair needed, price, TAT, next steps',
      text: bullets('Awaiting Diag:', ['Need to contact customer? (Y/N):', 'Repair Needed:', 'Reason for Diag Status:', 'Price (if applicable):', 'TAT (if applicable):', 'Next Steps:']) },
    { id: 'awaitingDiagPriceQuote', group: 'status', name: 'Awaiting Diag (Price Quote Ready)', summary: 'Part, quotes with and without ATC, diag summary',
      text: ['Awaiting Diag (Price Quote Ready):', '• Part needed:', '', 'Quote Without ATC', '• Price:', '• TAT:', '', 'Quote With ATC', '• Price:', '• TAT:', '', '• Diagnostic Summary:'].join('\n') },
    { id: 'awaitingCallback', group: 'status', name: 'Awaiting Callback/Device', summary: 'Voicemail, reason, quotes, next steps',
      text: bullets('Awaiting Callback/Device:', ['Device in store? (Y/N):', 'Voicemail left? (Y/N):', 'Reason for contacting:', 'Possible Complications:', 'TAT Quote (if applicable):', 'Price Quote (if applicable):', 'Next steps:']) },
    { id: 'qualityInspection', group: 'status', name: 'Quality Inspection', summary: 'Repair summary, parts, findings, next steps',
      text: bullets('Quality Inspection:', ['Repair Summary:', 'Part Replaced:', 'Internal Findings:', 'Complications:', 'Next steps:']) },
    { id: 'repairedRFP', group: 'status', name: 'Repaired/Unrepairable RFP', summary: 'Parts used, post-repair test, conclusion',
      text: bullets('Repaired/Unrepairable RFP - Technician Summary Note:', ['Repaired (Y/N):', 'The device(s) came in with:', 'Parts used/replaced:', 'Additional findings/complications/comments:', 'Post-repair testing:', 'Can warranty repair? (Y/N):', 'Conclusion:']) },
    { id: 'declinedRFP', group: 'status', name: 'Declined RFP (In Store)', summary: 'Came in with, attempt, complications, conclusion',
      text: bullets('Declined RFP (in store) - Technician Summary Note:', ['The device(s) came in with:', 'Repair attempted (if applicable):', 'Additional findings/complications:', 'Conclusion:']) },
    { id: 'orderPartsMultiday', group: 'status', name: 'Need to Order Parts (Multiday)', summary: 'Model, SN, color, symptoms, part, TAT, deposit',
      text: bullets('Need to Order Parts (Multiday Order):', ['Device Model #:', 'Device SN:', 'Device Color:', 'Device Symptoms:', 'Part Needed:', 'Part Link:', 'Quoted TAT:', 'Customer left deposit? (Y/N):', 'Additional Notes (optional):']) },
    { id: 'leadContacted', group: 'leads', name: 'Lead (Customer Contacted)', summary: 'Model, symptoms, insurance, stock, quote, drop-off',
      text: bullets('Lead Template (Customer Contacted):', ['Device Model:', 'Device Color:', 'Device Symptoms:', 'Additional Damage?:', 'Customer has insurance? (Y/N):', 'Parts in stock? (Y/N):', 'Price Quote (if applicable):', 'TAT Quote:', 'Diag or Repair?:', 'Expected Drop Off Time/Date:', 'FMIP Disabled? (Y/N/NA):', 'Additional Notes (optional):']) },
    { id: 'leadNotContacted', group: 'leads', name: 'Lead (Customer NOT Contacted)', summary: 'Model, damage, stock, voicemail, quote, TAT',
      text: bullets('Lead Template (Customer NOT Contacted):', ['Device Model:', 'Device damage based on lead:', 'Parts in stock? (Y/N):', 'Left VM? (Y/N):', 'Price Quote (if applicable):', 'TAT Quote:', 'Additional Notes (optional):']) },
    { id: 'multiday', group: 'checkin', name: 'Multiday Device Notes', summary: 'Laptop, AIO, console, mobile, desktop',
      text: plain('Multiday Device Notes:', ['Device Type (Laptop, AIO, Console, Mobile, Desktop):', 'Device Manufacturer/Brand:', 'Model #:', 'Device Color:', 'S/N or Prod ID collected (Y/N) [If N, state reason]:', '',
        'Is the customer OK with us wiping their data to restore use of the device?:', 'Password collected (Y/N) [If N, state reason]:', '',
        'Description of Issue(s)/Symptom(s) [Power, I/O, Display, Software/Storage]:', 'Description of Cause of Issue(s)/Symptom(s):', 'Device Repaired Before? (Y/N) [If Y, specify]:', 'Possible Complications/Disclaimers:', '',
        'Price Quote [if quote is not available, quote Troubleshooting Fee]:', 'Estimated Diag or Repair Turnaround Time:', 'Is this expedited Diag or Repair? (Y/N & D/R):']) },
    { id: 'insurance', group: 'checkin', name: 'Insurance Mobile Device Notes', summary: 'Asurion or carrier insurance repairs',
      text: plain('Insurance Mobile Device Notes:', ['Device Manufacturer/Brand & Model:', 'Customer prefers Data or Repair:', 'Customer approves QR cleaning after repair? (Y/N):', 'Passcode (if needed):', 'Device Color:',
        'Device repaired before or running Beta Software? (Y/N):', 'Issue(s)/Symptom(s):', 'Description of what happened:', 'Possible Complications/Disclaimers:', 'Parts in stock? (Y/N):', 'Repair Needed:',
        'Estimated Turnaround Time:', 'Is this expedited Diag or Repair? (Y/N & D/R):', 'Customer approves? (Y/N):', 'Additional Items With Device (Y/N):', 'Contact information:']) },
    { id: 'inwarranty', group: 'checkin', name: 'In Warranty Device Notes', summary: 'Manufacturer or extended warranty',
      text: plain('In Warranty Device Notes:', ['Device Manufacturer/Brand & Model:', 'Customer prefers Data or Repair:', 'Passcode (if needed):', 'Device Color:', 'Device Repaired Before? (Y/N):',
        'Issue(s)/Symptom(s):', 'Description of what happened:', 'Possible Complications/Disclaimers:', 'Parts in stock? (Y/N):', 'Parts Needed:', 'Estimated Turnaround Time:',
        'Is this expedited Diag or Repair? (Y/N & D/R):', 'Customer approves? (Y/N):', 'Additional Items With Device (Y/N):', 'Contact information:']) },
    { id: 'oop', group: 'checkin', name: 'OOP Mobile Device Notes', summary: 'Out-of-pocket and self-pay repairs',
      text: plain('OOP Mobile Device Notes:', ['Device Manufacturer/Brand & Model:', 'Customer prefers Data or Repair:', 'Passcode (if needed):', 'Device Color:', 'Device repaired before or running Beta Software? (Y/N):',
        'Issue(s)/Symptom(s):', 'Description of what happened:', 'Possible Complications/Disclaimers:', 'Parts in stock? (Y/N):', 'Repair Needed:', 'Price Quote:', 'Estimated Turnaround Time:',
        'Is this expedited Diag or Repair? (Y/N & D/R):', 'Customer approves? (Y/N):', 'Additional Items With Device (Y/N):', 'Contact information:']) }
  ].map(Object.freeze));
  const BY_ID = new Map(DEFAULTS.map(template => [template.id, template]));

  let overrides = {}, loaded = null, hooked = false;
  const listeners = new Set();
  const local = () => (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) || null;

  /* Known ids only, non-empty text within Portal's limit. */
  function sanitize(raw) {
    const next = {};
    const source = raw && typeof raw === 'object' && raw.overrides && typeof raw.overrides === 'object' ? raw.overrides : {};
    for (const [id, text] of Object.entries(source)) {
      if (!BY_ID.has(id) || typeof text !== 'string') continue;
      const value = text.replace(/\r\n?/g, '\n').slice(0, MAX);
      if (value.trim() && value !== BY_ID.get(id).text) next[id] = value;
    }
    return next;
  }

  function publish(raw) {
    overrides = sanitize(raw);
    for (const listener of [...listeners]) { try { listener(list()); } catch {} }
  }

  function hook() {
    const bus = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged;
    if (!bus || hooked) return;
    hooked = true;
    bus.addListener((changes, area) => { if ((!area || area === 'local') && changes?.[KEY]) publish(changes[KEY].newValue); });
  }

  function load() {
    hook();
    if (!loaded) loaded = Promise.resolve(local()?.get(KEY)).then(data => { publish(data?.[KEY]); return list(); }, () => list());
    return loaded;
  }

  /* All templates with their current wording and whether it was edited. */
  function list() {
    return DEFAULTS.map(template => ({ ...template, text: overrides[template.id] ?? template.text, edited: template.id in overrides }));
  }
  const get = id => list().find(template => template.id === id) || null;

  async function save(id, text) {
    if (!BY_ID.has(id)) throw new Error('Unknown template');
    await load();
    const next = { ...overrides, [id]: String(text ?? '') };
    if (!String(text ?? '').trim() || text === BY_ID.get(id).text) delete next[id];
    const record = { version: 1, overrides: sanitize({ overrides: next }) };
    await local()?.set({ [KEY]: record });
    publish(record);
    return get(id);
  }
  const reset = id => save(id, BY_ID.get(id)?.text);

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    hook();
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  /* The text a field holds after inserting a template: at the caret the
     technician last placed in it, otherwise at the start (check-in notes, so
     Extra Details stays last) or end (work-order notes). Existing text is
     kept and separated by a blank line. */
  function combine(current, template, { start = null, end = null, at = 'end' } = {}) {
    const text = String(current || '');
    let before, after;
    if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end <= text.length && start <= end) {
      before = text.slice(0, start); after = text.slice(end);
    } else if (at === 'start') { before = ''; after = text; }
    else { before = text; after = ''; }
    const lead = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
    const trail = after && !after.startsWith('\n\n') ? (after.startsWith('\n') ? '\n' : '\n\n') : '';
    const value = `${before}${lead}${template}${trail}${after}`;
    return { value, caret: (before + lead + template).length };
  }

  globalThis.UBIFPlusNoteTemplates = Object.freeze({ KEY, MAX, GROUPS, DEFAULTS, load, list, get, save, reset, subscribe, sanitize, combine });
})();
