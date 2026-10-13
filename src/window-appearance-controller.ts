import { appliedTheme, subscribeAppliedTheme } from './themes/applied-theme';
import { installAppearanceEffects, type NativeAppearanceHost } from './window-appearance-effects';
import { titlebarTint, windowSurfaceOpacities, type AppearanceCapabilities, type WindowAppearance } from './window-appearance';

export interface AppearanceControls {
  opacity: HTMLInputElement; value: HTMLOutputElement; area: HTMLSelectElement;
  frostGroup: HTMLElement; frosted: HTMLInputElement; hint: HTMLElement;
}
export interface AppearanceHost extends NativeAppearanceHost {
  read(): WindowAppearance;
  save?(patch: Partial<WindowAppearance>): Promise<void>;
  capabilities(): Promise<AppearanceCapabilities>;
}

/** Window-local paint/controls policy; native ordering is owned by the effect pipeline. */
export function installWindowAppearance(window: Window, root: HTMLElement, host: AppearanceHost, controls?: AppearanceControls) {
  let disposed = false;
  let capabilities: AppearanceCapabilities | undefined;
  let capabilityGeneration = 0;
  let capabilityWork = Promise.resolve();
  const preview: Partial<WindowAppearance> = {};
  const versions = new Map<keyof WindowAppearance, number>();
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)');
  const reduced = window.matchMedia?.('(prefers-reduced-transparency: reduce)');
  let theme = appliedTheme(root);
  let background = '';
  let paintSignature: string | undefined;
  const current = () => ({ ...host.read(), ...preview });
  const reduceTransparency = () => !!capabilities?.reducedTransparency || !!reduced?.matches;
  const effects = installAppearanceEffects(host, next => { if (!disposed) { capabilities = next; paint(); } });
  function readBackground() {
    const fallback = theme.mode === 'light' || !theme.mode && !dark?.matches ? '#f7f9f8' : '#151c20';
    background = theme.background ?? (window.getComputedStyle(root).getPropertyValue('--vscode-editor-background').trim() || fallback);
  }
  function paint() {
    if (disposed) return;
    const value = current();
    const enabled = !!capabilities?.transparency && !reduceTransparency() && value.opacity < 100;
    const signature = JSON.stringify([value, enabled, capabilities, !!reduced?.matches]);
    if (signature !== paintSignature) {
      paintSignature = signature;
      root.dataset.translucency = enabled ? value.area : 'off';
      root.style.setProperty('--nimrod-background-opacity', `${value.opacity}%`);
      const surfaces = windowSurfaceOpacities(value.opacity);
      const properties = {
        '--nimrod-control-overlay-opacity': surfaces.control,
        '--nimrod-panel-overlay-opacity': surfaces.panel,
        '--nimrod-button-opacity': surfaces.button,
        '--nimrod-button-hover-opacity': surfaces.buttonHover,
        '--nimrod-state-opacity': surfaces.state,
        '--nimrod-selection-opacity': surfaces.selection,
        '--nimrod-danger-opacity': surfaces.danger,
        '--nimrod-notice-opacity': surfaces.notice,
        '--nimrod-opaque-color-weight': surfaces.endpoint,
      };
      for (const [key, alpha] of Object.entries(properties)) root.style.setProperty(key, `${Number((alpha * 100).toFixed(4))}%`);
      if (controls) {
        controls.opacity.value = String(value.opacity);
        controls.value.value = value.opacity === 100 ? '100% · Opaque' : `${value.opacity}%`;
        controls.area.value = value.area; controls.frosted.checked = value.frosted;
        controls.opacity.disabled = !capabilities?.transparency;
        controls.area.disabled = !capabilities?.transparency;
        controls.frostGroup.hidden = !capabilities?.frost;
        controls.frosted.disabled = !capabilities?.frost;
        controls.hint.textContent = !capabilities ? 'Reading window appearance support…'
          : !capabilities.transparency ? 'Translucency is not available on this platform.'
          : reduceTransparency() ? 'Reduce Transparency is enabled by the system. Windows remain opaque; your preferences are retained.'
          : capabilities.platform === 'linux' ? 'Configure background blur in your desktop compositor. Support depends on your desktop setup.'
          : 'Lower opacity reveals more of the desktop. Frosted background uses macOS blur; text stays crisp. At 100%, the background is opaque.';
      }
    }
    const frosted = !!capabilities?.frost && !reduceTransparency() && value.opacity < 100 && value.frosted;
    const tint = capabilities?.platform === 'macos' && host.tintTitlebar ? titlebarTint(background, enabled ? value.opacity : 100) : undefined;
    effects.request({ material: capabilities?.frost ? { frosted, dark: theme.mode === null ? null : theme.mode === 'dark' } : undefined, tint });
  }
  function refreshCapabilities(): Promise<void> {
    const generation = ++capabilityGeneration;
    capabilityWork = (async () => {
      try {
        const next = await host.capabilities();
        if (disposed || generation !== capabilityGeneration) return;
        capabilities = next; host.report(undefined, 'capabilities'); paint(); effects.refreshTint();
      } catch (error) {
        if (!disposed && generation === capabilityGeneration) host.report(`Could not read window appearance support: ${String(error)}`, 'capabilities');
      }
    })();
    return capabilityWork;
  }
  async function settled() {
    while (!disposed) {
      const capabilities = capabilityWork;
      await capabilities; await effects.settled();
      if (capabilities === capabilityWork) return;
    }
  }
  function edit<K extends keyof WindowAppearance>(key: K, value: WindowAppearance[K], commit: boolean) {
    preview[key] = value;
    const version = (versions.get(key) ?? 0) + 1; versions.set(key, version);
    paint();
    if (!commit || !host.save) return;
    const patch: Partial<WindowAppearance> = {}; patch[key] = value;
    void host.save(patch).then(() => {
      if (!disposed && versions.get(key) === version) { delete preview[key]; host.report(undefined, `save:${key}`); paint(); }
    }).catch(error => {
      if (disposed) return;
      if (versions.get(key) === version) { delete preview[key]; paint(); }
      host.report(`Could not save window appearance: ${String(error)}`, `save:${key}`);
    });
  }
  const previewOpacity = () => edit('opacity', Number(controls!.opacity.value), false);
  const saveOpacity = () => edit('opacity', Number(controls!.opacity.value), true);
  const saveArea = () => edit('area', controls!.area.value as WindowAppearance['area'], true);
  const saveFrost = () => edit('frosted', controls!.frosted.checked, true);
  const systemSchemeChanged = () => { if (theme.mode === null) readBackground(); paint(); };
  controls?.opacity.addEventListener('input', previewOpacity);
  controls?.opacity.addEventListener('change', saveOpacity);
  controls?.area.addEventListener('change', saveArea);
  controls?.frosted.addEventListener('change', saveFrost);
  dark?.addEventListener('change', systemSchemeChanged); reduced?.addEventListener('change', paint);
  const unsubscribeTheme = subscribeAppliedTheme(root, next => { theme = next; readBackground(); paint(); });
  readBackground(); paint(); void refreshCapabilities();
  const ready = settled();
  return {
    ready, settled, reload: paint, refreshCapabilities,
    dispose() {
      disposed = true; ++capabilityGeneration; unsubscribeTheme(); effects.dispose();
      dark?.removeEventListener('change', systemSchemeChanged); reduced?.removeEventListener('change', paint);
      controls?.opacity.removeEventListener('input', previewOpacity);
      controls?.opacity.removeEventListener('change', saveOpacity);
      controls?.area.removeEventListener('change', saveArea);
      controls?.frosted.removeEventListener('change', saveFrost);
    },
  };
}
