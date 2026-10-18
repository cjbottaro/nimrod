import { installFontPicker, type InstalledFont } from './font-picker';
import { applyTypography, DEFAULT_TYPOGRAPHY, MAX_FONT_SIZE, MIN_FONT_SIZE, type Typography } from './typography';

export function installTypography(root: HTMLElement, host: {
  read(): Typography;
  save(values: Partial<Typography>): Promise<void>;
  reset(): Promise<void>;
  fonts(): Promise<InstalledFont[]>;
  report(cause: string, message?: string): void;
}, controls = false) {
  const doc = root.ownerDocument, realm = doc.defaultView as Window & typeof globalThis;
  const controller = new realm.AbortController(), signal = controller.signal;
  const preview: Partial<Typography> = {}, versions = new Map<keyof Typography, number>();
  const editing = new Set<string>();
  let disposed = false;
  const required = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T;
  const current = (): Typography => ({ ...host.read(), ...preview });
  function reload() {
    if (disposed) return;
    const value = current();
    applyTypography(root, value);
    if (!controls) return;
    for (const kind of ['conversation', 'monospace'] as const) {
      const family = value[`${kind}Font`], size = value[`${kind}Size`];
      const button = required<HTMLButtonElement>(`${kind}-font`);
      button.textContent = `${family || 'System default'} ▾`;
      button.title = family || 'System default';
      const input = required<HTMLInputElement>(`${kind}-font-size`);
      if (!editing.has(kind)) input.value = String(size);
      required<HTMLButtonElement>(`${kind}-font-smaller`).disabled = size <= MIN_FONT_SIZE;
      required<HTMLButtonElement>(`${kind}-font-larger`).disabled = size >= MAX_FONT_SIZE;
    }
  }
  function edit(values: Partial<Typography>, reset = false) {
    const fields = Object.keys(values) as (keyof Typography)[];
    const savedVersions = new Map(fields.map(key => [key, (versions.get(key) ?? 0) + 1]));
    for (const [key, version] of savedVersions) versions.set(key, version);
    Object.assign(preview, values); reload();
    const cause = reset ? 'reset' : fields.join(',');
    void (reset ? host.reset() : host.save(values)).then(() => {
      if (!disposed && fields.every(key => versions.get(key) === savedVersions.get(key))) host.report(cause);
    }).catch(error => {
      if (!disposed) host.report(cause, `Could not save typography: ${String(error)}`);
    }).finally(() => {
      for (const key of fields) if (versions.get(key) === savedVersions.get(key)) delete preview[key];
      reload();
    });
  }
  const picker = controls ? installFontPicker(doc, { fonts: host.fonts, report: message => host.report('fonts', message) }) : undefined;
  if (controls) {
    for (const kind of ['conversation', 'monospace'] as const) {
      const fontKey = `${kind}Font` as const, sizeKey = `${kind}Size` as const;
      const button = required<HTMLButtonElement>(`${kind}-font`);
      button.addEventListener('click', () => picker!.open({
        monospace: kind === 'monospace', current: current()[fontKey], opener: button,
        select: family => edit({ [fontKey]: family }),
      }), { signal });
      const input = required<HTMLInputElement>(`${kind}-font-size`);
      input.setAttribute('aria-label', `${kind === 'conversation' ? 'Conversation' : 'Monospace'} font size in pixels`);
      input.addEventListener('input', () => {
        editing.add(kind);
        if (input.validity.valid && Number.isInteger(input.valueAsNumber)) {
          preview[sizeKey] = input.valueAsNumber;
          versions.set(sizeKey, (versions.get(sizeKey) ?? 0) + 1);
          reload();
        }
      }, { signal });
      input.addEventListener('change', () => {
        editing.delete(kind);
        if (!input.validity.valid || !Number.isInteger(input.valueAsNumber)) {
          delete preview[sizeKey]; reload();
          host.report(sizeKey, `Font size must be a whole number from ${MIN_FONT_SIZE} to ${MAX_FONT_SIZE} pixels.`);
          return;
        }
        edit({ [sizeKey]: input.valueAsNumber });
      }, { signal });
      for (const [suffix, delta] of [['smaller', -1], ['larger', 1]] as const) {
        required(`${kind}-font-${suffix}`).addEventListener('click', () => {
          editing.delete(kind);
          edit({ [sizeKey]: Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, current()[sizeKey] + delta)) });
        }, { signal });
      }
    }
    required('typography-reset').addEventListener('click', () => {
      editing.clear(); edit({ ...DEFAULT_TYPOGRAPHY }, true);
    }, { signal });
  }
  reload();
  return { reload, dispose() { disposed = true; controller.abort(); picker?.dispose(); } };
}
