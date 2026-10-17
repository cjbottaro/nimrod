import type { DisplayMessage } from '../conversation-model';

/** Keep empty envelopes mounted for streaming identity, without a visible turn marker/gap. */
export function isEmptyAssistantMessage(message: DisplayMessage): boolean {
  if (message.role !== 'assistant' || message.isError) return false;
  if (!Array.isArray(message.content)) return !message.content?.trim();
  return message.content.every(block => block.type === 'text' ? !block.text?.trim()
    : block.type === 'thinking' ? !block.thinking?.trim() : false);
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
