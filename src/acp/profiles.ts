export interface AcpProfile { readonly id: string; readonly name: string; readonly command: string; readonly args: readonly string[]; readonly env: Readonly<Record<string, string>>; }
/** Explicit launch configuration, never a shell command string or cwd override. */
export function parseAcpProfile(value: unknown): AcpProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ACP profile must be an object.');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !['id', 'name', 'command', 'args', 'env'].includes(key)) || typeof record.name !== 'string' || !record.name.trim() || record.name.length > 128 || typeof record.command !== 'string' || !record.command || record.command.length > 4096 || record.command.includes('\0') || !Array.isArray(record.args) || record.args.length > 128 || record.args.some(arg => typeof arg !== 'string' || arg.length > 8192 || arg.includes('\0'))) throw new Error('ACP profile requires name, command and a literal args array.');
  const env = record.env ?? {};
  if (!env || typeof env !== 'object' || Array.isArray(env) || Object.keys(env).length > 64 || Object.entries(env).some(([key, value]) => !key || /[=\0]/.test(key) || key.length > 128 || typeof value !== 'string' || value.length > 8192 || value.includes('\0'))) throw new Error('Invalid ACP environment.');
  if (record.id !== undefined && (typeof record.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(record.id))) throw new Error('Invalid ACP profile ID.');
  return Object.freeze({ id: typeof record.id === 'string' ? record.id : crypto.randomUUID(), name: record.name.trim(), command: record.command, args: Object.freeze([...record.args] as string[]), env: Object.freeze({ ...env } as Record<string, string>) });
}
