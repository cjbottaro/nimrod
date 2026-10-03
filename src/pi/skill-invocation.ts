export interface SkillInvocation {
  name: string;
  location: string;
  content: string;
  userMessage?: string;
}

/** Pi 0.86.1's parseSkillBlock format, not arbitrary embedded XML/Markdown. */
export function parseSkillInvocation(text: string): SkillInvocation | undefined {
  const match = text.match(/^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/);
  if (!match) return undefined;
  return { name: match[1], location: match[2], content: match[3], userMessage: match[4]?.trim() || undefined };
}

const sourceText = new WeakMap<HTMLElement, string>();

/** Presentation only: keep Pi's expanded message intact in conversation state. */
export function renderSkillInvocation(
  document: Document,
  text: string,
  key: string,
  expanded: Map<string, boolean>,
  renderMarkdown: (text: string) => HTMLElement,
  previous?: HTMLElement,
): HTMLElement | undefined {
  if (previous && sourceText.get(previous) === text) return previous;
  const skill = parseSkillInvocation(text);
  if (!skill) return undefined;
  const root = document.createElement("div");
  root.className = "skill-invocation";
  const details = document.createElement("details");
  details.className = "tool-card skill-card";
  details.dataset.detailKey = key;
  details.open = previous?.querySelector<HTMLDetailsElement>(".skill-card")?.open ?? expanded.get(key) ?? false;
  const summary = document.createElement("summary");
  const label = document.createElement("span");
  label.className = "tool-card-preview skill-name";
  label.textContent = `/skill:${skill.name}`;
  summary.append(label);
  const body = document.createElement("div");
  body.className = "skill-body";
  let rendered = false;
  const populate = () => {
    if (rendered || !details.open) return;
    rendered = true;
    const location = document.createElement("div");
    location.className = "skill-location";
    location.textContent = skill.location;
    body.append(location, renderMarkdown(skill.content));
  };
  // Large skill bodies need not be parsed/highlighted until explicitly inspected.
  populate();
  details.addEventListener("toggle", () => {
    if (!details.isConnected) return;
    expanded.set(key, details.open);
    populate();
  });
  details.append(summary, body);
  root.append(details);
  if (skill.userMessage) root.append(renderMarkdown(skill.userMessage));
  sourceText.set(root, text);
  return root;
}
