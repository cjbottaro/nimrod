/** Literal SDK result recovery; rich fields never silently disappear. */
export function copilotToolResult(result: Record<string, unknown>): string {
  const text = typeof result.detailedContent === 'string' ? result.detailedContent : typeof result.content === 'string' ? result.content : '';
  const rich = Object.fromEntries(Object.entries(result).filter(([key, value]) => value !== undefined && (!['content', 'detailedContent'].includes(key) || value !== text)));
  return Object.keys(rich).length ? `${text}\n\nCopilot result metadata:\n${JSON.stringify(rich, null, 2)}` : text;
}
