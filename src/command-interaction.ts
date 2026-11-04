import type { HarnessSessionHost } from './harness-host';
import type { CommandInteraction } from './session-commands';

/** Shared modal mechanics only; callers retain command ownership and provenance. */
export function commandInteraction(host: HarnessSessionHost): CommandInteraction {
  const { lifetime, ui } = host;
  const current = (signal: AbortSignal) => lifetime.current() && lifetime.selected() && !lifetime.closing()
    && !lifetime.reloading() && !lifetime.deleting() && !lifetime.settingsOpen() && !signal.aborted;
  return {
    async choice(title, choices, signal) {
      if (!current(signal) || ui.document.querySelector('dialog[open]')) return;
      const request = ui.palette.startSelection(title, () => {}, undefined, true); if (!request) return;
      const cancel = () => request.cancel(); signal.addEventListener('abort', cancel, { once: true });
      try { const selected = await request.chooseItems(choices); return current(signal) ? selected : undefined; }
      finally { signal.removeEventListener('abort', cancel); request.finish(); }
    },
    async input(title, signal) {
      const owner = `${host.id}:harness-command-input`;
      if (!current(signal) || ui.document.querySelector('dialog[open]')) return;
      const cancel = () => ui.dialogs.cancel(owner); signal.addEventListener('abort', cancel, { once: true });
      try { const value = await ui.dialogs.input(title, undefined, owner, 'Run command'); return current(signal) ? value : undefined; }
      finally { signal.removeEventListener('abort', cancel); }
    },
  };
}
