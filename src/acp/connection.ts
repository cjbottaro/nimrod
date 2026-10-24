/** ACP keeps its mandatory JSON-RPC version member; only ordered mechanics are shared. */
import { JsonRpcConnection, type RpcConnectionHandlers, type RpcPacket } from '../json-rpc-connection';
export {
  isRecord,
  RpcResponseError as AcpResponseError,
  RpcConnectionError as AcpConnectionError,
} from '../json-rpc-connection';
export type { RpcRecord as AcpRecord, RpcId as AcpId } from '../json-rpc-connection';
export type AcpPacket = RpcPacket & { jsonrpc: '2.0' };
export type AcpConnectionHandlers = RpcConnectionHandlers;

export class AcpConnection extends JsonRpcConnection {
  constructor(send: (packet: AcpPacket) => void | Promise<void>, handlers: AcpConnectionHandlers = {}) {
    super(packet => send(packet as AcpPacket), handlers, { label: 'ACP', versionMember: true });
  }
}
