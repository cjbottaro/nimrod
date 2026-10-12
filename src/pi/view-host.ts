import type { HostMessage } from './webview-client';
import type { JsonRecord } from './types';

/** The existing Pi renderer's small in-process boundary; no VS Code compatibility shim. */
export interface ViewHost {
  cardRenderer?: (data: Readonly<import('./tool-card').ToolCardBlock>) => import('./tool-card').ToolCardRenderer;
  cardActions?: {
    copy(text: string): Promise<void>;
    openLink(href: string): Promise<void>;
    popOutCode(text: string, language: string): Promise<void>;
  };
  attachments?: import('./image-attachments').AttachmentHost;
  postMessage(message: JsonRecord): void;
  onMessage(listener: (message: HostMessage) => void): void;
  getState(): unknown;
  setState(value: unknown): void;
}
