import { mountConversationView } from '../conversation-view';
import { createPiViewProjection, piInteraction } from './view-policy';
import type { ViewHost } from './view-host';
import { DEFAULT_IMAGE_INPUT } from '../session-message-input';
export type { HostMessage } from './view-state';
export type { ConversationView as PiView } from '../conversation-view-host';

/** Compatibility entry for Pi callers/fixtures; the shared engine has no ACP/Pi switch. */
export function mountPiView(host: ViewHost, root: HTMLElement | Document = document) {
  const project = createPiViewProjection();
  return mountConversationView({ ...host, interaction: piInteraction,
    messageInput: host.messageInput ?? { capabilities: () => ({ images: DEFAULT_IMAGE_INPUT }),
      submit: async message => host.postMessage({ ...message, type: 'prompt' }) },
    onMessage: receive => host.onMessage(message => receive({ ...message, state: message.state ? project(message.state) : undefined })),
    postMessage: message => {
      if (message.type === 'selectControl') {
        if (message.id === 'model') host.postMessage({ type: 'selectModel' });
        else if (message.id === 'thinking') host.postMessage({ type: 'selectThinking' });
      } else host.postMessage(message);
    },
  }, root);
}
