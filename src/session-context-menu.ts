import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

export interface SessionMenuAction {
  label: string;
  enabled: boolean;
  run(): void | Promise<void>;
}
export interface SessionMenuTarget {
  pin: SessionMenuAction;
  close: SessionMenuAction;
  delete: SessionMenuAction;
  valid(): boolean;
  error(error: unknown): void;
}

/** One retained native menu per window. Request IDs bind delayed native actions
 * to the exact popup, never to a newer popup or the currently selected session.
 */
export function installSessionContextMenu() {
  let disposed = false;
  let target: { request: string; value: SessionMenuTarget } | undefined;
  const listening = listen<{ request: string; action: 'pin' | 'close' | 'delete' }>('nimrod-session-menu', event => {
    const current = target;
    if (disposed || !current || event.payload.request !== current.request) return;
    const key = event.payload.action;
    if (!['pin', 'close', 'delete'].includes(key)) return;
    target = undefined; // A popup can accept at most one action.
    if (!current.value.valid() || !current.value[key].enabled) return;
    void Promise.resolve().then(() => {
      if (!disposed && current.value.valid()) return current.value[key].run();
    }).catch(error => { if (!disposed && current.value.valid()) current.value.error(error); });
  }, { target: { kind: 'WebviewWindow', label: getCurrentWindow().label } });
  // Keep a failed listener from becoming an unhandled startup rejection; show()
  // reports it for the session that actually requested a menu.
  void listening.catch(() => {});
  return {
    async show(next: SessionMenuTarget, position: { x: number; y: number }): Promise<void> {
      if (disposed || !next.valid()) return;
      const request = crypto.randomUUID();
      target = { request, value: next };
      try {
        await listening;
        if (disposed || target?.request !== request || !next.valid()) return;
        await invoke('popup_session_menu', { request, options: {
          pinLabel: next.pin.label, pinEnabled: next.pin.enabled,
          closeEnabled: next.close.enabled, deleteLabel: next.delete.label, deleteEnabled: next.delete.enabled,
          x: position.x, y: position.y,
        } });
      } catch (error) {
        if (!disposed && target?.request === request) {
          target = undefined;
          if (next.valid()) next.error(error);
        }
      }
    },
    dispose(): void {
      disposed = true; target = undefined;
      void listening.then(unlisten => unlisten(), () => {});
    },
  };
}
