import type { CardPresentation, CardSection } from './card-plugin-api';

/** Web presentation never turns an agent-supplied file/javascript URL into a local action. */
export function webUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value || /[\u0000-\u0020\u007f]/.test(value)) return;
  try {
    const url = new URL(value);
    if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) return url.href;
  } catch { /* Unknown URL shapes keep their literal/raw fallback. */ }
}
export function displayWebUrl(value: string): string {
  const url = webUrl(value);
  return url ? url.replace(/^https:\/\//, '') : value;
}
export function markdownWebLink(label: string, value: string): string {
  const text = label.replace(/[\\`*_[\]<>!]/g, '\\$&').replace(/[\r\n]/g, ' ');
  const url = webUrl(value);
  return url ? `[${text}](<${url.replace(/>/g, '%3E')}>)` : text;
}
/** Called only after the normal Markdown sanitizer, before mounting the resulting DOM. */
export function constrainWebLinks(root: HTMLElement, baseUrl?: string): void {
  const base = webUrl(baseUrl);
  for (const link of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = link.getAttribute('href')!;
    let resolved = webUrl(href);
    if (!resolved && base && !/^[a-z][\w+.-]*:/i.test(href) && !href.startsWith('\\')) {
      try { resolved = webUrl(new URL(href, base).href); } catch { /* Leave an inert label. */ }
    }
    if (resolved) link.setAttribute('href', resolved); else link.removeAttribute('href');
  }
}
export interface WebSource { title: string; url: string; }
/** Presentation-only helpers: adapters supply native parsing and validated citation mapping. */
export function webSearchPresentation(value: { query: string; sections: CardPresentation['sections']; sources?: readonly WebSource[] }): CardPresentation {
  const sections: CardSection[] = [...value.sections];
  if (value.sources?.length) sections.push({ key: 'web-sources', label: `Sources · ${value.sources.length}`,
    text: value.sources.map((source, index) => {
      const url = webUrl(source.url), domain = url ? new URL(url).hostname : undefined;
      return `${index + 1}. ${markdownWebLink(source.title, source.url)}${domain ? ` — ${domain}` : ''}`;
    }).join('\n'), format: 'markdown', webLinks: true });
  return { title: 'Web search', preview: value.query, rawInputsPlacement: 'after', sections };
}
export function webFetchPresentation(value: { url: string; startIndex?: number; sections: CardPresentation['sections'] }): CardPresentation {
  const offset = typeof value.startIndex === 'number' && Number.isSafeInteger(value.startIndex) && value.startIndex >= 0 ? `from character ${value.startIndex}` : undefined;
  return { title: 'Fetch', preview: [displayWebUrl(value.url), offset].filter(Boolean).join(' · '), rawInputsPlacement: 'after', sections: value.sections };
}
