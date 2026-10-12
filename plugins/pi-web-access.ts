import type { CardPlugin, ToolCardData } from '../src/card-plugin-api';

const TOOLS = ['web_search', 'fetch_content', 'get_search_content', 'source_check'] as const;
const LABELS: Record<string, string> = { web_search: 'Web search', fetch_content: 'Fetch content', get_search_content: 'Stored web content', source_check: 'Source check' };
const MAX_LINKS = 200;
const MAX_RESPONSE_IDS = 32;
export interface SourceLink { key: string; title: string; url: string; group: string; }

export function toolName(name: unknown): string { return typeof name === 'string' ? name.trim().toLowerCase().split(/[.:/]/).pop() || '' : ''; }
function object(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
/** Complete JSON, or only complete top-level strings from a streamed argument fragment. */
export function argumentsRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return object(value) || {};
  try { return object(JSON.parse(value)) || {}; } catch { /* generation is not necessarily complete */ }
  const result: Record<string, unknown> = {}; let at = 0;
  const whitespace = () => { while (/\s/.test(value[at] || '') && at < value.length) at++; };
  const stringAt = (): string | undefined => {
    if (value[at] !== '"') return undefined;
    const start = at++;
    while (at < value.length) {
      if (value[at] === '\\') { at += 2; continue; }
      if (value[at++] === '"') { try { return JSON.parse(value.slice(start, at)) as string; } catch { return undefined; } }
    }
    return undefined;
  };
  whitespace(); if (value[at++] !== '{') return result;
  while (at < value.length) {
    whitespace(); const key = stringAt(); if (key === undefined) break;
    whitespace(); if (value[at++] !== ':') break; whitespace();
    const item = stringAt();
    if (item === undefined) break; // Don't infer nested fields, incomplete values or arrays.
    Object.defineProperty(result, key, { value: item, enumerable: true, configurable: true });
    whitespace(); if (value[at++] !== ',') break;
  }
  return result;
}
function strings(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value] : [];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && !!item.trim()) : [];
}
function targets(args: Record<string, unknown>, singular: string, plural: string): string[] { return [...strings(args[singular]), ...strings(args[plural])]; }
export function httpUrl(value: string): string | undefined {
  if (!value || /[\s\u0000-\u001f\u007f]/.test(value)) return undefined;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? value : undefined; } catch { return undefined; }
}
/** Recognize pi-web-access 0.38 text formats; never infer sources from arbitrary fetch prose. */
export function sourceLinks(text: string, kind: string): { links: SourceLink[]; limited: boolean } {
  if (!['web_search', 'get_search_content', 'source_check'].includes(kind)) return { links: [], limited: false };
  const lines = text.split(/\r?\n/); const links: SourceLink[] = []; const seen = new Set<string>();
  const clipped = new Set<number>();
  lines.forEach((line, index) => {
    if (line.trim() !== '[Output truncated.]') return;
    let at = index - 1; while (at >= 0 && !lines[at].trim()) at--;
    if (lines[at]?.trim() !== '---') return;
    at--; while (at >= 0 && !lines[at].trim()) at--; clipped.add(at);
  });
  let group = ''; let limited = false;
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i].trim();
    const heading = /^## (?:Query|Results for):\s*(.*)$/.exec(line);
    if (heading) { group = heading[1].replace(/^"|"$/g, ''); continue; }
    const title = /^(?:\d+\.\s+|###\s+)(.+)$/.exec(line);
    if (!title) continue;
    const url = httpUrl(lines[i + 1].trim()); if (!url) continue;
    // A clipped final URI can still look valid. Don't offer it as a link action.
    if (clipped.has(i + 1)) continue;
    const key = `${group}\0${url}\0${title[1]}`; if (seen.has(key)) continue; seen.add(key);
    if (links.length === MAX_LINKS) { limited = true; continue; }
    links.push({ key, title: title[1], url, group });
  }
  return { links, limited };
}
export function responseIds(text: string, args: Record<string, unknown>): string[] {
  const values = new Set(strings(args.responseId));
  // Actual guidance emitted by pi-web-access; these are references mentioned, not fetched data.
  for (const match of text.matchAll(/(?:stored as|background as|ready as) responseId "([a-zA-Z0-9_-]+)"|Artifact responseId: ([a-zA-Z0-9_-]+)|get_search_content\(\{ responseId: "([a-zA-Z0-9_-]+)"/g)) values.add(match[1] || match[2] || match[3]);
  return [...values];
}
export function requestDescription(kind: string, args: Record<string, unknown>): { preview: string; lines: string[]; base?: string } {
  const queries = targets(args, 'query', 'queries'); const urls = targets(args, 'url', 'urls');
  const primary = kind === 'web_search' ? queries : kind === 'source_check' ? strings(args.claim) : kind === 'fetch_content' ? urls : strings(args.responseId);
  const first = primary[0];
  const preview = first ? `${first}${primary.length > 1 ? ` · +${primary.length - 1} more` : ''}` : 'Preparing inputs…';
  const lines = [...primary];
  if (kind === 'source_check') lines.push(...queries.map(query => `Query: ${query}`));
  if (kind === 'get_search_content') {
    for (const key of ['query', 'url', 'findText']) lines.push(...strings(args[key]).map(value => `${key}: ${value}`));
  }
  for (const key of ['provider', 'domainFilter', 'recencyFilter', 'category', 'workflow', 'mode', 'prompt', 'timestamp', 'findMode']) {
    const values = strings(args[key]); if (values.length) lines.push(`${key === 'provider' ? 'Requested provider' : key}: ${values.join(' · ')}`);
  }
  for (const key of ['numResults', 'frames', 'queryIndex', 'urlIndex', 'offset', 'limit']) if (typeof args[key] === 'number') lines.push(`${key}: ${args[key]}`);
  for (const key of ['includeContent', 'fetchContent']) if (typeof args[key] === 'boolean') lines.push(`${key}: ${args[key]}`);
  const base = urls.length === 1 ? httpUrl(urls[0]) : kind === 'get_search_content' && typeof args.url === 'string' ? httpUrl(args.url) : undefined;
  return { preview, lines, base };
}

function style(node: HTMLElement, values: Partial<CSSStyleDeclaration>): void { Object.assign(node.style, values); }
interface LinkNode { node: HTMLElement; title: HTMLAnchorElement; location: HTMLElement; group: HTMLElement; url: string; remove: (() => void)[]; }

const plugin: CardPlugin = {
  apiVersion: 2,
  id: 'nimrod-plugins.pi-web-access',
  tools: TOOLS,
  supports: data => (TOOLS as readonly string[]).includes(toolName(data.name)),
  mount(context) {
    const doc = context.document;
    const title = doc.createElement('span'); title.className = 'tool-card-title';
    const preview = doc.createElement('span'); preview.className = 'tool-card-preview'; context.summary.append(title, preview);
    const root = doc.createElement('section'); root.className = 'pi-web-access'; style(root, { marginLeft: '14px', minWidth: '0' });
    let layout: 'live' | 'result' | undefined;
    function section(label: string): HTMLElement {
      const node = doc.createElement('section'); const heading = doc.createElement('h4'); heading.textContent = label;
      style(heading, { margin: '10px 0 5px', fontSize: '.85em', color: 'var(--vscode-descriptionForeground)' }); node.append(heading); root.append(node); return node;
    }
    const request = section('Request'); const requestList = doc.createElement('ul'); style(requestList, { paddingLeft: '20px', overflowWrap: 'anywhere' }); request.append(requestList);
    const sources = section('Source links mentioned in returned text'); const sourceNote = doc.createElement('p');
    style(sourceNote, { fontSize: '.8em', color: 'var(--vscode-descriptionForeground)' }); sources.append(sourceNote);
    const list = doc.createElement('ol'); style(list, { paddingLeft: '20px' }); sources.append(list);
    list.tabIndex = 0; list.setAttribute('aria-label', 'Web access source links');
    let unregisterSources = () => {};
    const outputSection = section('Returned content'); const heading = outputSection.querySelector('h4')!;
    const toolbar = doc.createElement('div'); style(toolbar, { display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '6px' }); outputSection.append(toolbar);
    const refs = doc.createElement('div'); style(refs, { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '6px' }); outputSection.append(refs);
    const refsNote = doc.createElement('small'); refs.append(refsNote);
    const output = doc.createElement('div');
    // Bound absolutely positioned Markdown/code accessibility nodes to this scrollport.
    style(output, { position: 'relative' });
    output.tabIndex = 0; output.setAttribute('aria-label', 'Web access returned content'); outputSection.append(output);
    let unregister = () => {};
    function present(live: boolean): void {
      const next = live ? 'live' : 'result'; if (layout === next) return;
      unregister(); unregisterSources();
      if (live) {
        root.remove(); unregister = () => {}; unregisterSources = () => {};
      } else {
        for (const child of Array.from(context.body.children)) if (child.classList.contains('tool-section')) child.remove();
        context.body.append(root);
        unregister = context.registerOutput('web-access-content', output);
        unregisterSources = context.registerOutput('web-access-sources', list);
      }
      layout = next;
    }
    const status = doc.createElement('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); style(status, { fontSize: '.8em' }); root.append(status);
    let current = ''; let previousText: string | undefined; let previousBase: string | undefined; let previousMode: unknown;
    const linkNodes = new Map<string, LinkNode>(); const referenceNodes = new Map<string, { node: HTMLElement; remove: () => void }>();
    function action(parent: HTMLElement, label: string, available: boolean, value: () => string, perform: (text: string) => Promise<void>, done: string): { button: HTMLButtonElement; remove: () => void } {
      const button = doc.createElement('button'); button.type = 'button'; button.textContent = label; button.disabled = !available;
      style(button, { padding: '3px 7px', fontSize: '.8em' }); parent.append(button); let pending = false;
      const remove = context.on(button, 'click', async event => {
        event.stopPropagation(); if (pending) return; pending = true; button.setAttribute('aria-busy', 'true');
        const captured = value();
        try { await perform(captured); if (!context.signal.aborted) context.mutate(() => { status.textContent = done; }); }
        catch { if (!context.signal.aborted) context.mutate(() => { status.textContent = `${label} failed`; }); }
        finally { pending = false; if (!context.signal.aborted) button.removeAttribute('aria-busy'); }
      });
      return { button, remove };
    }
    const copy = action(toolbar, 'Copy returned text', context.capabilities.copy, () => current, text => context.copy(text), 'Copied returned text');
    const popout = action(toolbar, 'Pop out returned text', context.capabilities.popOutCode, () => current, text => context.popOutCode(text, previousMode === 'raw' ? 'text' : 'markdown'), 'Snapshot requested');
    const removeLinks = context.on(output, 'click', event => {
      const target = event.target instanceof doc.defaultView!.Element ? event.target.closest('a') : null;
      if (!target) return; event.preventDefault(); event.stopPropagation();
      const href = target.getAttribute('href'); if (!href || !context.capabilities.openLink) return;
      void context.openLink(href).catch(() => { if (!context.signal.aborted) context.mutate(() => { status.textContent = 'Open link failed'; }); });
    });
    return {
      update(data: Readonly<ToolCardData>) {
        const kind = toolName(data.name); const args = argumentsRecord(data.arguments); const description = requestDescription(kind, args);
        title.textContent = LABELS[kind] || 'Web access'; preview.textContent = description.preview;
        current = data.resultOutput !== undefined ? data.resultOutput : data.executionOutput || '';
        const live = data.resultOutput === undefined && (data.toolStatus === undefined || data.toolStatus === 'running') && !data.isError && data.uiPhase !== 'stopped';
        present(live);
        if (live) {
          context.renderPresentation({ title: LABELS[kind] || 'Web access', preview: description.preview,
            sections: current ? [{ key: 'result', label: 'Live output', text: current }] : [] });
          return;
        }
        requestList.replaceChildren(...description.lines.map(line => { const item = doc.createElement('li'); item.textContent = line; return item; }));
        request.hidden = !description.lines.length;
        heading.textContent = data.resultOutput !== undefined ? 'Returned content' : data.toolStatus === 'running' ? 'Live output' : 'Execution output';
        copy.button.disabled = !context.capabilities.copy || !current; popout.button.disabled = !context.capabilities.popOutCode || !current;
        const parsed = sourceLinks(current, kind); sources.hidden = !parsed.links.length;
        sourceNote.textContent = `${parsed.links.length} links shown${parsed.limited ? ` (first ${MAX_LINKS}; full text below)` : ''}. This is not the provider's total result count.`;
        const remaining = new Set(linkNodes.keys());
        parsed.links.forEach((source, index) => {
          let owned = linkNodes.get(source.key);
          if (!owned) {
            const node = doc.createElement('li'); style(node, { padding: '6px 0', overflowWrap: 'anywhere' });
            const group = doc.createElement('div'); style(group, { fontSize: '.8em', color: 'var(--vscode-descriptionForeground)' });
            const anchor = doc.createElement('a'); style(anchor, { color: 'var(--vscode-textLink-foreground)', cursor: 'pointer' });
            const location = doc.createElement('div'); style(location, { fontSize: '.8em', color: 'var(--vscode-descriptionForeground)' });
            node.append(group, anchor, location);
            owned = { node, title: anchor, location, group, url: source.url, remove: [] }; const captured = owned;
            owned.remove.push(context.on(anchor, 'click', event => {
              event.preventDefault(); event.stopPropagation();
              if (context.capabilities.openLink) void context.openLink(captured.url).catch(() => { if (!context.signal.aborted) context.mutate(() => { status.textContent = 'Open source failed'; }); });
            }));
            owned.remove.push(action(node, 'Copy URL', context.capabilities.copy, () => captured.url, text => context.copy(text), 'Copied source URL').remove);
            linkNodes.set(source.key, owned);
          }
          owned.title.textContent = source.title; owned.title.href = source.url; owned.location.textContent = source.url; owned.group.textContent = source.group; owned.group.hidden = !source.group;
          if (list.children[index] !== owned.node) list.insertBefore(owned.node, list.children[index] || null);
          remaining.delete(source.key);
        });
        for (const key of remaining) { const node = linkNodes.get(key)!; node.remove.forEach(remove => remove()); node.node.remove(); linkNodes.delete(key); }
        const allIds = responseIds(current, args); const ids = allIds.slice(0, MAX_RESPONSE_IDS); const oldRefs = new Set(referenceNodes.keys());
        refsNote.textContent = allIds.length > MAX_RESPONSE_IDS ? `First ${MAX_RESPONSE_IDS} response IDs mentioned; full text below.` : 'Response IDs mentioned:';
        for (const id of ids) {
          if (!referenceNodes.has(id)) {
            const item = doc.createElement('span'); const label = doc.createElement('code'); label.textContent = id; item.append(label);
            const control = action(item, 'Copy response ID', context.capabilities.copy, () => id, text => context.copy(text), 'Copied response ID');
            refs.append(item); referenceNodes.set(id, { node: item, remove: control.remove });
          }
          oldRefs.delete(id);
        }
        for (const id of oldRefs) { const item = referenceNodes.get(id)!; item.remove(); item.node.remove(); referenceNodes.delete(id); }
        refs.hidden = !ids.length;
        if (current !== previousText || description.base !== previousBase || args.mode !== previousMode) {
          previousText = current; previousBase = description.base; previousMode = args.mode;
          if (args.mode === 'raw') { const text = doc.createElement('pre'); text.textContent = current; output.replaceChildren(text); }
          else {
            const rendered = context.markdown(current || 'No text returned yet.');
            for (const anchor of rendered.querySelectorAll('a[href]')) {
              const href = anchor.getAttribute('href')!;
              let safe = httpUrl(href);
              if (!safe && description.base && !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('//')) { try { safe = httpUrl(new URL(href, description.base).href); } catch { /* leave inert */ } }
              if (safe) anchor.setAttribute('href', safe); else anchor.removeAttribute('href');
            }
            output.replaceChildren(rendered);
          }
        }
      },
      dispose() {
        unregister(); unregisterSources(); copy.remove(); popout.remove(); removeLinks();
        for (const node of linkNodes.values()) node.remove.forEach(remove => remove());
        for (const node of referenceNodes.values()) node.remove();
        linkNodes.clear(); referenceNodes.clear();
      },
    };
  },
};
export default plugin;
