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

/** Preserve surface hierarchy and converge to the opaque palette, not a 99% style switch.
 * Overlays are composited over an already-tinted parent. Keep modest role-specific
 * density at low opacity, then ease their color contribution to 100% near opaque.
 */
export function windowSurfaceOpacities(opacity: number) {
  const base = opacity / 100;
  const endpoint = base ** 8;
  const blend = (minimum: number) => minimum + (1 - minimum) * endpoint;
  const panel = blend(.25);
  return {
    endpoint, control: blend(.10), panel,
    button: blend(.35), buttonHover: blend(.45), state: blend(.30),
    selection: blend(.45), danger: blend(.45),
    // A fixed-position application strip has no tinted parent beneath it.
    notice: base + (1 - base) * panel,
  };
}

export type TitlebarTint = [number, number, number, number];

/** Theme imports are hex-only; keep the native title bar on the Project-bar recipe. */
export function titlebarTint(color: string, opacity: number): TitlebarTint | undefined {
  if (!/^#[\da-f]{3,4}$|^#[\da-f]{6}([\da-f]{2})?$/i.test(color.trim())) return;
  let hex = color.trim().slice(1);
  if (hex.length <= 4) hex = [...hex].map(channel => channel + channel).join('');
  const channels = [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
  const alpha = hex.length === 8 ? parseInt(hex.slice(6), 16) : 255;
  return [channels[0], channels[1], channels[2], Math.round(alpha * opacity / 100)];
}

export interface AppearanceControls {
  opacity: HTMLInputElement; value: HTMLOutputElement; area: HTMLSelectElement;
  frostGroup: HTMLElement; frosted: HTMLInputElement; hint: HTMLElement;
}
export interface AppearanceHost {
  read(): WindowAppearance;
  save?(patch: Partial<WindowAppearance>): Promise<void>;
  capabilities(): Promise<AppearanceCapabilities>;
  apply(frosted: boolean, dark: boolean | null): Promise<AppearanceCapabilities>;
  tintTitlebar?(color: TitlebarTint): Promise<void>;
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
  let effectWork = Promise.resolve();
  let desiredTint = '', appliedTint = '', tinting = false;
  let failedTint: string | undefined;
  let tintWork = Promise.resolve();
  const current = () => ({ ...host.read(), ...preview });
  const reduceTransparency = () => !!capabilities?.reducedTransparency || !!reduced?.matches;
  const effect = () => {
    const value = current();
    const frosted = !!capabilities?.frost && !reduceTransparency() && value.opacity < 100 && value.frosted;
    // A system theme must not acquire a native appearance override: that would
    // pin the window's media query and stop following future OS scheme changes.
    const isDark = root.dataset.themeMode ? root.dataset.themeMode === 'dark' : null;
    return JSON.stringify({ frosted, dark: isDark });
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
          const args = JSON.parse(request) as { frosted: boolean; dark: boolean | null };
          capabilities = await host.apply(args.frosted, args.dark);
          if (disposed) return;
          appliedEffect = request; failedEffect = undefined;
          // Appearance changes can rebuild native title chrome; tint it afterward.
          appliedTint = '';
          host.report(undefined, 'native'); paint();
        } catch (error) {
          if (!disposed) { failedEffect = request; host.report(`Could not update the window background: ${String(error)}`, 'native'); }
        }
      }
    } finally { applying = false; }
  }
  async function applyTint() {
    if (tinting || !host.tintTitlebar || disposed) return;
    tinting = true;
    try {
      while (!disposed && desiredTint && desiredTint !== appliedTint && desiredTint !== failedTint) {
        await effectWork; // Native appearance must settle before locating/tinting its title view.
        if (disposed) return;
        const request = desiredTint;
        try {
          await host.tintTitlebar((JSON.parse(request) as { color: TitlebarTint }).color);
          if (disposed) return;
          appliedTint = request; failedTint = undefined; host.report(undefined, 'titlebar');
        } catch (error) {
          if (!disposed) { failedTint = request; host.report(`Could not update the title bar: ${String(error)}`, 'titlebar'); }
        }
      }
    } finally { tinting = false; }
  }
  async function settled() {
    while (!disposed) {
      const effects = effectWork, tint = tintWork;
      await Promise.all([effects, tint]);
      if (effects === effectWork && tint === tintWork && !applying && !tinting) return;
    }
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
    // Non-macOS needs no effect IPC at all, including routine preference/state broadcasts.
    if (capabilities?.frost) {
      desiredEffect = effect();
      if (!applying) effectWork = applyEffect();
    }
    if (capabilities?.platform === 'macos' && host.tintTitlebar) {
      const color = window.getComputedStyle(root).getPropertyValue('--vscode-editor-background').trim();
      const fallback = root.dataset.themeMode === 'light' || !root.dataset.themeMode && !dark?.matches ? '#f7f9f8' : '#151c20';
      const tint = titlebarTint(color || fallback, enabled ? value.opacity : 100);
      if (tint) {
        // Include native appearance identity: an older same-colour reply must
        // not suppress repainting a title view rebuilt by a newer appearance.
        desiredTint = JSON.stringify({ color: tint, appearance: desiredEffect });
        if (!tinting) tintWork = applyTint();
      }
    }
  }
  async function refreshCapabilities() {
    const generation = ++capabilityGeneration;
    try {
      const next = await host.capabilities();
      if (disposed || generation !== capabilityGeneration) return;
      capabilities = next;
      // AppKit may rebuild/redraw title chrome on activation/full-screen changes.
      // Reapply successful tint on explicit native refresh, not on state broadcasts.
      if (appliedTint) appliedTint = '';
      host.report(undefined, 'capabilities'); paint();
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
  // Theme previews and title-bar colors are window-local.
  const observer = new (window as Window & typeof globalThis).MutationObserver(paint);
  // Styles carry same-mode theme previews and system-scheme palette changes.
  // Our own writes cause at most one no-op observer pass (paint signature/tint cache).
  observer.observe(root, { attributes: true, attributeFilter: ['data-theme-mode', 'style'] });
  paint();
  const ready = refreshCapabilities().then(settled);
  return {
    ready, settled, reload: paint, refreshCapabilities,
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
