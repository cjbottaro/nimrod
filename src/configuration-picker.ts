import type { SessionConfiguration } from './session-configuration';

/** Shared picker mechanics; ownership validation belongs to its initiating shell/session. */
export async function pickConfiguration(configuration: SessionConfiguration, setting: string,
  choose: (labels: string[], current?: string) => Promise<string | undefined>, valid: () => boolean = () => true): Promise<void> {
  const choices = await configuration.choices(setting);
  if (!valid()) return;
  if (!choices.length) throw new Error('This session did not report any choices for that setting.');
  const labels = choices.map((choice, index) => `${index + 1}. ${choice.label}`);
  const selected = await choose(labels, labels[choices.findIndex(choice => choice.value === configuration.get(setting))]);
  if (!valid() || selected === undefined) return;
  const choice = choices[labels.indexOf(selected)];
  if (!choice) throw new Error('This configuration choice is no longer available.');
  configuration.set(setting, choice);
}
