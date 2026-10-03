const LANGUAGE_TITLES: Record<string, string> = {
  markdown: 'Markdown', md: 'Markdown', mkd: 'Markdown', mkdown: 'Markdown',
  typescript: 'TypeScript', ts: 'TypeScript', javascript: 'JavaScript', js: 'JavaScript',
  python: 'Python', py: 'Python', rust: 'Rust', rs: 'Rust',
  json: 'JSON', html: 'HTML', xml: 'XML', css: 'CSS', sql: 'SQL', yaml: 'YAML', yml: 'YAML',
  bash: 'Bash', sh: 'Shell', shell: 'Shell', text: 'Plain text', plaintext: 'Plain text', 'plain text': 'Plain text',
};

export function isMarkdownLanguage(language: string): boolean {
  return ['markdown', 'md', 'mkdown', 'mkd'].includes(language.trim().toLowerCase());
}

// Read headings from the sanitized, rendered document: Markdown syntax, entities,
// inline formatting and fenced examples should not leak into the native title.
export function popoutTitle(text: string, language: string, rendered: Element): string {
  const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  const markdown = isMarkdownLanguage(language);
  const heading = markdown ? Array.from(rendered.querySelectorAll('h1, h2, h3, h4, h5, h6'))
    .map(node => clean(node.textContent || '')).find(Boolean) : undefined;
  const firstLine = markdown ? undefined : text.split(/\r?\n/).find(line => clean(line));
  const fallback = clean(LANGUAGE_TITLES[language.trim().toLowerCase()] || language) || 'Plain text';
  const label = heading || (firstLine ? clean(firstLine) : fallback);
  // Bound work and avoid splitting a Unicode code point in a long first line.
  const characters = Array.from(label.slice(0, 162));
  return characters.length > 80 ? characters.slice(0, 79).join('') + '…' : label;
}
