/* Keyboard shortcuts: the actions that can be bound, how a key press becomes
   a stored combination, and which combinations are refused. Shared by the
   Portal listener (hotkeys.js) and the settings page. Bindings live in their
   own storage record, { [actionId]: "ctrl+alt+g" }, with nothing bound by
   default.

   Every shortcut needs Ctrl, Alt/Option or Cmd so it can work while typing
   in a notes field, and combinations the browser or Portal already use are
   refused. Keys are read from the physical key (event.code), because on a
   Mac Option changes the typed character (Option+G types "©"). */
(() => {
  'use strict';
  const KEY = 'ubif-plus.hotkeys.v1';
  const T = globalThis.UBIFPlusNoteTemplates;
  const MODIFIERS = ['ctrl', 'alt', 'shift', 'meta'];
  const isMac = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || globalThis.navigator?.userAgent || '');

  function actions() {
    const list = [
      { id: 'darkMode.toggle', group: 'General', name: 'Turn dark mode on or off' },
      { id: 'samsung.gd', group: 'Samsung forms', name: 'GD Bypass' },
      { id: 'samsung.fenrir', group: 'Samsung forms', name: 'Fenrir Bypass' },
      { id: 'samsung.wer', group: 'Samsung forms', name: 'WER Request' }
    ];
    for (const template of T ? T.DEFAULTS : []) {
      const group = T.GROUPS.find(g => g.id === template.group);
      list.push({ id: `template.${template.id}`, group: group ? group.name : 'Templates', name: template.name });
    }
    return list;
  }

  /* KeyboardEvent -> "ctrl+alt+g", or '' for a bare modifier or unknown key. */
  function fromEvent(event) {
    const code = String(event.code || '');
    let key = '';
    if (/^Key[A-Z]$/.test(code)) key = code.slice(3).toLowerCase();
    else if (/^Digit\d$/.test(code)) key = code.slice(5);
    else if (/^Numpad\d$/.test(code)) key = code.slice(6);
    else if (/^F([1-9]|1[0-2])$/.test(code)) key = code.toLowerCase();
    else if (['Comma', 'Period', 'Slash', 'Semicolon', 'Quote', 'BracketLeft', 'BracketRight', 'Backslash', 'Minus', 'Equal', 'Backquote'].includes(code)) key = code.toLowerCase();
    if (!key) return '';
    return [...MODIFIERS.filter(name => event[`${name}Key`]), key].join('+');
  }

  /* Keeps a stored combination canonical: known modifiers in order, one key. */
  function normalize(combo) {
    const parts = String(combo || '').toLowerCase().split('+').filter(Boolean);
    const key = parts.filter(part => !MODIFIERS.includes(part));
    if (key.length !== 1) return '';
    return [...MODIFIERS.filter(name => parts.includes(name)), key[0]].join('+');
  }

  const NAMES = { comma: ',', period: '.', slash: '/', semicolon: ';', quote: "'", bracketleft: '[', bracketright: ']', backslash: '\\', minus: '-', equal: '=', backquote: '`' };
  function format(combo) {
    const parts = normalize(combo).split('+').filter(Boolean);
    if (!parts.length) return '';
    const key = parts.pop();
    const label = NAMES[key] || key.toUpperCase();
    const symbols = isMac ? { ctrl: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' } : { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Win' };
    const mods = parts.map(part => symbols[part]);
    return isMac ? `${mods.join('')}${label}` : [...mods, label].join('+');
  }

  /* Why a combination cannot be used, or '' when it can. */
  function problem(combo) {
    const parts = normalize(combo).split('+');
    if (!normalize(combo)) return 'Press a letter, number or punctuation key with a modifier.';
    const key = parts.at(-1), has = name => parts.includes(name);
    if (!has('ctrl') && !has('alt') && !has('meta')) return 'Include Ctrl, Alt/Option or Cmd so it works while typing.';
    // Universal search's shortcut, and everyday browser and editing commands.
    const command = (has('ctrl') || has('meta')) && !has('alt');
    if (command && key === 'k') return 'Already used by universal search.';
    if (command && !has('shift') && 'acvxzyfsprtwnlqh0123456789'.includes(key) && key.length === 1) return 'Already used by the browser.';
    if (command && has('shift') && 'tnzbjiwr'.includes(key) && key.length === 1) return 'Already used by the browser.';
    if (has('alt') && !has('ctrl') && !has('meta') && key.startsWith('f') && key.length > 1) return 'Already used by the system.';
    return '';
  }

  /* Known actions, valid unique combinations. */
  function sanitize(raw) {
    const known = new Set(actions().map(action => action.id)), used = new Set(), next = {};
    for (const [id, combo] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
      const value = normalize(combo);
      if (!known.has(id) || !value || problem(value) || used.has(value)) continue;
      used.add(value); next[id] = value;
    }
    return next;
  }

  const local = () => (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) || null;
  async function load() {
    try { return sanitize((await local()?.get(KEY))?.[KEY]); } catch { return {}; }
  }
  async function save(bindings) {
    const clean = sanitize(bindings);
    await local()?.set({ [KEY]: clean });
    return clean;
  }
  function subscribe(listener) {
    const bus = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged;
    if (!bus || typeof listener !== 'function') return () => {};
    const handle = (changes, area) => { if ((!area || area === 'local') && changes?.[KEY]) listener(sanitize(changes[KEY].newValue)); };
    bus.addListener(handle);
    return () => bus.removeListener?.(handle);
  }

  globalThis.UBIFPlusHotkeys = Object.freeze({ KEY, actions, fromEvent, normalize, format, problem, sanitize, load, save, subscribe });
})();
