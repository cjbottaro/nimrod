import type { CardPluginTarget, ToolCardData } from './card-plugin-api';
export function pluginTargets(value: unknown): readonly CardPluginTarget[] {
  if (value === undefined) return [{ backend: 'pi' }];
  if (!Array.isArray(value) || !value.length || value.length > 16) throw new Error('Invalid card plugin targets');
  return value.map(target => {
    if (!target || typeof target !== 'object' || Array.isArray(target) || Object.keys(target).some(key => !['backend', 'agent'].includes(key)) || !['pi', 'acp'].includes(target.backend) || target.agent !== undefined && (typeof target.agent !== 'string' || !target.agent || target.agent.length > 128)) throw new Error('Invalid card plugin target');
    return { backend: target.backend, ...(target.agent === undefined ? {} : { agent: target.agent }) } as CardPluginTarget;
  });
}
export function matchesTarget(targets: readonly CardPluginTarget[], data: Readonly<ToolCardData>): boolean {
  const source = data.source ?? { backend: 'pi' };
  return targets.some(target => target.backend === source.backend && (target.agent === undefined || target.agent === source.agent));
}
