/* Runs the keyboard shortcuts set in Settings → Keyboard shortcuts on Portal
   pages. A matching key press is consumed and announced as a
   "ubif-plus-action" event; the feature that owns the action responds
   (note-picker.js inserts templates, samsung.js opens its form). Dark mode is
   toggled here, through the shared settings record. */
(() => {
  'use strict';
  if (globalThis.__ubifPlusHotkeys) return;
  globalThis.__ubifPlusHotkeys = true;
  const H = globalThis.UBIFPlusHotkeys;
  const S = globalThis.UBIFPlusSettings;
  if (!H) return;
  let enabled = true, byCombo = new Map();

  const index = bindings => { byCombo = new Map(Object.entries(bindings).map(([action, combo]) => [combo, action])); };

  addEventListener('keydown', event => {
    if (!enabled || event.repeat || event.isComposing || !byCombo.size) return;
    const action = byCombo.get(H.fromEvent(event));
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    if (action === 'darkMode.toggle') {
      if (S) S.get().then(current => S.set({ darkMode: !current.darkMode })).catch(() => {});
      return;
    }
    document.dispatchEvent(new CustomEvent('ubif-plus-action', { detail: { action } }));
  }, true);

  H.load().then(index);
  H.subscribe(index);
  const apply = next => { enabled = next.hotkeys !== false; };
  if (S) { S.subscribe(apply); S.get().then(apply, () => {}); }
})();
