import type { DomCardRenderer } from '../dom-card-renderer';
import type { CardRenderer, CardSection } from '../card-renderer';
import type { ToolCardBlock } from '../tool-card';
import { defaultToolRenderer } from './tool';

/** Requested substitutions, not a claim about file contents or successful application. */
export const editPreviewRenderer: CardRenderer<ToolCardBlock> = {
  id: 'nimrod.edit-preview', supports: () => true,
  mount() {
    const base = defaultToolRenderer.mount();
    return {
      update(data) {
        const presentation = base.update(data);
        const args = data.arguments;
        if (!args || typeof args !== 'object' || Array.isArray(args)) return presentation;
        const record = args as Record<string, unknown>;
        const edits = Array.isArray(record.edits) ? record.edits : [record];
        const sections: CardSection[] = [];
        for (const [index, edit] of edits.entries()) {
          if (!edit || typeof edit !== 'object' || Array.isArray(edit)) continue;
          const { oldText, newText } = edit as Record<string, unknown>;
          if (typeof oldText !== 'string' || typeof newText !== 'string') continue;
          const removed = oldText === '' ? [] : oldText.split('\n').map(line => `-${line}`);
          const added = newText === '' ? [] : newText.split('\n').map(line => `+${line}`);
          sections.push({ key: `requested-edit:${index}`, label: `Requested edit ${index + 1} (not an applied-file diff)`,
            text: [...removed, ...added].join('\n'), format: 'diff' });
        }
        return { ...presentation, sections: [...sections, ...presentation.sections] };
      },
      dispose() { base.dispose(); },
    };
  },
};

/** Custom interactive DOM using only the public plugin context. */
export const editDomRenderer: DomCardRenderer<ToolCardBlock> = {
  apiVersion: 2, id: 'nimrod.edit-preview', supports: () => true,
  mount(context) {
    const presentation = editPreviewRenderer.mount();
    const controls = new Map<string, { button: HTMLButtonElement; status: HTMLElement; text: string; remove: () => void }>();
    return { update(data) {
      const value = presentation.update(data); context.renderPresentation(value);
      const keys = new Set<string>();
      for (const part of value.sections.filter(section => section.format === 'diff')) {
        keys.add(part.key);
        let control = controls.get(part.key);
        if (!control) {
          const button = context.document.createElement('button'); button.type = 'button'; button.className = 'card-plugin-copy';
          button.textContent = 'Copy requested diff'; button.disabled = !context.capabilities.copy;
          const status = context.document.createElement('span'); status.className = 'card-plugin-copy-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
          control = { button, status, text: part.text, remove: () => {} }; controls.set(part.key, control);
          const owned = control;
          let pending = false;
          owned.remove = context.on(button, 'click', async () => {
            if (pending) return;
            pending = true; button.setAttribute('aria-busy', 'true'); status.textContent = '';
            const requested = owned.text;
            try {
              await context.copy(requested);
              if (!context.signal.aborted && owned.text === requested) context.mutate(() => { status.textContent = 'Copied'; });
            } catch {
              if (!context.signal.aborted) context.mutate(() => { status.textContent = 'Copy failed'; });
            } finally { pending = false; if (!context.signal.aborted) button.removeAttribute('aria-busy'); }
          });
          const section = Array.from(context.body.querySelectorAll<HTMLElement>('.tool-section')).find(node => node.dataset.outputKind === part.key)!;
          section.querySelector('.tool-label')!.after(button, status);
        }
        if (control.text !== part.text) { control.text = part.text; control.status.textContent = ''; }
      }
      for (const [key, control] of controls) if (!keys.has(key)) { control.remove(); control.button.remove(); control.status.remove(); controls.delete(key); }
    }, dispose() { presentation.dispose(); controls.clear(); } };
  },
};
