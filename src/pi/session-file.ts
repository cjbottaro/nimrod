/** Pi's native validated file identity; not an assumption made by other integrations. */
export interface SessionFile {
  path: string;
  sessionId: string;
  exists: boolean;
  parentSession?: string | null;
  lastUserMessageAt?: number;
}
