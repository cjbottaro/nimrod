export interface WindowAppearance {
  opacity: number;
  frosted: boolean;
  area: 'chrome' | 'window';
}
export interface AppearanceCapabilities {
  platform: string;
  transparency: boolean;
  frost: boolean;
  reducedTransparency: boolean;
}
export const DEFAULT_WINDOW_APPEARANCE: WindowAppearance = { opacity: 100, frosted: true, area: 'window' };
export const APPEARANCE_KEYS = {
  opacity: 'appearance.backgroundOpacity', frosted: 'appearance.frostedBackground', area: 'appearance.translucencyArea',
} as const;

export function readWindowAppearance(settings: Record<string, unknown>): WindowAppearance {
  const opacity = settings[APPEARANCE_KEYS.opacity] ?? DEFAULT_WINDOW_APPEARANCE.opacity;
  const frosted = settings[APPEARANCE_KEYS.frosted] ?? DEFAULT_WINDOW_APPEARANCE.frosted;
  const area = settings[APPEARANCE_KEYS.area] ?? DEFAULT_WINDOW_APPEARANCE.area;
  // Explicit nulls are invalid too; missing keys alone use defaults.
  for (const key of Object.values(APPEARANCE_KEYS)) if (settings[key] === null) throw new Error(`${key} cannot be null.`);
  if (typeof opacity !== 'number' || !Number.isInteger(opacity) || opacity < 0 || opacity > 100) throw new Error(`${APPEARANCE_KEYS.opacity} must be an integer from 0 to 100.`);
  if (typeof frosted !== 'boolean') throw new Error(`${APPEARANCE_KEYS.frosted} must be a boolean.`);
  if (area !== 'chrome' && area !== 'window') throw new Error(`${APPEARANCE_KEYS.area} must be chrome or window.`);
  return { opacity, frosted, area };
}

export interface AppearanceControls {
  opacity: HTMLInputElement; value: HTMLOutputElement; area: HTMLSelectElement;
  frostGroup: HTMLElement; frosted: HTMLInputElement; hint: HTMLElement;
}
export interface AppearanceHost {
  read(): WindowAppearance;
  save?(patch: Partial<WindowAppearance>): Promise<void>;
  capabilities(): Promise<AppearanceCapabilities>;
  apply(frosted: boolean, dark: boolean): Promise<AppearanceCapabilities>;
  report(message?: string, cause?: string): void;
}

/** Paint-only preferences: no conversation DOM, layout, focus or scroll mutations. */
export function installWindowAppearance(window: Window, root: HTMLElement, host: AppearanceHost, controls?: AppearanceControls) {
  let disposed = false;
  let capabilities: AppearanceCapabilities | undefined;
  let capabilityGeneration = 0;
  const preview: Partial<WindowAppearance> = {};
  const versions = new Map<keyof WindowAppearance, number>();
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)');
  const reduced = window.matchMedia?.('(prefers-reduced-transparency: reduce)');
  let desiredEffect = '', appliedEffect = '', applying = false;
  let paintSignature: string | undefined;
  let failedEffect: string | undefined;
  const current = () => ({ ...host.read(), ...preview });
  const reduceTransparency = () => !!capabilities?.reducedTransparency || !!reduced?.matches;
  const effect = () => {
    const value = current();
    const frosted = !!capabilities?.frost && !reduceTransparency() && value.opacity < 100 && value.frosted;
    const isDark = root.dataset.themeMode ? root.dataset.themeMode === 'dark' : !!dark?.matches;
    return JSON.stringify({ frosted, dark: frosted && isDark });
  };
  async function applyEffect() {
    if (applying || !capabilities || disposed) return;
    applying = true;
    try {
      // Coalesce changes while native main-thread work is pending. Never let an
      // old theme/save completion become the final native material.
      while (!disposed && desiredEffect !== appliedEffect && desiredEffect !== failedEffect) {
        const request = desiredEffect;
        try {
          const args = JSON.parse(request) as { frosted: boolean; dark: boolean };
          capabilities = await host.apply(args.frosted, args.dark);
          if (disposed) return;
          appliedEffect = request; failedEffect = undefined;
          host.report(undefined, 'native'); paint();
        } catch (error) {
          if (!disposed) { failedEffect = request; host.report(`Could not update the window background: ${String(error)}`, 'native'); }
        }
      }
    } finally { applying = false; }
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
      // Dense controls remain readable even at zero window tint.
      root.style.setProperty('--nimrod-control-opacity', `${Math.max(85, value.opacity)}%`);
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
    // Non-macOS needs no effect IPC at all, including routine preference/state broadcasts.
    if (capabilities?.frost) { desiredEffect = effect(); void applyEffect(); }
  }
  async function refreshCapabilities() {
    const generation = ++capabilityGeneration;
    try {
      const next = await host.capabilities();
      if (disposed || generation !== capabilityGeneration) return;
      capabilities = next; host.report(undefined, 'capabilities'); paint();
    } catch (error) { if (!disposed && generation === capabilityGeneration) host.report(`Could not read window appearance support: ${String(error)}`, 'capabilities'); }
  }
  function edit<K extends keyof WindowAppearance>(key: K, value: WindowAppearance[K], commit: boolean) {
    preview[key] = value;
    const version = (versions.get(key) ?? 0) + 1; versions.set(key, version);
    paint();
    if (!commit || !host.save) return;
    const patch: Partial<WindowAppearance> = {};
    patch[key] = value;
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
  controls?.opacity.addEventListener('input', previewOpacity);
  controls?.opacity.addEventListener('change', saveOpacity);
  controls?.area.addEventListener('change', saveArea);
  controls?.frosted.addEventListener('change', saveFrost);
  dark?.addEventListener('change', paint); reduced?.addEventListener('change', paint);
  // Theme previews are window-local. Observe only theme mode, never our own styles.
  const observer = new (window as Window & typeof globalThis).MutationObserver(paint);
  observer.observe(root, { attributes: true, attributeFilter: ['data-theme-mode'] });
  paint(); void refreshCapabilities();
  return {
    reload: paint, refreshCapabilities,
    dispose() {
      disposed = true; ++capabilityGeneration; observer.disconnect();
      dark?.removeEventListener('change', paint); reduced?.removeEventListener('change', paint);
      controls?.opacity.removeEventListener('input', previewOpacity);
      controls?.opacity.removeEventListener('change', saveOpacity);
      controls?.area.removeEventListener('change', saveArea);
      controls?.frosted.removeEventListener('change', saveFrost);
    },
  };
}
