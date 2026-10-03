import type { HostMessage } from './webview-client';
import type { JsonRecord } from './types';

/** The existing Pi renderer's small in-process boundary; no VS Code compatibility shim. */
export interface ViewHost {
  postMessage(message: JsonRecord): void;
  onMessage(listener: (message: HostMessage) => void): void;
  getState(): unknown;
  setState(value: unknown): void;
}
