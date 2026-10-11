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
