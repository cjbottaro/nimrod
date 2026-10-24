import type { CardPluginTarget, ToolCardData } from './card-plugin-api';
export function pluginTargets(value: unknown): readonly CardPluginTarget[] {
  if (value === undefined) return [{ backend: 'pi' }];
  if (!Array.isArray(value) || !value.length || value.length > 16) throw new Error('Invalid card plugin targets');
  return value.map(target => {
    if (!target || typeof target !== 'object' || Array.isArray(target) || Object.keys(target).some(key => !['backend', 'agent'].includes(key)) || !['pi', 'acp', 'copilot-sdk', 'codex'].includes(target.backend) || target.agent !== undefined && (typeof target.agent !== 'string' || !target.agent || target.agent.length > 128)) throw new Error('Invalid card plugin target');
    return { backend: target.backend, ...(target.agent === undefined ? {} : { agent: target.agent }) } as CardPluginTarget;
  });
}
export function targetSpecificity(targets: readonly CardPluginTarget[], data: Readonly<ToolCardData>): number {
  const source = data.source ?? { backend: 'pi' };
  return Math.max(0, ...targets.map(target => target.backend !== source.backend ? 0
    : target.agent === undefined ? 1 : target.agent === source.agent ? 2 : 0));
}
export function matchesTarget(targets: readonly CardPluginTarget[], data: Readonly<ToolCardData>): boolean {
  return targetSpecificity(targets, data) > 0;
}
export function pluginKinds(value: unknown): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.length || value.length > 50 || value.some(kind => typeof kind !== 'string' || !/^[a-z0-9_-]+$/.test(kind)) || new Set(value).size !== value.length) throw new Error('Invalid card plugin kinds');
  return [...value];
}
