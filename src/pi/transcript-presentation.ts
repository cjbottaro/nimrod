/** Keep empty envelopes mounted for streaming identity, without a visible turn marker/gap. */
export function isEmptyAssistantMessage<T extends { role?: unknown; isError?: unknown; content?: unknown }>(message: T): boolean {
  if (message.role !== 'assistant' || message.isError) return false;
  if (!Array.isArray(message.content)) return typeof message.content !== 'string' || !message.content.trim();
  return message.content.every(value => {
    if (!value || typeof value !== 'object') return false;
    const block = value as { type?: unknown; text?: unknown; thinking?: unknown };
    return block.type === 'text' ? typeof block.text !== 'string' || !block.text.trim()
      : block.type === 'thinking' ? typeof block.thinking !== 'string' || !block.thinking.trim() : false;
  });
}

export interface TranscriptRolePresentation {
  ariaLabel?: string;
  visibleLabel?: string;
}

/** User and assistant are visually differentiated by their message treatment; keep their roles available to assistive tech only. */
export function transcriptRolePresentation(role: string, toolName: string): TranscriptRolePresentation {
  if (role === "compactionSummary") return { visibleLabel: "Compaction summary" };
  if (role === "tool") return { ariaLabel: `Tool: ${toolName || "tool"}` };
  if (role === "parallel") return { ariaLabel: "Parallel tool activity" };
  if (role === 'configuration') return { ariaLabel: 'Nimrod configuration change' };
  if (role === "command") return { ariaLabel: "Command output" };
  if (role === "user" || role === "assistant") return { ariaLabel: `${role === "user" ? "User" : "Assistant"} message` };
  return {
    visibleLabel: role === "toolResult" ? `Tool result: ${toolName}` : toolName ? `Tool: ${toolName}` : role,
  };
}
