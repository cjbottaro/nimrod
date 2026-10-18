// Released SDK APIs only. Keep the CLI command's exact policy scope instead of
// approximating /permissions allow-all with a host-side approval callback.
export const permissionArgument = 'allow-all';
/** Shared by frontend recognition and native revalidation; fixtures stay independent. */
export function advertisedPermissionCommand(commands) {
  return commands.find(command => command?.kind === 'builtin' && typeof command.name === 'string' && command.name.toLowerCase() === 'permissions'
    && Array.isArray(command.input?.choices) && command.input.choices.some(choice => choice?.name === permissionArgument));
}
export async function permissionMode(session) {
  const result = await session.rpc.permissions.getMode();
  if (!result || !['manual', 'assisted', 'allow-all'].includes(result.mode)) throw new Error('Copilot returned an invalid permission mode.');
  return result.mode;
}
export async function applyPermissionChange(session, value, working, publishCommands = () => {}) {
  if (value !== permissionArgument) throw new Error('Unsupported Copilot permission change.');
  const { commands } = await session.rpc.commands.list();
  if (!Array.isArray(commands)) throw new Error('Copilot returned an invalid command catalog. Nothing was invoked.');
  publishCommands(commands);
  const command = advertisedPermissionCommand(commands);
  if (!command) throw new Error('Copilot no longer advertises /permissions allow-all. Nothing was invoked.');
  // This explicit deferral proves no native mutation was attempted. Never return
  // it after invoke: an error/uncertain result must not trigger another attempt.
  if (working() && command.allowDuringAgentExecution !== true) return { outcome: 'deferred' };
  const result = await session.rpc.commands.invoke({ name: command.name, input: value });
  if (!result || !['completed', 'text', 'add-timeline-entry'].includes(result.kind)) {
    return { outcome: 'unknown', details: `Copilot returned an unsupported permission-command result. No follow-on command or prompt was sent.\n${JSON.stringify(result, null, 2)}` };
  }
  const text = result.kind === 'text' ? result.text : result.kind === 'completed' ? result.message : result.entry?.text;
  const detail = typeof text === 'string' && text ? `\n${text}` : '';
  try {
    const mode = await permissionMode(session);
    return mode === 'allow-all' ? { outcome: 'applied', mode }
      : { outcome: 'unknown', mode, details: `Copilot completed /permissions allow-all but did not confirm allow-all mode. Nothing was retried.${detail}` };
  } catch (error) {
    return { outcome: 'unknown', details: `Copilot did not confirm the permission policy after the command: ${String(error)}. Nothing was retried.${detail}` };
  }
}
