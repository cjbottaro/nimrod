import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { AppearanceCapabilities } from './window-appearance';
import { installWindowAppearance, type AppearanceControls, type AppearanceHost } from './window-appearance-controller';
import './window-appearance.css';

interface AppearancePreviewSnapshot { revision: number; opacity: number | null; blur: number | null; }
type PreviewValues = Pick<AppearancePreviewSnapshot, 'opacity' | 'blur'>;

/** A narrow native boundary shared by project, Settings and reference windows. */
export function installNativeWindowAppearance(host: Pick<AppearanceHost, 'read' | 'save' | 'report'>, controls?: AppearanceControls) {
  let disposed = false;
  let remote: AppearancePreviewSnapshot = { revision: -1, opacity: null, blur: null };
  let previewListener: (() => void) | undefined;
  const desired: PreviewValues = { opacity: null, blur: null };
  let sent = JSON.stringify(desired);
  let publishing: Promise<void> | undefined;
  const receivePreview = (next: AppearancePreviewSnapshot) => {
    if (disposed || next.revision <= remote.revision) return;
    remote = next; appearance.reload();
  };
  // One latest-value publisher for both fields. Clearing one committed slider
  // must not clear another slider's active preview. No drag-time file writes.
  const publishPreview = (key: keyof PreviewValues, value: number | null): Promise<void> => {
    desired[key] = value;
    if (!publishing && JSON.stringify(desired) !== sent && !disposed) {
      publishing = (async () => {
        while (!disposed && JSON.stringify(desired) !== sent) {
          const target = { ...desired };
          sent = JSON.stringify(target); // Failed deliveries are not replayed.
          const next = await invoke<AppearancePreviewSnapshot>('preview_window_appearance', {
            ...target, generation: new URLSearchParams(location.search).get('settingsGeneration') ?? '',
          });
          if (disposed) return;
          receivePreview(next); host.report(undefined, 'preview');
        }
      })().finally(() => {
        publishing = undefined;
        if (!disposed && JSON.stringify(desired) !== sent) void publishPreview('opacity', desired.opacity).catch(error => {
          if (!disposed) host.report(`Could not preview window appearance: ${String(error)}`, 'preview');
        });
      });
    }
    return publishing ?? Promise.resolve();
  };
  const appearance = installWindowAppearance(window, document.documentElement, {
    ...host,
    read: () => {
      const value = host.read();
      return { ...value, opacity: remote.opacity ?? value.opacity, blur: remote.blur ?? value.blur };
    },
    previewOpacity: controls ? value => publishPreview('opacity', value) : undefined,
    previewBlur: controls ? value => publishPreview('blur', value) : undefined,
    capabilities: () => invoke<AppearanceCapabilities>('window_appearance_capabilities'),
    apply: (blur, dark, updateTheme) => invoke<AppearanceCapabilities>('apply_window_appearance', { blur, dark, updateTheme }),
    tintTitlebar: color => invoke<void>('tint_window_titlebar', { color }),
  }, controls);
  const previewReady = listen<AppearancePreviewSnapshot>('nimrod-window-appearance-preview', event => receivePreview(event.payload)).then(async stop => {
    if (disposed) { stop(); return; }
    previewListener = stop;
    receivePreview(await invoke<AppearancePreviewSnapshot>('window_appearance_preview_snapshot'));
    if (!disposed) host.report(undefined, 'preview-observer');
  }).catch(error => { if (!disposed) host.report(`Could not observe appearance previews: ${String(error)}`, 'preview-observer'); });
  let unlisten: (() => void) | undefined;
  // Re-read native Reduce Transparency on focus, including after OS Settings.
  void getCurrentWindow().onFocusChanged(event => {
    if (event.payload) void appearance.refreshCapabilities();
  }).then(stop => { if (disposed) stop(); else unlisten = stop; }).catch(error => {
    if (!disposed) host.report(`Could not observe window appearance changes: ${String(error)}`, 'focus');
  });
  return {
    ready: Promise.all([appearance.ready, previewReady]).then(() => {}),
    async settled() {
      await previewReady;
      while (!disposed) {
        const pending = publishing;
        await pending; await appearance.settled();
        if (!publishing || pending === publishing) return;
      }
    },
    diagnostics: appearance.diagnostics,
    reload: appearance.reload,
    dispose() { disposed = true; unlisten?.(); previewListener?.(); appearance.dispose(); },
  };
}
