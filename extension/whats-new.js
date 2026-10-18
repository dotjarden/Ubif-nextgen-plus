/* Highlights shown once at the top of settings after an update, and in
   Settings → About. Change `id` whenever the list changes so the panel shows
   it again. */
(() => {
  'use strict';
  globalThis.UBIFPlusWhatsNew = Object.freeze({
    id: 'experimental-2026-10-17',
    title: 'New in this build',
    items: Object.freeze([
      'Dark mode, with a dimmed option, brightness, contrast, sepia and grayscale.',
      'Samsung forms: GD Bypass, Fenrir Bypass and WER Request filled from the work order.',
      'Note templates for status changes, leads and check-in, with editable wording.',
      'Keyboard shortcuts for templates, Samsung forms and dark mode.',
      'Reorganized settings: feature cards in five groups, search that jumps to a setting, a Changed filter, one Templates page, and setup export/import.'
    ])
  });
})();
