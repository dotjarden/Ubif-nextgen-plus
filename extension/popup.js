/* Shared toolbar popup and full settings page. */
(() => {
  'use strict';
  // A toolbar popup needs an intrinsic width: viewport-relative caps can
  // lock Chrome's auto-sizing popup to its initial, narrow viewport.
  const popupViews = typeof chrome !== 'undefined' && chrome.extension?.getViews?.({ type: 'popup' });
  document.documentElement.classList.toggle('full-page', !popupViews || !popupViews.includes(window));
  const S = globalThis.UBIFPlusSettings;
  if (!S) return;
  const status = document.getElementById('ubif-status');
  const controls = [...document.querySelectorAll('[data-key]')];
  const sections = [...document.querySelectorAll('main section')];
  const navigation = [...document.querySelectorAll('[data-section]')];
  const filter = document.getElementById('settings-search');
  const resets = [...document.querySelectorAll('[data-reset]')];
  let flashTimer, current, saving = false, pendingCount = 0, editId = 0;
  const pendingEdits = new Map();
  let selected = sections.some(s => `#${s.id}` === location.hash) ? location.hash.slice(1) : 'home';
  function flash(text, error) {
    status.textContent = text;
    status.dataset.error = String(Boolean(error));
    clearTimeout(flashTimer);
    if (text && !error) flashTimer = setTimeout(() => { status.textContent = ''; }, 2500);
  }
  function fill(settings) {
    current = settings;
    for (const control of controls) {
      const value = pendingEdits.get(control.dataset.key)?.value ?? settings[control.dataset.key];
      if (control.type === 'checkbox') control.checked = Boolean(value);
      else control.value = String(value);
      control.disabled = control.dataset.depends.split(' ').filter(Boolean).some(key => !(pendingEdits.get(key)?.value ?? settings[key]));
    }
    resets.forEach(button => { button.disabled = false; });
  }
  function show() {
    const query = filter.value.trim().toLowerCase();
    let matches = 0;
    for (const section of sections) {
      let count = 0;
      for (const row of section.querySelectorAll('.row')) {
        row.hidden = Boolean(query) && !`${section.querySelector('h2').textContent} ${row.closest('.settings-group')?.querySelector('h3')?.textContent || ''} ${row.textContent}`.toLowerCase().includes(query);
        if (!row.hidden) count++;
      }
      for (const group of section.querySelectorAll('.settings-group')) group.hidden = ![...group.querySelectorAll('.row')].some(row => !row.hidden);
      if (!section.querySelector('.row') && section.textContent.toLowerCase().includes(query)) count++;
      section.hidden = query ? count === 0 : section.id !== selected;
      const reset = section.querySelector('.reset');
      if (reset) reset.hidden = Boolean(query);
      if (!section.hidden) matches++;
    }
    navigation.forEach(link => {
      if (!query && link.dataset.section === selected) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    document.getElementById('no-results').hidden = matches !== 0;
  }
  navigation.forEach(link => link.addEventListener('click', () => {
    selected = link.dataset.section; filter.value = ''; show();
    document.getElementById(`${selected}-title`).focus();
    document.getElementById('settings-content').scrollTop = 0;
  }));
  window.addEventListener('hashchange', () => {
    if (sections.some(s => `#${s.id}` === location.hash)) selected = location.hash.slice(1);
    filter.value = ''; show();
  });
  filter.addEventListener('input', show);
  async function save(patch) {
    if (!current) return;
    const id = ++editId;
    for (const [key, value] of Object.entries(patch)) pendingEdits.set(key, { id, value });
    pendingCount++; saving = true; fill(current); flash('Saving…');
    let failed = false;
    try { current = await S.set(patch); }
    catch { failed = true; }
    finally {
      for (const key of Object.keys(patch)) if (pendingEdits.get(key)?.id === id) pendingEdits.delete(key);
      saving = --pendingCount > 0;
      fill(current);
      if (failed) flash('Could not save. Try again.', true);
      else if (!saving) flash('Saved');
    }
  }
  controls.forEach(control => {
    const edit = live => {
      const number = control.value.trim() === '' ? NaN : Number(control.value);
      if (live && control.type === 'number' && (!Number.isFinite(number) || !control.validity.valid)) return;
      const value = control.type === 'checkbox' ? control.checked : Number.isFinite(number) ? number : S.defaults[control.dataset.key];
      if (value === (pendingEdits.get(control.dataset.key)?.value ?? current?.[control.dataset.key])) return;
      save({ [control.dataset.key]: value });
    };
    control.addEventListener('input', () => edit(true));
    control.addEventListener('change', () => edit(false));
  });
  resets.forEach(button => button.addEventListener('click', () => {
    const keys = [...document.getElementById(button.dataset.reset).querySelectorAll('[data-key]')];
    save(Object.fromEntries(keys.map(control => [control.dataset.key, S.defaults[control.dataset.key]])));
  }));
  document.getElementById('open-settings').addEventListener('click', () => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) chrome.runtime.openOptionsPage();
    else window.open(`popup.html#${selected}`, '_blank');
  });
  for (const link of document.querySelectorAll('[data-external]')) link.addEventListener('click', event => {
    event.preventDefault();
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) chrome.tabs.create({ url: link.href });
    else window.open(link.href, '_blank');
  });
  const reload = document.getElementById('reload-extension');
  const canReload = typeof chrome !== 'undefined' && typeof chrome.runtime?.reload === 'function';
  reload.disabled = !canReload;
  document.getElementById('preview-note').hidden = canReload;
  reload.addEventListener('click', () => { if (canReload && !saving) chrome.runtime.reload(); });
  const manifest = typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.();
  if (manifest) document.getElementById('ubif-version').textContent = `v${manifest.version}`;
  show();
  S.subscribe(fill);
  S.get().then(fill, () => flash('Could not read settings. Reopen settings to try again.', true));
})();
