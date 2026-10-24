import type { ConversationInteraction, ConversationViewState } from './conversation-view-host';
import type { SessionConversation } from './harness-contract';
import type { HarnessSessionHost } from './harness-host';
import type { SessionMessageInput } from './session-message-input';

interface ConversationOwner {
  readonly state: ConversationViewState;
  readonly messageInput: SessionMessageInput;
  handle(message: Record<string, unknown>): Promise<void>;
}
/** Bind consumer operations to their original live implementation, never a backend discriminator. */
export function conversationPort(host: HarnessSessionHost, read: () => ConversationOwner | undefined, interaction: ConversationInteraction): SessionConversation {
  return {
    interaction,
    get state() { return read()?.state; },
    messageInput: {
      capabilities: () => read()?.messageInput.capabilities() ?? { imageUnavailableReason: 'Connect this session before attaching images.' },
      async submit(message) {
        const owner = read();
        if (!owner || !host.lifetime.current() || host.lifetime.closing() || host.lifetime.restarting() || host.lifetime.deleting()) {
          host.effects.publish({ type: 'submissionReceipt', id: message.id, outcome: 'rejected', error: 'Session is no longer available. Nothing was sent.' }); return;
        }
        try { const submitted = owner.messageInput.submit(message); host.effects.changed(); await submitted; }
        catch (error) { host.effects.publish({ type: 'submissionReceipt', id: message.id, outcome: 'unknown', error: `Delivery was not confirmed: ${String(error)}. Nothing was replayed.` }); }
        finally { if (host.lifetime.current() && read() === owner) host.effects.changed(); }
      },
    },
    async handle(message) {
      const owner = read(); if (!owner) throw new Error('Session is not connected');
      try { const result = owner.handle(message); host.effects.changed(); await result; }
      finally { if (host.lifetime.current() && read() === owner) host.effects.changed(); }
    },
  };
}
