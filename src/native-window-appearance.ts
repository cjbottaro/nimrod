import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { AppearanceCapabilities } from './window-appearance';
import { installWindowAppearance, type AppearanceControls, type AppearanceHost } from './window-appearance-controller';
import './window-appearance.css';

interface OpacityPreviewSnapshot { revision: number; opacity: number | null; }

/** A narrow native boundary shared by project, Settings and reference windows. */
export function installNativeWindowAppearance(host: Pick<AppearanceHost, 'read' | 'save' | 'report'>, controls?: AppearanceControls) {
  let disposed = false;
  let remote: OpacityPreviewSnapshot = { revision: -1, opacity: null };
  let previewListener: (() => void) | undefined;
  let desired: number | null | undefined, sent: number | null | undefined;
  let publishing: Promise<void> | undefined;
  const receivePreview = (next: OpacityPreviewSnapshot) => {
    if (disposed || next.revision <= remote.revision) return;
    remote = next; appearance.reload();
  };
  // One latest-value publisher prevents slow IPC from queuing every slider tick.
  // Disposal suppresses remaining work; native destruction clears the preview.
  const publishPreview = (opacity: number | null): Promise<void> => {
    desired = opacity;
    if (!publishing && desired !== sent && !disposed) {
      publishing = (async () => {
        while (!disposed && desired !== sent) {
          const target = desired!;
          sent = target; // A failed delivery is not automatically replayed.
          const next = await invoke<OpacityPreviewSnapshot>('preview_window_opacity', {
            opacity: target, generation: new URLSearchParams(location.search).get('settingsGeneration') ?? '',
          });
          if (disposed) return;
          receivePreview(next); host.report(undefined, 'preview');
        }
      })().finally(() => {
        publishing = undefined;
        if (!disposed && desired !== sent) void publishPreview(desired!).catch(error => {
          if (!disposed) host.report(`Could not preview window opacity: ${String(error)}`, 'preview');
        });
      });
    }
    return publishing ?? Promise.resolve();
  };
  const appearance = installWindowAppearance(window, document.documentElement, {
    ...host,
    read: () => { const value = host.read(); return remote.opacity === null ? value : { ...value, opacity: remote.opacity }; },
    previewOpacity: controls ? publishPreview : undefined,
    capabilities: () => invoke<AppearanceCapabilities>('window_appearance_capabilities'),
    apply: (frosted, dark) => invoke<AppearanceCapabilities>('apply_window_appearance', { frosted, dark }),
    tintTitlebar: color => invoke<void>('tint_window_titlebar', { color }),
  }, controls);
  const previewReady = listen<OpacityPreviewSnapshot>('nimrod-window-opacity-preview', event => receivePreview(event.payload)).then(async stop => {
    if (disposed) { stop(); return; }
    previewListener = stop;
    receivePreview(await invoke<OpacityPreviewSnapshot>('window_opacity_preview_snapshot'));
    if (!disposed) host.report(undefined, 'preview-observer');
  }).catch(error => { if (!disposed) host.report(`Could not observe opacity previews: ${String(error)}`, 'preview-observer'); });
  let unlisten: (() => void) | undefined;
  // Re-read native Reduce Transparency on focus, including after visiting OS Settings.
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
    reload: appearance.reload,
    dispose() { disposed = true; unlisten?.(); previewListener?.(); appearance.dispose(); },
  };
}
