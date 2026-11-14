import type { installCommandPalette } from './command-palette';
import { ZOOM_LEVELS } from './zoom';

export interface SettingsChoice { id: string; label: string; detail?: string; }
export type ChooseSetting = (heading: string, choices: readonly SettingsChoice[], current: string) => Promise<string | undefined>;
export const SETTINGS_CHOICES = {
  'default-harness': { heading: 'Change default harness', choices: [] as SettingsChoice[] },
  'zoom-level': { heading: 'Change zoom', choices: ZOOM_LEVELS.map(value => ({ id: String(value), label: `${value}%` })) },
  'modal-animation-style': { heading: 'Change modal animation', choices: [
    { id: 'none', label: 'None' }, { id: 'subtle', label: 'Subtle', detail: 'Default · fade and lift' },
    { id: 'crt', label: 'CRT power-on' }, { id: 'hologram', label: 'Hologram' }, { id: 'pixel', label: 'Pixel dissolve' },
  ] },
  'send-auto-follow': { heading: 'Change auto-follow after sending', choices: [
    { id: 'always', label: 'Always' }, { id: 'whenIdle', label: 'When idle', detail: 'Default · preserve reading position for steering and queued follow-ups' },
    { id: 'never', label: 'Never' },
  ] },
  'autocomplete-accept': { heading: 'Change autocomplete acceptance', choices: [
    { id: 'tab', label: 'Tab only', detail: 'Default · Enter submits' }, { id: 'tabOrEnter', label: 'Tab or Enter' },
  ] },
} satisfies Record<string, { heading: string; choices: SettingsChoice[] }>;
export type SettingChoiceId = keyof typeof SETTINGS_CHOICES;

/** Same window-local selection lifecycle as session choices; no theme preview semantics. */
export function settingsChoicePage(palette: ReturnType<typeof installCommandPalette>, parent: HTMLDialogElement): ChooseSetting {
  return async (heading, choices, current) => {
    const request = palette.startSelection(heading, () => {}, undefined, true, parent);
    if (!request) return;
    const selected = await request.chooseItems(choices, current);
    request.finish();
    return selected;
  };
}

export function installSettingsChoiceControls(doc: Document, host: {
  choose: ChooseSetting;
  harnesses?: readonly SettingsChoice[];
  apply: Record<SettingChoiceId, (value: string) => void>;
  error(id: SettingChoiceId, error: unknown): void;
}) {
  const realm = doc.defaultView as Window & typeof globalThis;
  const controller = new realm.AbortController();
  const controls = (Object.keys(SETTINGS_CHOICES) as SettingChoiceId[]).map(id => {
    const button = doc.getElementById(id) as HTMLButtonElement;
    const value = doc.getElementById(id + '-current')!;
    button.closest('.settings-row')!.classList.add('settings-column-row');
    const definition = id === 'default-harness' ? { ...SETTINGS_CHOICES[id], choices: host.harnesses ?? [] } : SETTINGS_CHOICES[id];
    button.addEventListener('click', () => {
      if (button.disabled || controller.signal.aborted) return;
      void host.choose(definition.heading, definition.choices, button.value).then(selected => {
        if (controller.signal.aborted || selected === undefined || !definition.choices.some(choice => choice.id === selected)) return;
        button.value = selected; paint(); host.apply[id](selected);
      }).catch(error => { if (!controller.signal.aborted) host.error(id, error); });
    }, { signal: controller.signal });
    return { button, value, definition };
  });
  function paint() {
    for (const { button, value, definition } of controls) value.textContent = definition.choices.find(choice => choice.id === button.value)?.label ?? button.value;
  }
  paint();
  return { paint, dispose() { controller.abort(); } };
}
