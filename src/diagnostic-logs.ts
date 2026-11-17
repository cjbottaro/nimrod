import { createTranscriptLog, type TranscriptLogHost } from './transcript-logs';

/** Separate capture/file stream using the existing bounded queue and writer.
 * Integrations own metadata allowlists; this sink never inspects harness payloads. */
export function createDiagnosticLog(host: TranscriptLogHost) {
  return createTranscriptLog({ ...host, label: 'diagnostic logs' });
}
