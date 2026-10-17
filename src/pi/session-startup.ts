import type { Packet } from './transport';
import type { SessionFile } from './session-file';

export interface PiLaunchInfo { cwd: string; session?: SessionFile; }

/** Private Pi startup dependencies, not a cross-harness launch protocol. */
interface PiStartupHost {
  start(receive: (packet: Packet) => void): Promise<PiLaunchInfo>;
  currentProject(): string | undefined;
  current(): boolean;
  receive(packet: Packet): void;
  validated(info: PiLaunchInfo): void;
  initialize(): Promise<void>;
}

/** Native Pi may emit packets before start resolves. Validate its launch identity and bind the
 * shell's draft before releasing those packets in order, then perform Pi initialization.
 * The shell still owns teardown/error presentation and the owning generation's lifetime.
 */
export async function startPiSession(expected: { mode: string; sessionId?: string }, host: PiStartupHost): Promise<void> {
  let startupPackets: Packet[] | undefined = [];
  const receive = (packet: Packet) => {
    if (!host.current()) return;
    if (startupPackets) startupPackets.push(packet);
    else host.receive(packet);
  };
  try {
    const info = await host.start(receive);
    if (!info?.cwd || info.cwd !== host.currentProject()) throw new Error('Native host did not confirm this project');
    if (expected.mode === 'resume' && !info.session) throw new Error('Native host did not validate the selected session');
    if (info.session && expected.sessionId && expected.sessionId !== info.session.sessionId) throw new Error('The session file was replaced with a different session');
    host.validated(info);
    const packets = startupPackets; startupPackets = undefined;
    for (const packet of packets) host.receive(packet);
    await host.initialize();
  } finally {
    // On failure the caller retires the transport; never retain an unbounded startup buffer.
    startupPackets = undefined;
  }
}
