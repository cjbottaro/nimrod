import type { CardRenderer } from '../card-renderer';

export const defaultReasoningRenderer: CardRenderer<string> = {
  id: 'nimrod.reasoning', supports: data => !!data.trim(),
  mount: () => ({
    update: thinking => ({ title: 'Reasoning', preview: thinking.split(/\r?\n/).find(line => line.trim())?.trim() || '',
      sections: [{ key: 'reasoning', label: 'Reasoning', text: thinking, format: 'markdown' }] }),
    dispose() {},
  }),
};
