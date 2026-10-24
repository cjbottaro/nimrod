import { createCardSummary } from './pi/card-shell';

/** Presentation-only input. Harness adapters own recognition and command spelling. */
export interface SkillInvocation {
  label: string;
  content: string;
  location?: string;
  userMessage?: string;
}

/** Bind a harness parser once; unchanged turns skip even parsing the large expansion. */
export function skillUserText(parse: (text: string) => SkillInvocation | undefined) {
  const sources = new WeakMap<HTMLElement, string>();
  return (document: Document, text: string, key: string, expanded: Map<string, boolean>,
    markdown: (text: string) => HTMLElement, previous?: HTMLElement): HTMLElement => {
    if (previous && sources.get(previous) === text) return previous;
    const skill = parse(text);
    if (!skill) return markdown(text);
    const node = renderSkillInvocation(document, skill, key, expanded, markdown, previous);
    sources.set(node, text);
    return node;
  };
}

const renderedSkills = new WeakMap<HTMLElement, SkillInvocation>();

/** Shared user-turn disclosure; never changes the harness's expanded prompt/history. */
export function renderSkillInvocation(
  document: Document,
  skill: SkillInvocation,
  key: string,
  expanded: Map<string, boolean>,
  renderMarkdown: (text: string) => HTMLElement,
  previous?: HTMLElement,
): HTMLElement {
  const prior = previous && renderedSkills.get(previous);
  if (previous && prior && prior.label === skill.label && prior.content === skill.content
    && prior.location === skill.location && prior.userMessage === skill.userMessage) return previous;
  const root = document.createElement('div');
  root.className = 'skill-invocation';
  const details = document.createElement('details');
  details.className = 'tool-card skill-card';
  details.dataset.detailKey = key;
  details.open = previous?.querySelector<HTMLDetailsElement>('.skill-card')?.open ?? expanded.get(key) ?? false;
  const summary = createCardSummary(document);
  const label = document.createElement('span');
  label.className = 'tool-card-preview skill-name';
  label.textContent = skill.label;
  summary.append(label);
  const body = document.createElement('div');
  body.className = 'skill-body';
  let rendered = false;
  const populate = () => {
    if (rendered || !details.open) return;
    rendered = true;
    if (skill.location) {
      const location = document.createElement('div');
      location.className = 'skill-location';
      location.textContent = skill.location;
      body.append(location);
    }
    body.append(renderMarkdown(skill.content));
  };
  // Large skill bodies need not be parsed/highlighted until explicitly inspected.
  populate();
  details.addEventListener('toggle', () => {
    if (!details.isConnected) return;
    expanded.set(key, details.open);
    populate();
  });
  details.append(summary, body);
  root.append(details);
  if (skill.userMessage) root.append(renderMarkdown(skill.userMessage));
  renderedSkills.set(root, skill);
  return root;
}
