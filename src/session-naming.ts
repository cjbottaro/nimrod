/** Required session-row/palette consumer port. Harnesses own durable names.
 * Unsupported implementations reject explicitly; never persist a local alias.
 * Mutations are single-attempt, require the current connected owner, and must
 * reconcile through ordered native results/events without overwriting newer names.
 */
export interface SessionNaming {
  rename(name: string): Promise<void>;
}

export function sessionName(value: string): string {
  const name = value.trim();
  if (!name || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Enter a non-empty, single-line session name.');
  return name;
}
