import type { HarnessProject } from './harness-contract';

/** One discovery snapshot per project-window startup, never invalidated by focus,
 * history refresh or preference edits. Installation changes require a restart.
 */
export function startupAvailability(discover: () => Promise<boolean>): HarnessProject['availability'] {
  let available = false, pending: Promise<void> | undefined;
  return {
    available: () => available,
    discover: () => pending ??= Promise.resolve().then(discover).then(result => { available = result; }),
  };
}
