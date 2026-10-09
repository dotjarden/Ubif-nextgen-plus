/* Toolbar popup: one control per settings key. Every edit is written to
   storage immediately, so open portal tabs pick the change up through
   chrome.storage.onChanged without a reload. */
(() => {
  'use strict';
  const S = globalThis.UBIFPlusSettings;
  if (!S) return;
  const status = document.getElementById('ubif-status');
  const controls = [...document.querySelectorAll('[data-key]')];
  let flashTimer;

  function flash(text, error) {
    status.textContent = text;
    status.dataset.error = String(Boolean(error));
    clearTimeout(flashTimer);
    if (text) flashTimer = setTimeout(() => { status.textContent = ''; }, 2500);
  }
  function fill(settings) {
    for (const control of controls) {
      const value = settings[control.dataset.key];
      if (control.type === 'checkbox') control.checked = Boolean(value);
      else control.value = String(value);
    }
  }
  function value(control) {
    if (control.type === 'checkbox') return control.checked;
    const number = Number(control.value);
    return Number.isFinite(number) ? number : S.defaults[control.dataset.key];
  }
  function save(control) {
    flash('');
    S.set({ [control.dataset.key]: value(control) }).then(
      settings => { fill(settings); flash('Saved'); },
      () => flash('Could not save. Try again.', true)
    );
  }
  for (const control of controls) control.addEventListener('change', () => save(control));
  // A popup document cannot navigate itself, so open both links as new tabs.
  for (const link of document.querySelectorAll('footer a')) {
    link.addEventListener('click', event => {
      event.preventDefault();
      const url = link.href;
      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) chrome.tabs.create({ url });
      else window.open(url, '_blank');
    });
  }
  const manifest = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest && chrome.runtime.getManifest();
  if (manifest) document.getElementById('ubif-version').textContent = `v${manifest.version}`;
  S.get().then(fill, () => flash('Could not read settings.', true));
})();
