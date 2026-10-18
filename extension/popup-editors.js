/* Settings page editors that do not fit the one-value-per-row settings:
   template wording (note-templates.js) and shortcut keys (hotkey-model.js).
   Both save to their own storage records as you edit, and open portal tabs
   pick the changes up immediately. */
(() => {
  'use strict';
  const T = globalThis.UBIFPlusNoteTemplates;
  const H = globalThis.UBIFPlusHotkeys;
  const S = globalThis.UBIFPlusSettings;
  const el = (tag, text = '', attrs = {}) => {
    const node = document.createElement(tag); node.textContent = text;
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  };
  const say = (node, text, error = false) => { node.textContent = text; node.dataset.error = String(error); };

  /* Template wording: one tab per group, one expandable editor per template. */
  const templateRoot = document.getElementById('template-editor');
  if (T && templateRoot) {
    let group = T.GROUPS[0].id;
    const tabs = el('div', '', { class: 'tabs', role: 'group', 'aria-label': 'Template group' });
    const list = el('div');
    const note = el('p', 'Edits save as you type. Restore default to go back to the standard wording.', { class: 'note', role: 'status', 'aria-live': 'polite' });
    templateRoot.append(tabs, list, note);
    const open = new Set(), timers = new Map();
    for (const g of T.GROUPS) {
      const button = el('button', g.name, { type: 'button', 'data-group': g.id });
      button.addEventListener('click', () => { group = g.id; render(T.list()); });
      tabs.append(button);
    }
    function render(templates) {
      for (const button of tabs.children) button.setAttribute('aria-pressed', String(button.dataset.group === group));
      const focused = document.activeElement?.dataset?.template;
      list.replaceChildren();
      for (const template of templates.filter(t => t.group === group)) {
        const details = el('details', '', { 'data-id': template.id });
        details.open = open.has(template.id);
        details.addEventListener('toggle', () => { if (details.open) open.add(template.id); else open.delete(template.id); });
        const summary = el('summary', template.name);
        if (template.edited) summary.append(el('span', 'Edited', { class: 'badge' }));
        summary.append(el('small', template.summary));
        const area = el('textarea', '', { 'data-template': template.id, maxlength: String(T.MAX), spellcheck: 'true', 'aria-label': `${template.name} wording` });
        area.value = template.text;
        const count = el('span', `${template.text.length} / ${T.MAX}`);
        const restore = el('button', 'Restore default', { type: 'button' });
        restore.disabled = !template.edited;
        const tools = el('div', '', { class: 'tools' });
        tools.append(count, restore);
        area.addEventListener('input', () => {
          count.textContent = `${area.value.length} / ${T.MAX}`;
          clearTimeout(timers.get(template.id));
          say(note, 'Saving…');
          timers.set(template.id, setTimeout(async () => {
            if (!area.value.trim()) { say(note, 'A template cannot be empty. Restore default to reset it.', true); return; }
            try { await T.save(template.id, area.value); say(note, 'Saved'); } catch { say(note, 'Could not save. Try again.', true); }
          }, 400));
        });
        restore.addEventListener('click', async () => {
          try { await T.reset(template.id); say(note, `${template.name} restored.`); } catch { say(note, 'Could not restore. Try again.', true); }
        });
        details.append(summary, area, tools);
        list.append(details);
      }
      if (focused) list.querySelector(`[data-template="${focused}"]`)?.focus();
    }
    // Re-render on outside changes only; typing keeps its own textarea.
    T.subscribe(templates => { if (!templateRoot.contains(document.activeElement) || document.activeElement.tagName !== 'TEXTAREA') render(templates); else for (const template of templates) {
      const details = list.querySelector(`details[data-id="${template.id}"]`);
      if (!details) continue;
      details.querySelector('.badge')?.remove();
      if (template.edited) details.querySelector('summary small').before(el('span', 'Edited', { class: 'badge' }));
      details.querySelector('.tools button').disabled = !template.edited;
    } });
    T.load().then(render, () => say(note, 'Could not read templates.', true));
  }

  /* Shortcut keys: click a key button, then press the combination. While
     recording, key presses are read at the document, so they register even
     if the popup does not keep focus on the button. Messages appear on the
     row being recorded, not only at the end of the long list. */
  const keyRoot = document.getElementById('hotkey-editor');
  if (H && keyRoot) {
    let bindings = {}, listening = null, rowMessage = { id: '', text: '', error: false };
    const list = el('div');
    const note = el('p', 'Click a shortcut, then press the keys. Backspace clears it; Escape cancels.', { class: 'note', role: 'status', 'aria-live': 'polite' });
    keyRoot.append(list, note);
    const actions = H.actions();
    const nameOf = id => actions.find(action => action.id === id)?.name || id;
    const tell = (id, text, error = false) => { rowMessage = { id, text, error }; say(note, text, error); };

    async function store(next, id, message) {
      try { bindings = await H.save(next); tell(id, message); }
      catch { tell(id, 'Could not save. Try again.', true); }
      render();
    }
    function record(id) {
      listening = id;
      tell(id, 'Press the keys, for example ⌥⇧D or Ctrl+Alt+D. Esc cancels.');
      render();
    }
    function stop(message = '') {
      const id = listening;
      listening = null;
      if (message) tell(id, message);
      render();
    }
    function render() {
      list.replaceChildren();
      let group = '';
      for (const action of actions) {
        if (action.group !== group) { group = action.group; list.append(el('h3', group)); }
        const row = el('div', '', { class: 'key-row' });
        const combo = bindings[action.id], active = listening === action.id;
        const key = el('button', active ? 'Press keys…' : combo ? H.format(combo) : 'Not set', {
          type: 'button', class: 'key', 'data-action': action.id, 'data-empty': String(!combo && !active),
          'data-listening': String(active), 'aria-pressed': String(active),
          'aria-label': `${action.name} shortcut: ${combo ? H.format(combo) : 'not set'}. Press to change.` });
        key.addEventListener('click', () => { if (listening === action.id) stop('Unchanged.'); else record(action.id); });
        const clear = el('button', '×', { type: 'button', class: 'clear', 'aria-label': `Clear ${action.name} shortcut` });
        clear.disabled = !combo;
        clear.addEventListener('click', () => { const next = { ...bindings }; delete next[action.id]; listening = null; store(next, action.id, `${action.name} shortcut cleared.`); });
        row.append(el('span', action.name), key, clear);
        list.append(row);
        if (rowMessage.id === action.id && rowMessage.text) {
          const message = el('p', rowMessage.text, { class: 'note row-note', 'data-error': String(rowMessage.error) });
          list.append(message);
        }
        if (active) { key.focus({ preventScroll: true }); row.scrollIntoView?.({ block: 'nearest' }); }
      }
    }
    document.addEventListener('keydown', event => {
      if (!listening) return;
      const id = listening, action = actions.find(a => a.id === id);
      if (event.key === 'Tab') { stop(); return; }
      event.preventDefault(); event.stopPropagation();
      if (event.key === 'Escape') { stop('Unchanged.'); return; }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        const next = { ...bindings }; delete next[id]; listening = null;
        store(next, id, `${action.name} shortcut cleared.`); return;
      }
      const value = H.fromEvent(event);
      if (!value) return; // still holding modifiers
      const problem = H.problem(value);
      if (problem) { tell(id, `${H.format(value)}: ${problem}`, true); render(); return; }
      const owner = Object.keys(bindings).find(other => bindings[other] === value && other !== id);
      if (owner) { tell(id, `${H.format(value)} is already used by ${nameOf(owner)}. Clear that one first.`, true); render(); return; }
      listening = null;
      store({ ...bindings, [id]: value }, id, `Saved: ${action.name} is ${H.format(value)}.`);
    }, true);
    // Clicking outside the shortcut buttons ends recording; clicking another
    // shortcut button switches to it (its click handler does that).
    document.addEventListener('pointerdown', event => {
      if (listening && !event.target.closest?.('#hotkey-editor .key')) stop();
    }, true);
    H.subscribe(next => { bindings = next; if (!listening) render(); });
    H.load().then(next => { bindings = next; render(); });
    render();
  }

  /* The editors follow their feature switch like the other dependent rows. */
  const follow = settings => {
    if (templateRoot) templateRoot.setAttribute('aria-disabled', String(!settings.noteTemplates && !settings.noteTemplatesCheckin));
    if (keyRoot) keyRoot.setAttribute('aria-disabled', String(!settings.hotkeys));
  };
  if (S) { S.subscribe(follow); S.get().then(follow, () => {}); }
})();
