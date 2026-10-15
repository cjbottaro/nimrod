import type { DomCardRenderer } from '../dom-card-renderer';
import type { CardRenderer, CardSection } from '../card-renderer';
import type { ToolCardBlock } from '../tool-card';
import { rawToolPresentation } from './tool-shared';
import { fileInputPreview, normalizedToolName } from './tool-input';
import { editDiff } from './edit-diff';

/** Requested substitutions, not a claim about file contents or successful application. */
export const editPreviewRenderer: CardRenderer<ToolCardBlock> = {
  id: 'nimrod.edit-preview', supports: () => true,
  mount() {
    let cached: { oldText: string; newText: string; diff: ReturnType<typeof editDiff> }[] = [];
    return {
      update(data) {
        const presentation = { ...rawToolPresentation(data), preview: fileInputPreview(data.arguments, data.toolStatus !== undefined) };
        const args = data.arguments;
        if (!args || typeof args !== 'object' || Array.isArray(args)) { cached = []; return presentation; }
        const record = args as Record<string, unknown>;
        const edits = Array.isArray(record.edits) ? record.edits : [record];
        const sections: CardSection[] = [];
        const next: typeof cached = [];
        for (const [index, edit] of edits.entries()) {
          if (!edit || typeof edit !== 'object' || Array.isArray(edit)) continue;
          const { oldText, newText } = edit as Record<string, unknown>;
          if (typeof oldText !== 'string' || typeof newText !== 'string') continue;
          const previous = cached[index];
          const diff = previous?.oldText === oldText && previous.newText === newText ? previous.diff : editDiff(oldText, newText);
          next[index] = { oldText, newText, diff };
          sections.push({ key: `requested-edit:${index}`, label: `+${diff.added} −${diff.removed}`, text: diff.text, format: 'diff' });
        }
        cached = next;
        if (!sections.length) return presentation;
        if (sections.length > 1) sections.forEach((section, index) => { section.label = `${index + 1} of ${sections.length} · ${section.label}`; });
        // Core retains exact output in an independent disclosure when it is omitted here.
        const showOutput = data.isError || data.uiPhase === 'stopped' || data.toolStatus === 'running';
        return { ...presentation, rawInputsPlacement: 'after', sections: [...sections, ...(showOutput ? presentation.sections : [])] };
      },
      dispose() { cached = []; },
    };
  },
};

/** Custom interactive DOM using only the public plugin context. */
export const editDomRenderer: DomCardRenderer<ToolCardBlock> = {
  apiVersion: 2, id: 'nimrod.edit-preview', tools: ['edit'], supports: data => normalizedToolName(data.name) === 'edit',
  mount(context) {
    const presentation = editPreviewRenderer.mount();
    const controls = new Map<string, { button: HTMLButtonElement; wrap: HTMLButtonElement; status: HTMLElement; text: string; remove: () => void }>();
    return { update(data) {
      const value = presentation.update(data); context.renderPresentation(value);
      context.body.classList.add('edit-card-body');
      const preview = context.summary.querySelector<HTMLElement>('.tool-card-preview');
      if (preview && value.preview) {
        preview.classList.add('edit-card-preview');
        const split = Math.max(value.preview.lastIndexOf('/'), value.preview.lastIndexOf('\\'));
        const filename = context.document.createElement('span'); filename.className = 'edit-card-filename';
        filename.textContent = value.preview.slice(split + 1);
        const directory = context.document.createElement('span'); directory.className = 'edit-card-directory';
        const path = context.document.createElement('bdi'); path.dir = 'ltr';
        path.textContent = split >= 0 ? value.preview.slice(0, split + 1) : '';
        directory.append(path);
        preview.replaceChildren(filename, directory);
        preview.setAttribute('aria-label', value.preview);
      }
      const keys = new Set<string>();
      for (const part of value.sections.filter(section => section.format === 'diff')) {
        keys.add(part.key);
        const section = Array.from(context.body.querySelectorAll<HTMLElement>('.tool-section')).find(node => node.dataset.outputKind === part.key)!;
        const label = section.querySelector<HTMLElement>('.tool-label')!;
        const output = section.querySelector<HTMLElement>('.tool-output')!;
        output.setAttribute('aria-label', 'Edit preview');
        let control = controls.get(part.key);
        if (!control) {
          const toolbar = context.document.createElement('div'); toolbar.className = 'edit-card-toolbar';
          const button = context.document.createElement('button'); button.type = 'button'; button.className = 'card-plugin-copy';
          button.textContent = 'Copy'; button.setAttribute('aria-label', 'Copy diff'); button.disabled = !context.capabilities.copy;
          const wrap = context.document.createElement('button'); wrap.type = 'button'; wrap.className = 'edit-card-wrap'; wrap.textContent = 'Wrap'; wrap.setAttribute('aria-pressed', 'false');
          const status = context.document.createElement('span'); status.className = 'card-plugin-copy-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
          control = { button, wrap, status, text: part.text, remove: () => {} }; controls.set(part.key, control);
          const owned = control;
          let pending = false;
          const removeCopy = context.on(button, 'click', async () => {
            if (pending) return;
            pending = true; button.setAttribute('aria-busy', 'true'); status.textContent = '';
            const requested = owned.text;
            try {
              await context.copy(requested);
              if (!context.signal.aborted && controls.get(part.key) === owned && owned.text === requested) context.mutate(() => { status.textContent = 'Copied'; });
            } catch {
              if (!context.signal.aborted && controls.get(part.key) === owned && owned.text === requested) context.mutate(() => { status.textContent = 'Copy failed'; });
            } finally { pending = false; if (!context.signal.aborted) button.removeAttribute('aria-busy'); }
          });
          const removeWrap = context.on(wrap, 'click', () => context.mutate(() => {
            const wrapped = output.classList.toggle('edit-diff-wrapped'); wrap.setAttribute('aria-pressed', String(wrapped));
          }));
          owned.remove = () => { removeCopy(); removeWrap(); };
          label.before(toolbar); toolbar.append(label, status, wrap, button);
        }
        if (control.text !== part.text) { control.text = part.text; control.status.textContent = ''; }
      }
      for (const [key, control] of controls) if (!keys.has(key)) { control.remove(); controls.delete(key); }
    }, dispose() { presentation.dispose(); controls.clear(); } };
  },
};

export default editDomRenderer;
