import type { DisplayMessage } from './types';

interface ToolLocation { message: number; block?: number; }
interface ConversationIndex { tools: Map<string, ToolLocation[]>; orphans: boolean; }
export interface MessageChanges { previous: object; indices: readonly number[]; toolIds?: readonly string[]; }
const versions = new WeakMap<DisplayMessage[], object>();
export function messageVersion(messages: DisplayMessage[]): object {
  let version = versions.get(messages);
  if (!version) { version = {}; versions.set(messages, version); }
  return version;
}
const indexes = new WeakMap<DisplayMessage[], ConversationIndex>();
const changes = new WeakMap<DisplayMessage[], MessageChanges>();

/** Array identity is the history-replacement boundary. Indexes never cross sessions. */
export function conversationIndex(messages: DisplayMessage[]): ConversationIndex {
  let index = indexes.get(messages);
  if (index) return index;
  index = { tools: new Map(), orphans: false };
  const add = (id: string, location: ToolLocation) => {
    const locations = index!.tools.get(id);
    if (locations) locations.push(location); else index!.tools.set(id, [location]);
  };
  messages.forEach((message, at) => {
    if (message.role === 'tool' && message.toolCallId) {
      index!.orphans = true; add(message.toolCallId, { message: at });
    }
    if (Array.isArray(message.content)) message.content.forEach((block, position) => {
      if (block.type === 'toolCall' && block.id) add(block.id, { message: at, block: position });
    });
  });
  indexes.set(messages, index);
  return index;
}

/** Content-only replacements preserve locations; structural paths rebuild lazily. */
export function trackMessageChanges(messages: DisplayMessage[], previous: DisplayMessage[], indices: readonly number[], sameLocations = true, toolIds?: readonly string[]): DisplayMessage[] {
  // Store an identity token, not the previous array: a strong backward link
  // would retain every old output and shallow history copy for the entire stream.
  changes.set(messages, { previous: messageVersion(previous), indices, toolIds });
  if (sameLocations) indexes.set(messages, conversationIndex(previous));
  return messages;
}
export function messageChanges(messages: DisplayMessage[]): MessageChanges | undefined { return changes.get(messages); }
