import { conversationIndex, messageChanges, messageVersion } from './conversation-index';
import { projectToolTimeline, transcriptRows } from './tool-progress';
import type { ContentBlock, ConversationState, DisplayMessage } from './types';

/** Optional in-process optimization. Missing/discontinuous metadata means full reconciliation. */
export interface TranscriptUpdate {
  base: number;
  revision: number;
  rows?: readonly DisplayMessage[];
}

export class TranscriptUpdates {
  private revision = 0;
  private previous?: ConversationState;
  private cache = new WeakMap<DisplayMessage, DisplayMessage[]>();
  private blocks = new WeakMap<ContentBlock, DisplayMessage>();

  private rows(message: DisplayMessage): DisplayMessage[] {
    const cached = this.cache.get(message);
    if (cached) return cached;
    const rows = transcriptRows([message]).map(row => {
      const block = Array.isArray(row.content) && row.role === 'assistant' ? row.content[0] : undefined;
      if (!block) return row;
      const previous = this.blocks.get(block);
      // Compare only the small envelope, never content/arguments/output bodies.
      const same = previous && previous.key === row.key
        && Object.keys(row).every(key => key === 'content' || row[key as keyof DisplayMessage] === previous[key as keyof DisplayMessage])
        && Object.keys(previous).every(key => key === 'content' || row[key as keyof DisplayMessage] === previous[key as keyof DisplayMessage]);
      if (same && previous) return previous;
      this.blocks.set(block, row); return row;
    });
    this.cache.set(message, rows);
    return rows;
  }

  snapshot(state: ConversationState): { state: ConversationState; transcript: TranscriptUpdate } {
    const previous = this.previous;
    const transcript: TranscriptUpdate = { base: this.revision, revision: ++this.revision };
    if (previous && previous.toolProgress === state.toolProgress && previous.queue === state.queue && previous.sessionUnavailable === state.sessionUnavailable) {
      if (previous.messages === state.messages) transcript.rows = [];
      else {
        const changes = messageChanges(state.messages);
        if (changes?.previous === messageVersion(previous.messages)) {
          const dirty: DisplayMessage[] = [];
          let structural = false;
          if (changes.toolIds) {
            // Tool output carries exact identities: do not project sibling blocks
            // even when Pi packs hundreds of invocations into one assistant turn.
            const index = conversationIndex(state.messages);
            for (const id of changes.toolIds) for (const location of index.tools.get(id) ?? []) {
              const message = state.messages[location.message];
              dirty.push(...this.rows(location.block === undefined ? message : { ...message, content: [(message.content as ContentBlock[])[location.block]] }));
            }
          } else for (const index of changes.indices) {
            const before = previous.messages[index], after = state.messages[index];
            const oldRows = this.rows(before), nextRows = this.rows(after);
            if (oldRows.length !== nextRows.length || oldRows.some((row, at) => row.key !== nextRows[at].key || row.role !== nextRows[at].role)) { structural = true; break; }
            nextRows.forEach((row, at) => { if (row !== oldRows[at]) dirty.push(row); });
          }
          if (!structural) transcript.rows = dirty;
        }
      }
    }
    this.previous = state;
    // Capture the immutable canonical state, not a chain of earlier snapshots.
    // Full projection is lazy so streaming and hidden delivery do not materialize it.
    let messages: DisplayMessage[] | undefined;
    const projected = { ...state };
    Object.defineProperty(projected, 'messages', { enumerable: true, get: () => messages ??= projectToolTimeline(state.messages, state.toolProgress, state.messages.flatMap(message => this.rows(message))) });
    return { state: projected, transcript };
  }
}
