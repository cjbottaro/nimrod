import type { HarnessProject } from './harness-contract';

export const DEFAULT_HARNESS_SETTING = 'sessions.defaultHarness';
export const DEFAULT_HARNESS = 'pi';
export function readDefaultHarness(settings: Record<string, unknown>): string {
  const value = settings[DEFAULT_HARNESS_SETTING];
  if (value === undefined) return DEFAULT_HARNESS;
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value))
    throw new Error(`${DEFAULT_HARNESS_SETTING} must be a harness ID.`);
  return value;
}

export type SessionCreationKind = 'saved' | 'named' | 'temporary';
export function supportsCreation(project: HarnessProject, kind: SessionCreationKind): boolean {
  return project.creation.modes.includes(kind === 'named' ? 'saved' : kind) && (kind !== 'named' || project.creation.named);
}
export function creationChoices(projects: readonly HarnessProject[], kind: SessionCreationKind): HarnessProject[] {
  return projects.filter(project => project.availability.available() && project.initialization.ready() && supportsCreation(project, kind));
}
export function creationDefault(projects: readonly HarnessProject[], id: string, kind: SessionCreationKind): { project?: HarnessProject; notice: string } {
  const project = projects.find(project => project.id === id);
  if (!project || !project.availability.available()) return { notice: `Default harness ${project?.label ?? id} is unavailable. Choose a harness for this session.` };
  if (!project.initialization.ready()) return { notice: `Default harness ${project.label} is not ready. Choose a harness for this session.` };
  if (!supportsCreation(project, kind)) return { notice: `Default harness ${project.label} does not support ${kind === 'named' ? 'named' : kind} sessions. Choose a harness for this session.` };
  return { project, notice: '' };
}
