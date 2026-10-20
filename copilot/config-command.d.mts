export interface ConfigCommandChoice { name: string; description: string }
export interface ConfigValueChoice { id: string; label: string; detail?: string }
export interface ConfigCommand {
  name: string;
  aliases: string[];
  kind: 'client';
  allowDuringAgentExecution: boolean;
  description: string;
  input: { hint: string; valueHint: string; choices: ConfigCommandChoice[] };
  configValues: Record<string, ConfigValueChoice[]>;
}
export function configCommand(client: unknown): Promise<ConfigCommand>;
export function applyConfigCommand(client: unknown, input: unknown): Promise<{ kind: 'text'; text: string; markdown: false }>;
