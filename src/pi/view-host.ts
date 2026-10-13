import type { HostMessage } from './webview-client';
import type { JsonRecord } from './types';

/** The existing Pi renderer's small in-process boundary; no VS Code compatibility shim. */
export interface ViewHost {
  performance?: import('../performance-diagnostics').PerformanceProbe;
  cardRenderer?: (data: Readonly<import('./tool-card').ToolCardBlock>) => import('./tool-card').ToolCardRenderer;
  cardActions?: {
    copy(text: string): Promise<void>;
    openLink(href: string): Promise<void>;
    popOutCode(text: string, language: string): Promise<void>;
  };
  attachments?: import('./image-attachments').AttachmentHost;
  reportNotice?(notice: import('../application-notices').ApplicationNotice): void;
  resolveNotice?(id: string): void;
  resolveNoticeCause?(cause: string): void;
  /** Synchronous local Send intent, before image preparation/RPC; no receipt or submission state. */
  promptSubmitted?(): void;
  /** Read live preferences at local submission; changes never navigate on their own. */
  sendAutoFollow?(): import('./transcript-scroll').SendAutoFollow;
  postMessage(message: JsonRecord): void;
  onMessage(listener: (message: HostMessage) => void): void;
  getState(): unknown;
  setState(value: unknown): void;
}
