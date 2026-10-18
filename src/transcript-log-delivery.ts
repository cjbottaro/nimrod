import type { Packet } from './pi/transport';
import type { TranscriptLogSink } from './transcript-logs';

/** Keep ordered semantic application synchronous; wait for diagnostics before accepting more output. */
export function transcriptLogDelivery(
  receive: (packet: Exclude<Packet, { kind: 'logBarrier' }>) => void,
  log: TranscriptLogSink,
  acknowledge: (id: string) => Promise<unknown>,
  failure: (error: unknown) => void,
): (packet: Packet) => void {
  return packet => {
    if (packet.kind !== 'logBarrier') { receive(packet); return; }
    void (async () => {
      try { await log.flush?.(); }
      finally { await acknowledge(packet.id); }
    })().catch(failure);
  };
}
