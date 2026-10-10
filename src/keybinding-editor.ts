import { ACTIONS, bindingsFor, bindingConflicts, isMac, recordBinding, shortcutLabel, type ActionId, type KeyOverrides } from './keybindings';

/** Settings-only editor. Host commits against a fresh snapshot, not this UI's stale copy. */
export function installKeybindingEditor(window: Window, content: HTMLElement, host: {
  read(): KeyOverrides;
  save(id: ActionId, bindings: readonly string[] | undefined, reassign: boolean): Promise<void>;
  resetAll(): Promise<void>;
}) {
  const document = content.ownerDocument, mac = isMac(window);
  const section = document.createElement('section'); section.id = 'keybindings-section'; section.setAttribute('aria-labelledby', 'keybindings-title');
  section.innerHTML = `<h2 id="keybindings-title">Keybindings</h2><p class="settings-description">Search actions or shortcuts. Changes apply immediately after saving.</p><div class="keybinding-toolbar"><input id="keybinding-search" type="search" aria-label="Search keybindings" placeholder="Search actions or shortcuts…"><button id="keybinding-reset-all" type="button" class="secondary">Reset all…</button></div><p class="settings-hint">Cmd on macOS, Ctrl on Linux. Project shortcuts pause while dialogs are open. Composer text editing and native menu shortcuts are not customizable here.</p><div id="keybinding-list"></div><p id="keybinding-status" role="status"></p>`;
  section.className = 'settings-panel'; section.dataset.category = 'keybindings';
  section.setAttribute('role', 'tabpanel'); section.setAttribute('aria-labelledby', 'settings-category-keybindings'); section.tabIndex = 0; section.hidden = true;
  content.insertBefore(section, content.querySelector('[data-category="runtime"]'));
  const recorder = document.createElement('dialog'); recorder.id = 'keybinding-recorder'; recorder.className = 'nimrod-modal modal-stack'; recorder.setAttribute('aria-labelledby', 'keybinding-recorder-title');
  recorder.innerHTML = `<h2 id="keybinding-recorder-title" class="modal-title"></h2><p id="keybinding-recorder-help" class="modal-description"></p><input id="keybinding-record" readonly aria-label="Record shortcut" placeholder="Press a shortcut…" autocomplete="off"><p id="keybinding-conflicts" class="modal-description modal-body" role="status"></p><label id="keybinding-reassign-label" hidden><input id="keybinding-reassign" type="checkbox"> Reassign: remove these shortcuts from the listed actions</label><div class="modal-actions"><button id="keybinding-cancel" type="button" class="secondary">Cancel</button><button id="keybinding-save" type="button">Save</button></div>`;
  document.body.append(recorder);
  const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const search = get<HTMLInputElement>('keybinding-search'), list = get('keybinding-list'), status = get('keybinding-status');
  const input = get<HTMLInputElement>('keybinding-record'), save = get<HTMLButtonElement>('keybinding-save'), reassign = get<HTMLInputElement>('keybinding-reassign');
  let editing: { id: ActionId; index?: number; reset?: boolean } | undefined;
  let candidate: string | undefined, resetAll = false, saving = false, disposed = false;
  let editingBindings: readonly string[] = [], reviewedConflicts = '', recorderNotice = '', renderedOverrides = '';
  const notice = (message: string, error = false) => { status.textContent = message; status.classList.toggle('error', error); };
  function render() {
    const overrides = host.read(), query = search.value.toLowerCase().trim();
    renderedOverrides = JSON.stringify(overrides);
    const focusedLabel = list.contains(document.activeElement) ? document.activeElement?.getAttribute('aria-label') : undefined;
    const visible = ACTIONS.filter(action => `${action.label} ${'keywords' in action ? action.keywords : ''} ${action.id} ${bindingsFor(action.id, overrides).map(binding => `${binding} ${shortcutLabel(binding, mac)}`).join(' ')} ${overrides[action.id] !== undefined ? 'modified' : ''}`.toLowerCase().includes(query));
    list.replaceChildren(...visible.map(action => {
      const row = document.createElement('div'); row.className = 'keybinding-row'; row.dataset.action = action.id;
      const description = document.createElement('div'); description.className = 'keybinding-description';
      const label = document.createElement('strong'); label.textContent = action.label;
      const scope = document.createElement('small'); scope.textContent = `${action.scope === 'app' ? 'App' : 'Project'}${overrides[action.id] !== undefined ? ' · Modified' : ''}`;
      description.append(label, scope); row.append(description);
      const controls = document.createElement('div'); controls.className = 'keybinding-buttons';
      const button = (text: string, aria: string, run: () => void) => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.textContent = text; button.setAttribute('aria-label', aria); button.disabled = saving; button.addEventListener('click', run); controls.append(button);
      };
      bindingsFor(action.id, overrides).forEach((binding, index) => {
        button(shortcutLabel(binding, mac), `Change ${action.label} shortcut ${shortcutLabel(binding, mac)}`, () => open({ id: action.id, index }));
        button('×', `Remove ${action.label} shortcut ${shortcutLabel(binding, mac)}`, () => {
          const remaining = bindingsFor(action.id, host.read()).filter(value => value !== binding);
          void commit(() => host.save(action.id, remaining, false));
        });
      });
      if (!bindingsFor(action.id, overrides).length) { const none = document.createElement('span'); none.textContent = 'Unbound'; controls.append(none); }
      button('Add', `Add shortcut for ${action.label}`, () => open({ id: action.id }));
      button('Reset', `Reset ${action.label}`, () => open({ id: action.id, reset: true }));
      controls.lastElementChild!.toggleAttribute('disabled', saving || overrides[action.id] === undefined);
      row.append(controls); return row;
    }));
    if (!visible.length) list.textContent = 'No matching actions.';
    get<HTMLButtonElement>('keybinding-reset-all').disabled = saving || !Object.keys(overrides).length;
    if (focusedLabel && !document.querySelector('dialog[open]:not(#settings-page)')) {
      const replacement = [...list.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === focusedLabel && !button.disabled);
      (replacement ?? search).focus({ preventScroll: true });
    }
  }
  function proposed(): readonly string[] | undefined {
    if (!editing || editing.reset) return undefined;
    const bindings = [...editingBindings];
    if (candidate) { if (editing.index === undefined) bindings.push(candidate); else bindings[editing.index] = candidate; }
    return bindings;
  }
  function updateRecorder() {
    if (!recorder.open || resetAll || !editing) return;
    const bindings = proposed() ?? ACTIONS.find(action => action.id === editing!.id)!.defaults;
    const overrides = host.read();
    const stale = JSON.stringify(editingBindings) !== JSON.stringify(bindingsFor(editing.id, overrides));
    const conflicts = bindingConflicts(editing.id, bindings, overrides, mac);
    const signature = JSON.stringify(conflicts);
    if (signature !== reviewedConflicts) reassign.checked = false;
    reviewedConflicts = signature;
    const conflictNotice = conflicts.length ? `Also assigned to: ${[...new Set(conflicts.map(conflict => ACTIONS.find(action => action.id === conflict.id)!.label))].join(', ')}.` : '';
    get('keybinding-conflicts').textContent = stale ? 'This action changed in settings.json. Cancel and reopen to edit its updated shortcuts.' : [recorderNotice, conflictNotice].filter(Boolean).join(' ');
    get('keybinding-reassign-label').hidden = !conflicts.length;
    save.disabled = saving || stale || !editing.reset && !candidate || !!conflicts.length && !reassign.checked;
  }
  function open(action?: typeof editing) {
    if (saving || recorder.open || document.querySelector('dialog[open]:not(#settings-page)')) return;
    editing = action; resetAll = !action; candidate = undefined; reassign.checked = false;
    editingBindings = action ? [...bindingsFor(action.id, host.read())] : [];
    reviewedConflicts = ''; recorderNotice = '';
    get('keybinding-conflicts').textContent = ''; get('keybinding-reassign-label').hidden = true;
    get('keybinding-recorder-title').textContent = action ? `${action.reset ? 'Reset' : 'Edit'} ${ACTIONS.find(item => item.id === action.id)!.label}` : 'Reset all keybindings?';
    get('keybinding-recorder-help').textContent = resetAll ? 'Remove every user override, including disabled bindings, and restore built-in defaults.' : action?.reset ? 'Restore all built-in shortcuts for this action.' : 'Press a shortcut, then Save. Escape cancels. Native editing and menu shortcuts are reserved.';
    input.hidden = resetAll || !!action?.reset; input.value = '';
    save.textContent = resetAll || action?.reset ? 'Reset' : 'Save'; save.disabled = !!action && !action.reset;
    recorder.showModal(); updateRecorder(); (input.hidden ? get('keybinding-cancel') : input).focus({ preventScroll: true });
  }
  async function commit(operation: () => Promise<void>, close = false) {
    if (saving) return;
    saving = true; save.disabled = true; render(); notice('Saving…');
    try {
      await operation();
      if (disposed) return;
      if (close) recorder.close();
      notice('Saved. Keybindings updated.');
    } catch (error) {
      if (disposed) return;
      notice(`Not saved: ${String(error)}`, true);
      if (recorder.open) { recorderNotice = `Not saved: ${String(error)}`; get('keybinding-conflicts').textContent = recorderNotice; }
    } finally { saving = false; if (!disposed) { render(); updateRecorder(); } }
  }
  const record = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!saving) recorder.close(); return; }
    if (event.target !== input) return;
    // Tab navigates to Save/Cancel; shortcuts containing Tab remain reserved.
    if (event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) return;
    event.preventDefault(); event.stopPropagation();
    if (saving) return;
    try {
      const binding = recordBinding(event, mac); if (!binding) return;
      candidate = binding; recorderNotice = ''; input.value = shortcutLabel(binding, mac); reassign.checked = false; updateRecorder();
    } catch (error) { candidate = undefined; input.value = ''; save.disabled = true; get('keybinding-conflicts').textContent = String(error); }
  };
  const cancel = (event: Event) => { event.preventDefault(); if (!saving) recorder.close(); };
  recorder.addEventListener('keydown', record); recorder.addEventListener('cancel', cancel);
  recorder.addEventListener('close', () => {
    // Saving redraws the originating row; do not restore focus to a detached button.
    if (!disposed && !document.querySelector('dialog[open]:not(#settings-page)')) search.focus({ preventScroll: true });
  });
  get('keybinding-cancel').addEventListener('click', () => { if (!saving) recorder.close(); });
  save.addEventListener('click', () => {
    if (save.disabled || saving) return;
    if (resetAll) void commit(() => host.resetAll(), true);
    else if (editing) { const id = editing.id, bindings = proposed(), reassigning = reassign.checked; void commit(() => host.save(id, bindings, reassigning), true); }
  });
  reassign.addEventListener('change', updateRecorder);
  search.addEventListener('input', render);
  get('keybinding-reset-all').addEventListener('click', () => open());
  render();
  return {
    reload() { if (JSON.stringify(host.read()) === renderedOverrides) return; render(); updateRecorder(); },
    focus() { section.scrollIntoView?.({ block: 'start' }); search.focus({ preventScroll: true }); },
    dispose() { disposed = true; recorder.remove(); section.remove(); },
  };
}
