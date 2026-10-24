import type { SkillInvocation } from '../skill-invocation';

/** Copilot's explicit slash-skill expansion, not agent-invoked skill tool output. */
export function parseCopilotSkillInvocation(text: string): SkillInvocation | undefined {
  const match = /^(The user explicitly invoked the "(\/[^"\s]+)" skill\. Follow its instructions now\.)\n\n([\s\S]+)$/.exec(text);
  if (!match) return undefined;
  let expanded = match[3];
  // Runtime versions can wrap the injected context; Markdown normally hides
  // these tags, so they are not apparent in the rendered expanded prompt.
  const context = /^<skill-context name="([^"\n]+)">\n([\s\S]*)\n<\/skill-context>$/.exec(expanded);
  if (context) {
    if (context[1] !== match[2].slice(1)) return undefined;
    expanded = context[2];
  }
  if (!/^Base directory for this skill: [^\n]+\n\n[\s\S]+$/.test(expanded)) return undefined;
  // Copilot appends user input after the skill with this literal marker.
  // Use the final marker so examples in the skill stay inside the disclosure.
  const delimiter = '\n\nARGUMENTS: ';
  const boundary = expanded.lastIndexOf(delimiter);
  const userMessage = boundary < 0 ? undefined : expanded.slice(boundary + delimiter.length);
  return {
    label: match[2],
    content: `${match[1]}\n\n${boundary < 0 ? expanded : expanded.slice(0, boundary)}`,
    userMessage: userMessage?.trim() ? userMessage : undefined,
  };
}
