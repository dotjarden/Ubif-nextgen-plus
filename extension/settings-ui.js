/* Shared control binding for the toolbar panel (popup.html) and the full
   settings page (options.html). Any element with data-key edits that setting;
   it saves on change, shows the saved value, and is disabled while a setting
   it depends on (data-depends) is off, with the reason shown in its row.

   Extras on top of plain inputs:
   - Theme choice: radio buttons named "theme" (off, dark, dim) inside an
     element with data-keys="darkMode darkDimmed" set both settings at once.
   - Range sliders save while dragging and show their value in an <output>.
   - Preset buttons (data-preset="key:value") fill a number in one click.
   - Restore buttons (data-reset="id") reset the settings inside that element. */
(() => {
  'use strict';
  const THEME = Object.freeze({ off: { darkMode: false, darkDimmed: false }, dark: { darkMode: true, darkDimmed: false }, dim: { darkMode: true, darkDimmed: true } });
  const themeOf = settings => (!settings.darkMode ? 'off' : settings.darkDimmed ? 'dim' : 'dark');

  function bind({ root = document, S = globalThis.UBIFPlusSettings, status = null, onChange = () => {} } = {}) {
    if (!S) return null;
    const controls = [...root.querySelectorAll('[data-key]')];
    const themes = [...root.querySelectorAll('input[type=radio][name=theme]')];
    const presets = [...root.querySelectorAll('[data-preset]')];
    const resets = [...root.querySelectorAll('[data-reset]')];
    let flashTimer, current, saving = false, pendingCount = 0, editId = 0;
    const pendingEdits = new Map();
    const rangeTimers = new WeakMap();

    function flash(text, error) {
      if (!status) return;
      status.textContent = text;
      status.dataset.error = String(Boolean(error));
      clearTimeout(flashTimer);
      if (text && !error) flashTimer = setTimeout(() => { status.textContent = ''; }, 2500);
    }

    const valueOf = (key, settings) => pendingEdits.get(key)?.value ?? settings[key];

    /* The name people see for a setting, for "Turn on … first". */
    function nameOf(key) {
      const control = root.querySelector(`[data-key="${key}"]`);
      if (!control) return key;
      if (control.dataset.name) return control.dataset.name;
      const label = control.closest('.row, label');
      const text = label?.querySelector('span')?.childNodes[0]?.textContent || label?.textContent || key;
      return text.trim();
    }

    function fill(settings) {
      current = settings;
      for (const control of controls) {
        const key = control.dataset.key, value = valueOf(key, settings);
        if (control.type === 'checkbox') control.checked = Boolean(value);
        else if (document.activeElement !== control || control.type !== 'number') control.value = String(value);
        if (control.type === 'range') {
          const output = control.closest('.row')?.querySelector('output');
          if (output) output.textContent = `${value}%`;
        }
        const missing = (control.dataset.depends || '').split(' ').filter(Boolean).filter(dep => !valueOf(dep, settings));
        control.disabled = missing.length > 0;
        const row = control.closest('.row');
        const why = row?.querySelector('.why');
        // A setting chosen by a grouped control (the theme) explains itself.
        const hint = missing.length && root.querySelector(`[data-keys~="${missing[0]}"]`)?.dataset.offHint;
        if (why) why.textContent = !missing.length ? '' : hint || `Turn on ${missing.map(nameOf).join(' and ')} to change this.`;
        row?.classList.toggle('is-disabled', missing.length > 0);
        row?.toggleAttribute('data-changed', JSON.stringify(settings[key]) !== JSON.stringify(S.defaults[key]));
      }
      const theme = themeOf({ darkMode: valueOf('darkMode', settings), darkDimmed: valueOf('darkDimmed', settings) });
      for (const radio of themes) radio.checked = radio.value === theme;
      for (const button of presets) {
        const [key, raw] = button.dataset.preset.split(':');
        button.setAttribute('aria-pressed', String(Number(raw) === Number(valueOf(key, settings))));
        button.disabled = Boolean(root.querySelector(`[data-key="${key}"]`)?.disabled);
      }
      resets.forEach(button => { button.disabled = false; });
      onChange(settings);
    }

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
      const key = control.dataset.key;
      const edit = live => {
        const number = control.value.trim() === '' ? NaN : Number(control.value);
        if (live && control.type === 'number' && (!Number.isFinite(number) || !control.validity.valid)) return;
        const text = control.type === 'text' || control.type === 'email' || typeof S.defaults[key] === 'string';
        const value = control.type === 'checkbox' ? control.checked : text ? control.value : Number.isFinite(number) ? number : S.defaults[key];
        if (value === valueOf(key, current || {})) return;
        save({ [key]: value });
      };
      if (control.type === 'range') {
        // Show the value at once; save at most every 150 ms while dragging.
        control.addEventListener('input', () => {
          const output = control.closest('.row')?.querySelector('output');
          if (output) output.textContent = `${control.value}%`;
          clearTimeout(rangeTimers.get(control));
          rangeTimers.set(control, setTimeout(() => edit(false), 150));
        });
        control.addEventListener('change', () => { clearTimeout(rangeTimers.get(control)); edit(false); });
        return;
      }
      control.addEventListener('input', () => edit(true));
      control.addEventListener('change', () => edit(false));
    });
    themes.forEach(radio => radio.addEventListener('change', () => { if (radio.checked) save({ ...THEME[radio.value] }); }));
    presets.forEach(button => button.addEventListener('click', () => {
      const [key, raw] = button.dataset.preset.split(':');
      save({ [key]: Number(raw) });
    }));
    resets.forEach(button => button.addEventListener('click', () => {
      const scope = document.getElementById(button.dataset.reset);
      if (!scope) return;
      const keys = [...scope.querySelectorAll('[data-key]')].map(control => control.dataset.key);
      for (const holder of scope.querySelectorAll('[data-keys]')) keys.push(...holder.dataset.keys.split(' '));
      save(Object.fromEntries(keys.map(key => [key, S.defaults[key]])));
    }));

    S.subscribe(fill);
    const ready = S.get().then(settings => { fill(settings); return settings; }, () => { flash('Could not read settings. Reopen settings to try again.', true); return null; });
    return { ready, save, flash, current: () => current, nameOf };
  }

  /* The settings that differ from their defaults. */
  const changed = (settings, defaults) => Object.keys(defaults).filter(key => JSON.stringify(settings[key]) !== JSON.stringify(defaults[key]));

  /* Opens the full settings page, optionally at a card ("#samsung"). */
  function openSettings(hash = '') {
    const chromeApi = typeof chrome !== 'undefined' ? chrome : null;
    if (chromeApi?.runtime?.getURL && chromeApi.tabs?.create) return chromeApi.tabs.create({ url: chromeApi.runtime.getURL(`options.html${hash}`) });
    if (!hash && chromeApi?.runtime?.openOptionsPage) return chromeApi.runtime.openOptionsPage();
    return window.open(`options.html${hash}`, '_blank');
  }

  globalThis.UBIFPlusSettingsUI = Object.freeze({ bind, changed, openSettings, THEME, themeOf });
})();
