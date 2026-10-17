import type { ConversationViewHost } from '../conversation-view-host';
import type { HostMessage } from './view-state';

/** Pi's compatibility entry supplies its own interaction policy and projection. */
export interface ViewHost extends Omit<ConversationViewHost, 'interaction' | 'onMessage'> {
  onMessage(listener: (message: HostMessage) => void): void;
}
