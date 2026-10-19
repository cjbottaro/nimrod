import { buttonSurface, primaryButtonSurfaces, buttonDensity, buttonUnderlayCredit, tintedButtonDensity } from './button-surfaces';
import { updateRangeFill } from './range-input';
import { appliedTheme, subscribeAppliedTheme } from './themes/applied-theme';
import { installAppearanceEffects, type NativeAppearanceHost } from './window-appearance-effects';
import { modalDepthBlurRadius, titlebarTint, windowSurfaceOpacities, type AppearanceCapabilities, type WindowAppearance } from './window-appearance';

export interface AppearanceControls {
  opacity: HTMLInputElement; value: HTMLOutputElement;
  blurGroup: HTMLElement; blur: HTMLInputElement; blurValue: HTMLOutputElement; hint: HTMLElement;
}
export interface AppearanceHost extends NativeAppearanceHost {
  read(): WindowAppearance;
  save?(patch: Partial<WindowAppearance>): Promise<void>;
  previewOpacity?(opacity: number | null): Promise<void>;
  previewBlur?(blur: number | null): Promise<void>;
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
  let background = '', foreground = '';
  let primary: ReturnType<typeof buttonSurface>, hover: ReturnType<typeof buttonSurface>, danger: ReturnType<typeof buttonSurface>;
  let secondary: ReturnType<typeof buttonSurface>, secondaryHover: ReturnType<typeof buttonSurface>;
  let credits: Record<string, Record<string, number>> = {};
  let paintSignature: string | undefined;
  const current = () => ({ ...host.read(), ...preview });
  const reduceTransparency = () => !!capabilities?.reducedTransparency || !!reduced?.matches;
  const effects = installAppearanceEffects(host, next => { if (!disposed) { capabilities = next; paint(); } });
  function readPalette() {
    const fallback = theme.mode === 'light' || !theme.mode && !dark?.matches ? '#f7f9f8' : '#151c20';
    const style = window.getComputedStyle(root);
    const color = (key: string) => style.getPropertyValue('--vscode-' + key).trim();
    background = theme.background ?? (color('editor-background') || fallback);
    foreground = color('foreground') || (fallback === '#f7f9f8' ? '#182126' : '#d8e0e3');
    const pair = primaryButtonSurfaces(color('button-foreground'), color('button-background'), color('button-hoverBackground'));
    primary = pair.normal; hover = pair.hover;
    const secondaryPair = primaryButtonSurfaces(color('button-secondaryForeground'), color('button-secondaryBackground'), color('button-secondaryHoverBackground'));
    secondary = secondaryPair.normal; secondaryHover = secondaryPair.hover;
    danger = buttonSurface(background, color('errorForeground'));
    const roles = { button: primary, 'button-hover': hover, secondary, 'secondary-hover': secondaryHover, danger };
    credits = Object.fromEntries([['sidebar', color('editorWidget-background')], ['project-bar', background], ['modal', color('editorWidget-background')]].map(([context, underlay]) =>
      [context, Object.fromEntries(Object.entries(roles).map(([role, surface]) => [role, buttonUnderlayCredit(surface, underlay)]))]));
    for (const [role, surface] of [['primary', primary], ['primary-hover', hover], ['secondary', secondary], ['secondary-hover', secondaryHover], ['danger', danger]] as const) {
      for (const key of ['foreground', 'background'] as const) {
        const property = role === 'danger' ? `--nimrod-danger-${key === 'foreground' ? 'text' : 'fill'}` : `--nimrod-${role}-${key}`;
        if (surface) root.style.setProperty(property, surface[key]); else root.style.removeProperty(property);
      }
    }
  }
  function paint() {
    if (disposed) return;
    const value = current();
    const enabled = !!capabilities?.transparency && !reduceTransparency() && value.opacity < 100;
    const blur = !!capabilities?.frost && enabled ? value.blur : 0;
    const signature = JSON.stringify([value, enabled, capabilities, !!reduced?.matches, primary, hover, secondary, secondaryHover, danger, credits]);
    if (signature !== paintSignature) {
      paintSignature = signature;
      root.dataset.translucency = enabled ? 'window' : 'off';
      root.style.setProperty('--nimrod-background-opacity', `${value.opacity}%`);
      root.style.setProperty('--nimrod-depth-blur-radius', `${modalDepthBlurRadius(blur)}px`);
      const surfaces = windowSurfaceOpacities(value.opacity);
      const properties = {
        '--nimrod-control-overlay-opacity': surfaces.control,
        '--nimrod-secondary-opacity': buttonDensity(secondary?.minimum ?? 0, surfaces.endpoint, .10),
        '--nimrod-secondary-hover-opacity': buttonDensity(Math.max(secondary?.minimum ?? 0, secondaryHover?.minimum ?? 0), surfaces.endpoint, .30),
        '--nimrod-panel-overlay-opacity': surfaces.panel,
        '--nimrod-modal-opacity': surfaces.modal,
        '--nimrod-modal-backdrop-opacity': surfaces.modalBackdrop,
        '--nimrod-button-opacity': buttonDensity(primary?.minimum ?? 0, surfaces.endpoint, .35),
        '--nimrod-button-hover-opacity': buttonDensity(Math.max(primary?.minimum ?? 0, hover?.minimum ?? 0), surfaces.endpoint, .45),
        '--nimrod-state-opacity': surfaces.state,
        '--nimrod-selection-opacity': surfaces.selection,
        '--nimrod-danger-opacity': buttonDensity(danger?.minimum ?? 0, surfaces.endpoint, .45),
        '--nimrod-notice-opacity': surfaces.notice,
      };
      const densities = [
        ['button', .35], ['button-hover', .45], ['secondary', .10], ['secondary-hover', .30], ['danger', .45],
      ] as const;
      for (const [context, roles] of Object.entries(credits)) {
        const parentOpacity = context === 'modal' ? surfaces.modal : value.opacity / 100;
        const contextual: Record<string, number> = {};
        for (const [role, minimum] of densities) {
          const density = properties[`--nimrod-${role}-opacity` as keyof typeof properties];
          contextual[role] = tintedButtonDensity(density, parentOpacity, roles[role], minimum, surfaces.endpoint);
        }
        contextual['button-hover'] = Math.max(contextual.button, contextual['button-hover']);
        contextual['secondary-hover'] = Math.max(contextual.secondary, contextual['secondary-hover']);
        for (const [role, alpha] of Object.entries(contextual)) root.style.setProperty(`--nimrod-${context}-${role}-opacity`, `${Number((alpha * 100).toFixed(4))}%`);
      }
      for (const [key, alpha] of Object.entries(properties)) root.style.setProperty(key, `${Number((alpha * 100).toFixed(4))}%`);
      if (controls) {
        controls.opacity.value = String(value.opacity);
        controls.value.value = value.opacity === 100 ? '100% · Opaque' : `${value.opacity}%`;
        controls.blur.value = String(value.blur);
        updateRangeFill(controls.opacity); updateRangeFill(controls.blur);
        controls.blurValue.value = value.blur === 0 ? '0 · Off' : String(value.blur);
        controls.opacity.disabled = !capabilities?.transparency;
        controls.blurGroup.hidden = !capabilities?.frost;
        controls.blur.disabled = !capabilities?.frost;
        controls.hint.textContent = !capabilities ? 'Reading window appearance support…'
          : !capabilities.transparency ? 'Translucency is not available on this platform.'
          : reduceTransparency() ? 'Reduce Transparency is enabled by the system. Windows remain opaque; your preferences are retained.'
          : capabilities.platform === 'linux' ? 'Configure background blur in your desktop compositor. Support depends on your desktop setup.'
          : capabilities.frost ? 'Opacity controls the theme tint; blur independently softens the desktop behind the window. At 0 blur it stays sharp. At 100% opacity the background is opaque.'
          : 'Opacity controls the theme tint. Adjustable background blur is unavailable on this macOS version; plain transparency is still available.';
      }
    }
    const nativeChrome = capabilities?.platform === 'macos' || capabilities?.platform === 'linux';
    const tint = nativeChrome && host.tintTitlebar ? titlebarTint(background, enabled ? value.opacity : 100) : undefined;
    effects.request({ material: capabilities?.platform === 'macos' ? { blur, dark: theme.mode === null ? null : theme.mode === 'dark' } : undefined,
      tint, foreground: capabilities?.platform === 'linux' ? titlebarTint(foreground, 100) : undefined });
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
    const publish = key === 'opacity' ? host.previewOpacity : key === 'blur' ? host.previewBlur : undefined;
    if (publish) void publish(value as number).catch(error => {
      if (!disposed) host.report(`Could not preview window ${key}: ${String(error)}`, 'preview');
    });
    if (!commit || !host.save) return;
    const patch: Partial<WindowAppearance> = {}; patch[key] = value;
    void host.save(patch).then(() => {
      if (!disposed && versions.get(key) === version) { delete preview[key]; host.report(undefined, `save:${key}`); paint(); clearPreview(key); }
    }).catch(error => {
      if (disposed) return;
      if (versions.get(key) === version) { delete preview[key]; paint(); clearPreview(key); }
      host.report(`Could not save window appearance: ${String(error)}`, `save:${key}`);
    });
  }
  function clearPreview(key: keyof WindowAppearance) {
    const publish = key === 'opacity' ? host.previewOpacity : key === 'blur' ? host.previewBlur : undefined;
    if (publish) void publish(null).catch(error => {
      if (!disposed) host.report(`Could not finish window ${key} preview: ${String(error)}`, 'preview');
    });
  }
  const previewOpacity = () => edit('opacity', Number(controls!.opacity.value), false);
  const saveOpacity = () => edit('opacity', Number(controls!.opacity.value), true);
  const previewBlur = () => edit('blur', Number(controls!.blur.value), false);
  const saveBlur = () => edit('blur', Number(controls!.blur.value), true);
  const systemSchemeChanged = () => { if (theme.mode === null) readPalette(); paint(); };
  controls?.opacity.addEventListener('input', previewOpacity);
  controls?.opacity.addEventListener('change', saveOpacity);
  controls?.blur.addEventListener('input', previewBlur);
  controls?.blur.addEventListener('change', saveBlur);
  dark?.addEventListener('change', systemSchemeChanged); reduced?.addEventListener('change', paint);
  const unsubscribeTheme = subscribeAppliedTheme(root, next => { theme = next; readPalette(); paint(); });
  readPalette(); paint(); void refreshCapabilities();
  const ready = settled();
  return {
    ready, settled, reload: paint, refreshCapabilities,
    diagnostics() {
      const value = current();
      const enabled = !!capabilities?.transparency && !reduceTransparency() && value.opacity < 100;
      return { effectiveArea: enabled ? 'window' as const : 'off' as const,
        effectiveBackgroundOpacity: enabled ? value.opacity : 100,
        reducedTransparency: reduceTransparency(), frostSupported: !!capabilities?.frost };
    },
    dispose() {
      disposed = true; ++capabilityGeneration; unsubscribeTheme(); effects.dispose();
      dark?.removeEventListener('change', systemSchemeChanged); reduced?.removeEventListener('change', paint);
      controls?.opacity.removeEventListener('input', previewOpacity);
      controls?.opacity.removeEventListener('change', saveOpacity);
      controls?.blur.removeEventListener('input', previewBlur);
      controls?.blur.removeEventListener('change', saveBlur);
    },
  };
}
