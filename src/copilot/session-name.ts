import { sessionName } from '../session-naming';

/** Same native SDK limits for initial naming and explicit Rename session. */
export function copilotSessionName(value: string): string {
  const name = sessionName(value);
  if ([...name].length > 100) throw new Error('Copilot session names must be at most 100 characters.');
  return name;
}
