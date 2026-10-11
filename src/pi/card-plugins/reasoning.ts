import type { DomCardRenderer } from '../dom-card-renderer';
import type { CardRenderer } from '../card-renderer';

export const defaultReasoningRenderer: CardRenderer<string> = {
  id: 'nimrod.reasoning', supports: data => !!data.trim(),
  mount: () => ({
    update: thinking => ({ title: 'Reasoning', preview: thinking.split(/\r?\n/).find(line => line.trim())?.trim() || '',
      sections: [{ key: 'reasoning', label: 'Reasoning', text: thinking, format: 'markdown' }] }),
    dispose() {},
  }),
};

/** Actual mounted plugin; the pure presentation helper above supports declaration fixtures. */
export const reasoningDomRenderer: DomCardRenderer<string> = {
  apiVersion: 2, id: 'nimrod.reasoning', supports: text => !!text.trim(),
  mount(context) {
    const title = context.document.createElement('span'); title.className = 'tool-card-title'; title.textContent = 'Reasoning';
    const preview = context.document.createElement('span'); preview.className = 'tool-card-preview reasoning-preview';
    context.summary.append(title, preview);
    let previous: string | undefined;
    return { update(thinking) {
      preview.textContent = thinking.split(/\r?\n/).find(line => line.trim())?.trim() || '';
      if (previous !== thinking) { context.body.replaceChildren(context.markdown(thinking)); previous = thinking; }
    }, dispose() {} };
  },
};
