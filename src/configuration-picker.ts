import type { ConfigurationChoice, SessionConfiguration } from './session-configuration';

/** Shared picker mechanics; ownership validation belongs to its initiating shell/session. */
export async function pickConfiguration(configuration: SessionConfiguration, setting: string,
  choose: (choices: readonly ConfigurationChoice[], current?: string) => Promise<string | undefined>, valid: () => boolean = () => true): Promise<void> {
  const choices = await configuration.choices(setting);
  if (!valid()) return;
  if (!choices.length) throw new Error('This session did not report any choices for that setting.');
  const selected = await choose(choices, configuration.get(setting));
  if (!valid() || selected === undefined) return;
  const choice = choices.find(candidate => candidate.value === selected);
  if (!choice) throw new Error('This configuration choice is no longer available.');
  configuration.set(setting, choice);
}
