import type { SlashCommand } from '../pi/slash-completion';
import { record } from './connection';

export interface CopilotCommand extends SlashCommand {
  kind: 'builtin' | 'skill' | 'client';
  aliases: string[];
  allowDuringAgentExecution: boolean;
  configValues?: Readonly<Record<string, readonly CommandChoice[]>>;
}
const name = (value: unknown): value is string => typeof value === 'string' && !!value && !/[\s\u0000-\u001f/]/.test(value);
function configValueMap(value: unknown): Readonly<Record<string, readonly CommandChoice[]>> | undefined {
  if (!record(value)) return;
  const result: Record<string, CommandChoice[]> = {};
  for (const [key, choices] of Object.entries(value)) {
    if (!Array.isArray(choices)) return;
    result[key] = choices.map(choice => {
      if (!record(choice) || typeof choice.id !== 'string' || !choice.id || typeof choice.label !== 'string'
        || choice.detail !== undefined && typeof choice.detail !== 'string') throw new Error('Copilot returned invalid config choices.');
      return { id: choice.id, label: choice.label, detail: choice.detail };
    });
  }
  return result;
}

/** Released SDK metadata only; never infer a grammar from descriptions. */
export function copilotCommands(raw: unknown): CopilotCommand[] {
  const commands: CopilotCommand[] = [], seen = new Set<string>();
  if (!Array.isArray(raw)) return commands;
  for (const value of raw) {
    if (!record(value) || !name(value.name) || seen.has(value.name.toLowerCase()) || !['builtin', 'skill', 'client'].includes(String(value.kind))) continue;
    seen.add(value.name.toLowerCase());
    const input = record(value.input) && typeof value.input.hint === 'string' ? {
      hint: value.input.hint,
      required: value.input.required === true,
      valueHint: typeof value.input.valueHint === 'string' ? value.input.valueHint : undefined,
      choices: Array.isArray(value.input.choices) ? value.input.choices.filter(record)
        .filter(choice => typeof choice.name === 'string' && !!choice.name && !/[\r\n\u0000]/.test(choice.name))
        .map(choice => ({ name: String(choice.name), description: typeof choice.description === 'string' ? choice.description : '' })) : undefined,
    } : undefined;
    const configValues = configValueMap(value.configValues);
    commands.push({ name: value.name, description: typeof value.description === 'string' ? value.description : 'Copilot command', source: 'Agent',
      kind: value.kind as CopilotCommand['kind'], aliases: Array.isArray(value.aliases) ? value.aliases.filter(name) : [],
      allowDuringAgentExecution: value.allowDuringAgentExecution === true, input, configValues });
  }
  return commands;
}
export function copilotSlashCommands(raw: unknown): SlashCommand[] {
  const commands = copilotCommands(raw), names = new Set(commands.map(command => command.name.toLowerCase()));
  const result: SlashCommand[] = [...commands];
  for (const command of commands) for (const alias of command.aliases) {
    if (names.has(alias.toLowerCase())) continue;
    names.add(alias.toLowerCase()); result.push({ ...command, name: alias, description: `${command.description} (/${command.name})` });
  }
  return result;
}
/** Keep the complete raw argument string, including spaces and newlines. */
export function parseCopilotCommand(text: string): { name: string; input?: string } | undefined {
  const match = /^\/([^\s/]+)(?:[ \t]([\s\S]*))?$/.exec(text.trimStart());
  return match ? { name: match[1], ...(match[2] !== undefined ? { input: match[2] } : {}) } : undefined;
}
export function findCopilotCommand(commands: readonly CopilotCommand[], name: string): CopilotCommand | undefined {
  const lower = name.toLowerCase();
  return commands.find(command => command.name.toLowerCase() === lower)
    ?? commands.find(command => command.aliases.some(alias => alias.toLowerCase() === lower));
}
export function isCopilotModelCommand(command: CopilotCommand): boolean {
  return command.kind === 'builtin' && command.name.toLowerCase() === 'model';
}
export function isCopilotSkillsInfo(command: CopilotCommand, input: string | undefined): boolean {
  return command.kind === 'builtin' && command.name.toLowerCase() === 'skills' && input?.trim().toLowerCase() === 'info';
}
export function isCopilotSessionRename(command: CopilotCommand, input: string | undefined): boolean {
  return command.kind === 'builtin' && command.name.toLowerCase() === 'session' && input?.trim().toLowerCase() === 'rename';
}
export function isCopilotConfig(command: CopilotCommand): boolean {
  return command.kind === 'client' && command.name.toLowerCase() === 'config';
}
export interface CommandChoice { id: string; label: string; detail?: string; }

/** Validate result-owned choices; never turn arbitrary result text into an executable choice. */
export function commandChoices(value: unknown): CommandChoice[] {
  if (!Array.isArray(value)) throw new Error('Copilot returned invalid command choices.');
  const seen = new Set<string>();
  return value.map(option => {
    if (!record(option) || typeof option.name !== 'string' || !option.name || /[\r\n\u0000]/.test(option.name) || seen.has(option.name)) throw new Error('Copilot returned invalid command choices.');
    seen.add(option.name);
    return { id: option.name, label: option.name, detail: [typeof option.group === 'string' ? option.group : '', typeof option.description === 'string' ? option.description : ''].filter(Boolean).join(' · ') };
  });
}

export function copilotSkillChoices(value: unknown): CommandChoice[] {
  if (!record(value) || !Array.isArray(value.skills)) throw new Error('Copilot returned an invalid skill catalog.');
  const seen = new Set<string>();
  return value.skills.map(skill => {
    if (!record(skill) || typeof skill.name !== 'string' || !skill.name || /[\r\n\u0000]/.test(skill.name) || seen.has(skill.name)
      || typeof skill.description !== 'string' || typeof skill.enabled !== 'boolean') throw new Error('Copilot returned an invalid skill catalog.');
    seen.add(skill.name);
    return { id: skill.name, label: skill.name, detail: `${skill.enabled ? '' : 'Disabled · '}${skill.description}` };
  });
}
