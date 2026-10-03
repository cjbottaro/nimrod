import type { SlashCommand } from "./slash-completion";

// Keep slash ranking aligned with Pi TUI 0.86.1's fuzzy matcher: ordered
// characters, consecutive/boundary bonuses, gap penalties, and exact matches.
// This browser-only implementation avoids importing Pi's Node-based TUI.
function matchScore(query: string, text: string): number | undefined {
  if (query.length > text.length) return undefined;
  let score = 0;
  let last = -1;
  let consecutive = 0;
  for (const character of query) {
    const index = text.indexOf(character, last + 1);
    if (index < 0) return undefined;
    if (last === index - 1) score -= ++consecutive * 5;
    else {
      consecutive = 0;
      if (last >= 0) score += (index - last - 1) * 2;
    }
    if (index === 0 || /[\s\-_./:]/.test(text[index - 1])) score -= 10;
    score += index * 0.1;
    last = index;
  }
  return score - (query === text ? 100 : 0);
}

function fuzzyScore(query: string, text: string): number | undefined {
  const score = matchScore(query, text);
  if (score !== undefined) return score;
  // Pi also accepts swapped letter/number groups (e.g. "5gpt" → "gpt5").
  const groups = /^([a-z]+)([0-9]+)$/.exec(query) ?? /^([0-9]+)([a-z]+)$/.exec(query);
  if (!groups) return undefined;
  const swapped = matchScore(groups[2] + groups[1], text);
  return swapped === undefined ? undefined : swapped + 5;
}

export function matchSlashCommands(commands: SlashCommand[], query: string): SlashCommand[] {
  if (!query) return commands;
  query = query.toLowerCase();
  const matches: Array<{ command: SlashCommand; score: number }> = [];
  for (const command of commands) {
    const name = command.name.toLowerCase();
    const text = !query.startsWith("skill:") && name.startsWith("skill:") ? name.slice(6) : name;
    const score = fuzzyScore(query, text);
    if (score !== undefined) matches.push({ command, score });
  }
  return matches.sort((a, b) => a.score - b.score).map(match => match.command);
}
