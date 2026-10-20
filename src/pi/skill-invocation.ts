import type { SkillInvocation } from '../skill-invocation';

/** Pi 0.86.1's parseSkillBlock format, not arbitrary embedded XML/Markdown. */
export function parseSkillInvocation(text: string): SkillInvocation | undefined {
  const match = text.match(/^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/);
  if (!match) return undefined;
  return { label: `/skill:${match[1]}`, location: match[2], content: match[3], userMessage: match[4]?.trim() || undefined };
}
