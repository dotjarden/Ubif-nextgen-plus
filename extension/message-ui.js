/* Small, native-looking shortcuts; a visual editor keeps token syntax out of
 * the user flow. The existing v1 template definitions remain compatible. */
(() => {
  'use strict';
  globalThis.UBIFPlusMessageUI = { create(root, api) {
    const M = api.model;
    const title = key => M.fields.find(f => f[0] === key)?.[1] || 'Unknown detail';
    const defaultFallback = { 'customer.firstName': 'there', 'device.name': 'your device', 'device.model': 'your device' };
    let resumeView = 'library';
    let view = 'closed', selected = '', query = '', editorBody = '', editorName = '', editorRange = null, undo = null;
    let temporary = {}, temporaryKey = '', busy = false, feedback = '', fieldToken = null, pendingApply = null;
    const el = (tag, text, attrs = {}) => {
      const node = document.createElement(tag);
      if (text) node.textContent = text;
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
      return node;
    };
    const btn = (text, action, cls = '', label = '') => {
      const b = el('button', text, { type: 'button', class: cls });
      if (label) b.setAttribute('aria-label', label);
      b.onclick = action; return b;
    };
    const label = (parent, text, input, id) => { input.id = id; parent.append(el('label', text, { for: id }), input); };
    const actions = (parent, ...buttons) => { const row = el('div', '', { class: 'actions' }); row.append(...buttons); parent.append(row); };
    const style = el('style');
    style.textContent = `
      :host{position:relative;display:block;flex-shrink:0;min-width:0;margin:0;color:var(--aui-on-surface,#242128);font:inherit;font-size:14px;line-height:1.5;--line:var(--aui-outline-soft,#dedbe3);--muted:var(--aui-on-surface-soft,#66616c);--paper:var(--aui-surface,#fff);--wash:var(--aui-surface-variant,#f7f5f9);--accent:var(--aui-primary,#8224ce)}
      *{box-sizing:border-box}button,input{font:inherit;color:inherit}button{cursor:pointer;border:0;background:transparent;padding:7px 10px;border-radius:6px;min-height:32px}button:hover:not(:disabled){background:var(--wash)}button:disabled{opacity:.45;cursor:default}button:focus-visible,input:focus-visible,.editor:focus-visible,.token:focus-visible{outline:2px solid var(--accent);outline-offset:2px}button.primary{background:var(--accent);color:var(--aui-on-primary,#fff);padding:8px 14px;font-weight:600}button.primary:hover{filter:brightness(.94)}.quiet{color:var(--muted)}.link{color:var(--accent);padding-inline:0;font-size:12px}.shortcut-bar{display:flex;gap:6px;align-items:center;padding:4px 16px 8px;min-width:0}.shortcuts{display:flex;gap:6px;flex:1;overflow:auto;scrollbar-width:none}.shortcut{white-space:nowrap;border:1px solid var(--aui-outline,var(--line));border-radius:4px;font-size:inherit;padding:4px 12px;min-height:32px;flex-shrink:0}.toggle{white-space:nowrap;color:var(--accent);font-size:12px;font-weight:600}.toggle[aria-expanded=true]{background:var(--wash)}.workspace{position:absolute;left:16px;right:16px;bottom:100%;z-index:2;box-shadow:0 8px 28px #24152f18;margin:0 0 6px;border:1px solid var(--line);border-radius:10px;background:var(--paper);overflow:hidden}.workspace[hidden]{display:none}.head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line)}.head strong{flex:1;font-size:14px}.head button{padding:4px 8px}.content{padding:12px;max-height:min(52vh,var(--template-height,360px));overflow:auto;overscroll-behavior:contain}.section-title{margin:0 0 8px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}input{width:100%;min-width:0;border:1px solid var(--line);border-radius:6px;padding:8px 10px;background:var(--paper)}label{display:block;margin:12px 0 5px;font-size:12px;font-weight:600}.search{margin-bottom:8px}.list{display:flex;flex-direction:column;gap:2px}.item{display:flex;align-items:center;border-bottom:1px solid var(--line);gap:4px}.item:last-child{border-bottom:0}.pick{text-align:left;flex:1;min-width:0;padding:10px 2px}.pick strong{display:block;font-weight:500;font-size:13px}.pick small{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:12px;color:var(--muted);margin-top:3px;overflow-wrap:anywhere}.edit-action{color:var(--muted);font-size:12px;flex-shrink:0}.hint{margin:7px 0;color:var(--muted);font-size:12px;line-height:1.5;overflow-wrap:anywhere}.notice{margin:0 16px 6px;font-size:12px;color:var(--muted)}.notice:empty{display:none}.actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:12px}.workspace>.actions{margin:0;padding:10px 12px;border-top:1px solid var(--line);background:var(--paper)}.actions .push{margin-left:auto}.editor{border:1px solid var(--line);border-radius:7px;padding:10px;min-height:100px;max-height:180px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;outline-offset:2px;line-height:1.9}.editor:empty:before{content:attr(data-placeholder);color:var(--muted);pointer-events:none}.token{display:inline-block;white-space:nowrap;border-radius:5px;padding:0 6px;background:var(--wash);border:1px solid var(--line);color:var(--accent);font-size:12px;line-height:1.7;cursor:pointer;vertical-align:baseline;user-select:all}.field-tools{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}.field-tools button{border:1px solid var(--line);border-radius:14px;font-size:11px;padding:3px 8px;min-height:28px}.field-tools small{color:var(--muted)}.more-fields{margin-top:8px}.more-fields summary{font-size:12px;color:var(--muted);cursor:pointer}.preview{border-left:2px solid var(--line);padding:4px 0 4px 10px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.6;margin:6px 0}.preview-title{font-size:11px;color:var(--muted);font-weight:600;margin:14px 0 3px}.field-settings{padding:10px;background:var(--wash);border-radius:7px;margin-top:10px}.field-settings label{margin-top:6px}.required{font-size:12px;color:var(--muted)}.danger{color:var(--aui-status-error,#b42318)}.footer{padding-top:10px;margin-top:12px;border-top:1px solid var(--line)}
    `;
    const bar = el('div', '', { class: 'shortcut-bar', 'aria-label': 'Message templates' });
    const shortcuts = el('div', '', { class: 'shortcuts' });
    const toggle = btn('Templates', () => { captureEditor(); if (view === 'closed') view = resumeView; else { resumeView = view; view = 'closed'; } paint(); }, 'toggle');
    toggle.setAttribute('aria-controls', 'template-workspace');
    bar.append(shortcuts, toggle);
    const workspace = el('section', '', { class: 'workspace', id: 'template-workspace', 'aria-label': 'Customize message templates', hidden: '' });
    const notice = el('div', '', { class: 'notice', role: 'status', 'aria-live': 'polite' });
    root.replaceChildren(style, workspace, bar, notice);
    let content, editor, nameInput, preview, previewHint, fillPanel;
    const current = () => api.getTemplates().find(t => t.id === selected);
    const tokens = body => [...String(body).matchAll(/\{\{\s*([^{}|]+?)(?:\|([^{}]*))?\s*\}\}/g)].map(m => ({ start: m.index, end: m.index + m[0].length, key: m[1].trim(), fallback: m[2]?.trim() || '' }));
    function unresolved(body, values) { return tokens(body).filter(t => !String(values[t.key] || '').trim() && !t.fallback).map(t => t.key).filter((key, i, all) => all.indexOf(key) === i); }
    const overrides = () => Object.fromEntries(Object.entries(temporary).filter(([, value]) => String(value).trim()));
    function serialize(node) {
      if (node.nodeType === 3) return node.textContent.replace(/\u200b/g, '');
      if (node.dataset?.field) return `{{${node.dataset.field}${node.dataset.fallback ? `|${node.dataset.fallback}` : ''}}}`;
      if (node.tagName === 'BR') return '\n';
      return [...node.childNodes].map((child, i) => `${i && /^(DIV|P)$/.test(child.tagName) ? '\n' : ''}${serialize(child)}`).join('');
    }
    function captureEditor() { if (editor?.isConnected) { editorBody = serialize(editor); editorName = nameInput.value; } }
    function rememberRange() {
      if (!editor) return;
      const inside = range => range && editor.contains(range.startContainer) && editor.contains(range.endContainer);
      // Document.getSelection().getRangeAt() can expose the shadow host instead
      // of the editor in Chrome. Ask for the actual shadow-tree boundaries.
      const selection = document.getSelection();
      const composed = selection?.getComposedRanges?.({ shadowRoots: [root] });
      let range = composed?.find(inside);
      if (range) {
        const restored = document.createRange();
        restored.setStart(range.startContainer, range.startOffset);
        restored.setEnd(range.endContainer, range.endOffset);
        range = restored;
      } else {
        const local = root.getSelection?.() || selection;
        range = local?.rangeCount ? local.getRangeAt(0) : null;
      }
      // Moving focus to Name, More details or a button must not erase the
      // saved position in the message.
      if (inside(range)) editorRange = range.cloneRange();
    }
    function insertNode(node) {
      rememberRange();
      editor.focus();
      const range = editorRange && editor.contains(editorRange.startContainer) && editor.contains(editorRange.endContainer) ? editorRange : document.createRange();
      if (range !== editorRange) { range.selectNodeContents(editor); range.collapse(false); }
      range.deleteContents(); range.insertNode(node);
      const after = document.createTextNode('\u200b'); node.after(after); range.setStart(after, 1); range.collapse(true);
      const selection = root.getSelection?.() || document.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
      editorRange = range.cloneRange(); captureEditor(); updatePreview();
    }
    function makeToken(key, fallback) {
      const token = el('span', title(key), { class: 'token', contenteditable: 'false', tabindex: '0', role: 'button', 'aria-label': `Customize ${title(key)}` });
      token.dataset.field = key; token.dataset.fallback = fallback || '';
      token.title = `${title(key)} · ${api.getContext().values[key] || fallback || 'Add when using the template'}`;
      const open = () => { captureEditor(); fieldToken = token; showFieldSettings(); };
      token.onclick = open; token.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
      return token;
    }
    function hydrate() {
      let at = 0;
      for (const t of tokens(editorBody)) { editor.append(document.createTextNode(editorBody.slice(at, t.start)), makeToken(t.key, t.fallback)); at = t.end; }
      editor.append(document.createTextNode(editorBody.slice(at)));
    }
    function showFieldSettings() {
      fillPanel.replaceChildren();
      if (!fieldToken?.isConnected) return;
      const key = fieldToken.dataset.field;
      const box = el('div', '', { class: 'field-settings' });
      box.append(el('strong', title(key)), el('p', api.getContext().values[key] ? `For this customer: ${api.getContext().values[key]}` : 'This detail isn’t available for this customer.', { class: 'hint' }));
      const fallback = el('input', '', { placeholder: 'Leave blank to ask when using the template', maxlength: '200' }); fallback.value = fieldToken.dataset.fallback;
      label(box, 'If unavailable, use this text', fallback, 'field-fallback');
      actions(box, btn('Done', () => {
        if (/[{}|]/.test(fallback.value)) { notice.textContent = 'Use plain text without braces or a vertical bar.'; return; }
        fieldToken.dataset.fallback = fallback.value.trim(); captureEditor(); fieldToken = null; fillPanel.replaceChildren(); updatePreview();
      }, 'primary'), btn('Remove detail', () => { fieldToken.remove(); fieldToken = null; captureEditor(); fillPanel.replaceChildren(); updatePreview(); }, 'quiet'));
      fillPanel.append(box); fallback.focus();
    }
    function startEdit(row, duplicate = false) {
      selected = duplicate ? '' : row?.id || ''; editorName = row ? `${row.name}${duplicate ? ' copy' : ''}` : ''; editorBody = row?.body || '';
      view = 'editor'; fieldToken = null; editorRange = null; feedback = ''; paint(); nameInput.focus();
    }
    async function saveList(next, done) {
      if (busy) return;
      busy = true; root.querySelectorAll('button,input,[contenteditable=true]').forEach(n => { if (n.matches('[contenteditable]')) n.contentEditable = 'false'; else n.disabled = true; });
      try { await api.save(next); done(); }
      catch { notice.textContent = 'Couldn’t save. Your changes are still here. Try again.'; }
      finally { busy = false; root.querySelectorAll('button,input').forEach(n => n.disabled = false); if (editor?.isConnected) editor.contentEditable = 'true'; }
    }
    function apply(row, mode = '') {
      if (!row) return;
      selected = row.id;
      const c = api.getContext();
      if (c.loading) { pendingApply = { row, mode, key: c.key }; notice.textContent = 'Loading customer details…'; return; }
      if (temporaryKey !== c.key) { temporary = {}; temporaryKey = c.key; }
      const values = { ...c.values, ...overrides() }, result = M.render(row.body, values);
      if (result.unknown.length) { startEdit(row); notice.textContent = 'This template has an unrecognized detail. Edit it before using it.'; return; }
      if (unresolved(row.body, values).length || api.getDraft().trim() && !mode) { view = 'use'; paint(); return; }
      const error = api.use(result.text, mode);
      if (error) { notice.textContent = error; return; }
      view = 'closed'; resumeView = 'library'; feedback = 'Message ready to send.'; paint();
    }
    function updatePreview() {
      const c = api.getContext();
      if (temporaryKey !== c.key) { temporary = {}; temporaryKey = c.key; if (view === 'use') { paint(); return; } }
      if (view !== 'editor' && view !== 'use') return;
      const source = view === 'editor' ? serialize(editor) : current()?.body || '';
      const values = view === 'editor' ? c.values : { ...c.values, ...overrides() }, result = M.render(source, values);
      const missing = unresolved(source, values);
      if (view === 'use') {
        const shown = [...content.querySelectorAll('[data-missing-field]')].map(input => input.dataset.missingField);
        if (shown.some(key => String(c.values[key] || '').trim())) {
          // Arrival context can arrive after the first template click. Remove
          // obsolete missing-data inputs and finish the original click.
          if (!missing.length && !api.getDraft().trim() && !c.loading) apply(current());
          else paint();
          return;
        }
      }
      preview.textContent = result.text || 'Your message preview will appear here.';
      previewHint.textContent = missing.length ? `${missing.map(title).join(', ')} ${missing.length === 1 ? 'can be added' : 'can be added'} when you use this template.` : result.missing.length ? `Using alternate text for ${result.missing.map(title).join(', ').toLowerCase()}.` : c.loading ? 'Customer details are loading…' : 'Details update for each customer.';
      if (view === 'editor') for (const token of editor.querySelectorAll('[data-field]')) token.title = `${title(token.dataset.field)} · ${values[token.dataset.field] || token.dataset.fallback || 'Add when using the template'}`;
    }
    function paint() {
      editor = null; editorRange = null;
      shortcuts.replaceChildren();
      for (const row of api.getTemplates().slice(0, api.getShortcuts?.() === false ? 0 : 2)) shortcuts.append(btn(row.name, () => apply(row), 'shortcut', `Use ${row.name}`));
      toggle.setAttribute('aria-expanded', String(view !== 'closed'));
      notice.replaceChildren(); if (feedback) notice.append(document.createTextNode(feedback));
      if (undo) notice.append(btn('Undo', () => saveList(undo, () => { undo = null; feedback = 'Template restored.'; paint(); }), 'link'));
      root.host.style.setProperty('--template-height', `${api.getHeight?.(view) || 360}px`);
      workspace.hidden = view === 'closed'; workspace.replaceChildren();
      if (view === 'closed') return;
      const head = el('div', '', { class: 'head' });
      head.append(el('strong', view === 'editor' ? selected ? 'Edit template' : 'New template' : view === 'use' ? current()?.name || 'Use template' : 'Your templates'));
      head.append(btn('×', () => { captureEditor(); resumeView = view; view = 'closed'; paint(); }, 'quiet', 'Close templates'));
      content = el('div', '', { class: 'content' }); workspace.append(head, content);
      if (view === 'library') {
        const search = el('input', '', { type: 'search', placeholder: 'Find a template', 'aria-label': 'Find a template', class: 'search' }); search.value = query;
        const list = el('div', '', { class: 'list' });
        const renderList = () => {
          list.replaceChildren();
          for (const row of api.getTemplates().filter(t => `${t.name} ${t.body}`.toLowerCase().includes(query.toLowerCase()))) {
            const item = el('div', '', { class: 'item' }), pick = btn('', () => apply(row), 'pick', `Use ${row.name}`);
            pick.append(el('strong', row.name), el('small', M.render(row.body, api.getContext().values).text));
            item.append(pick, btn('Edit', () => startEdit(row), 'edit-action', `Edit ${row.name}`)); list.append(item);
          }
          if (!list.childNodes.length) list.append(el('p', api.getTemplates().length ? 'No matching templates.' : 'Save a message you use often, then reuse it for any customer.', { class: 'hint' }));
        };
        search.oninput = () => { query = search.value; renderList(); }; content.append(search, list); renderList();
        // In Portal, the settings page has the same library on a full page.
        if (api.openSettings) actions(content, btn('+ New template', () => startEdit(null), 'link'), btn('Manage in settings', () => api.openSettings(), 'link'));
        else actions(content, btn('+ New template', () => startEdit(null), 'link'));
        return;
      }
      if (view === 'editor') {
        nameInput = el('input', '', { maxlength: '100', placeholder: 'e.g. Waiting for a part' }); nameInput.value = editorName;
        label(content, 'Name', nameInput, 'template-name');
        editor = el('div', '', { class: 'editor', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Template message', id: 'template-body', 'data-placeholder': 'Write your message…' });
        label(content, 'Message', editor, 'template-body'); hydrate();
        editor.oninput = () => { rememberRange(); captureEditor(); updatePreview(); };
        editor.onkeyup = rememberRange; editor.onmouseup = rememberRange;
        editor.onpointerup = rememberRange;
        // Save before Tab or a click transfers focus to a detail button.
        // Insertion restores this range and leaves the caret after the chip.
        editor.onkeydown = rememberRange; editor.onblur = rememberRange;
        editor.addEventListener('beforeinput', e => { if (e.inputType === 'insertParagraph') { e.preventDefault(); rememberRange(); insertNode(document.createTextNode('\n')); } });
        editor.addEventListener('paste', e => { e.preventDefault(); rememberRange(); insertNode(document.createTextNode((e.clipboardData?.getData('text/plain') || '').slice(0, 10000))); });
        content.append(el('p', 'Add a detail below. It fills in for each customer.', { class: 'hint' }));
        const tools = fields => {
          const group = el('div', '', { class: 'field-tools' });
          for (const [key, name] of fields) {
            const chip = btn(`+ ${name}`, () => insertNode(makeToken(key, defaultFallback[key])), '', `Add ${name}`);
            chip.title = api.getContext().values[key] || defaultFallback[key] || 'You’ll be asked if this detail is missing';
            const keepCaret = e => { rememberRange(); e.preventDefault(); };
            chip.onpointerdown = keepCaret; chip.onmousedown = keepCaret; group.append(chip);
          }
          return group;
        };
        const common = ['employee.firstName', 'customer.firstName', 'device.name', 'appointment.date', 'workorder.number'];
        content.append(tools(M.fields.filter(f => common.includes(f[0]))));
        const more = el('details', '', { class: 'more-fields' }); more.append(el('summary', 'More details'), tools(M.fields.filter(f => !common.includes(f[0])))); content.append(more);
        fillPanel = el('div'); content.append(fillPanel);
        content.append(el('p', 'PREVIEW FOR THIS CUSTOMER', { class: 'preview-title' })); preview = el('div', '', { class: 'preview' }); previewHint = el('p', '', { class: 'hint' }); content.append(preview, previewHint); updatePreview();
        actions(workspace, btn('Save template', () => {
          captureEditor();
          if (!editorName.trim() || !editorBody.trim()) { notice.textContent = 'Give your template a name and a message.'; return; }
          if (editorBody.length > 10000) { notice.textContent = 'Keep your template under 10,000 characters.'; return; }
          if (M.render(editorBody, api.getContext().values).unknown.length) { notice.textContent = 'Remove unrecognized details before saving.'; return; }
          const row = { id: selected || crypto.randomUUID(), name: editorName.trim(), body: editorBody };
          const next = selected ? api.getTemplates().map(t => t.id === selected ? row : t) : [...api.getTemplates(), row];
          if (next.length > 100) { notice.textContent = 'You can save up to 100 templates.'; return; }
          saveList(next, () => { selected = row.id; view = 'library'; resumeView = 'library'; feedback = 'Template saved.'; undo = null; paint(); });
        }, 'primary'), btn('Cancel', () => { view = 'library'; paint(); }, 'quiet'));
        if (selected) {
          const footer = el('div', '', { class: 'footer' });
          actions(footer, btn('Make a copy', () => { captureEditor(); startEdit({ name: editorName, body: editorBody }, true); }, 'link'), btn('Delete template', () => {
            const old = api.getTemplates().map(t => ({ ...t }));
            saveList(old.filter(t => t.id !== selected), () => { undo = old; selected = ''; view = 'library'; feedback = 'Template deleted.'; paint(); });
          }, 'danger push')); content.append(footer);
        }
      } else {
        const row = current(), c = api.getContext();
        const needed = unresolved(row?.body || '', { ...c.values, ...overrides() });
        if (needed.length) content.append(el('p', 'Add the missing details for this message.', { class: 'hint' }));
        for (const key of needed) {
          const input = el('input', '', { placeholder: `Enter ${title(key).toLowerCase()}`, 'data-missing-field': key, maxlength: '500' });
          label(content, title(key), input, `missing-${key.replace('.', '-')}`);
          input.oninput = () => { temporary[key] = input.value; updatePreview(); };
        }
        content.append(el('p', 'MESSAGE PREVIEW', { class: 'preview-title' })); preview = el('div', '', { class: 'preview' }); previewHint = el('p', '', { class: 'hint' }); content.append(preview, previewHint); updatePreview();
        if (api.getDraft().trim()) {
          content.append(el('p', 'You already have a draft. Keep it and add this message, or replace it.', { class: 'hint' }));
          actions(content, btn('Add to draft', () => finish('append'), 'primary'), btn('Replace draft', () => finish('replace'), 'quiet'));
        } else actions(content, btn('Use template', () => finish('replace'), 'primary'));
        actions(content, btn('Back to templates', () => { view = 'library'; paint(); }, 'link'));
        function finish(mode) {
          if (unresolved(row.body, { ...api.getContext().values, ...overrides() }).length) { notice.textContent = 'Add the missing details above first.'; content.querySelector('[data-missing-field]')?.focus(); return; }
          apply(row, mode);
        }
      }
    }
    paint();
    return { updateSettings() { captureEditor(); paint(); }, update(reset = false) {
      if (reset) pendingApply = null;
      if (pendingApply && !api.getContext().loading) {
        const pending = pendingApply; pendingApply = null;
        if (pending.key === api.getContext().key) { apply(pending.row, pending.mode); return; }
      }
      if (reset) { temporary = {}; temporaryKey = api.getContext().key; feedback = ''; if (view === 'use') { view = 'library'; paint(); return; } }
      if (view === 'library') { paint(); return; }
      updatePreview();
    } };
  } };
})();
