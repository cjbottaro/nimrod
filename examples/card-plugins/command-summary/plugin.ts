import type { CardPlugin, ToolCardData } from '../../../src/card-plugin-api';

const plugin: CardPlugin<ToolCardData> = {
  apiVersion: 2,
  id: 'example.command-summary',
  supports: () => true,
  mount(context) {
    const doc = context.document;
    const title = doc.createElement('span'); title.className = 'tool-card-title';
    const preview = doc.createElement('span'); preview.className = 'tool-card-preview';
    context.summary.append(title, preview);

    const label = doc.createElement('label'); label.textContent = 'Local card note ';
    const note = doc.createElement('input'); note.type = 'text'; note.setAttribute('aria-label', 'Local card note'); label.append(note);
    const copy = doc.createElement('button'); copy.type = 'button'; copy.textContent = 'Copy command'; copy.disabled = !context.capabilities.copy;
    const status = doc.createElement('span'); status.setAttribute('role', 'status');
    const output = doc.createElement('pre'); output.tabIndex = 0; output.setAttribute('aria-label', 'Command output');
    context.body.append(label, copy, status, output);
    const unregister = context.registerOutput('command-output', output);
    let command = ''; let pending = false;
    context.on(copy, 'click', async () => {
      if (pending) return;
      pending = true; copy.setAttribute('aria-busy', 'true');
      try {
        await context.copy(command);
        if (!context.signal.aborted) context.mutate(() => { status.textContent = 'Copied'; });
      } catch {
        if (!context.signal.aborted) context.mutate(() => { status.textContent = 'Copy failed'; });
      } finally { pending = false; if (!context.signal.aborted) copy.removeAttribute('aria-busy'); }
    });
    return {
      update(data) {
        const args = data.arguments && typeof data.arguments === 'object' && !Array.isArray(data.arguments) ? data.arguments as Record<string, unknown> : {};
        command = typeof args.command === 'string' ? args.command : '';
        title.textContent = typeof data.name === 'string' ? data.name : 'Command';
        preview.textContent = command;
        const text = data.resultOutput || data.executionOutput || '';
        if (output.textContent !== text) output.textContent = text;
        // Do not rebuild note or controls: local input/focus survives streaming updates.
      },
      dispose() { unregister(); },
    };
  },
};
export default plugin;
