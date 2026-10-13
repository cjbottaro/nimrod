import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { installWindowAppearance, type AppearanceCapabilities, type AppearanceControls, type AppearanceHost } from './window-appearance';
import './window-appearance.css';

/** A narrow native boundary shared by project, Settings and reference windows. */
export function installNativeWindowAppearance(host: Pick<AppearanceHost, 'read' | 'save' | 'report'>, controls?: AppearanceControls) {
  const appearance = installWindowAppearance(window, document.documentElement, {
    ...host,
    capabilities: () => invoke<AppearanceCapabilities>('window_appearance_capabilities'),
    apply: (frosted, dark) => invoke<AppearanceCapabilities>('apply_window_appearance', { frosted, dark }),
  }, controls);
  let disposed = false;
  let unlisten: (() => void) | undefined;
  // Re-read native Reduce Transparency on focus, including after visiting OS Settings.
  void getCurrentWindow().onFocusChanged(event => {
    if (event.payload) void appearance.refreshCapabilities();
  }).then(stop => { if (disposed) stop(); else unlisten = stop; }).catch(error => {
    if (!disposed) host.report(`Could not observe window appearance changes: ${String(error)}`, 'focus');
  });
  return {
    reload: appearance.reload,
    dispose() { disposed = true; unlisten?.(); appearance.dispose(); },
  };
}
