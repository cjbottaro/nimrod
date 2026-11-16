import defaultLayout from './ui-templates/layout.html?raw';
import defaultLayoutCss from './ui-templates/layout.css?raw';
import defaultProjectBar from './ui-templates/project-bar.html?raw';
import defaultProjectBarCss from './ui-templates/project-bar.css?raw';

/** Experimental public v1 presentation API. No expressions, evaluation or shell access. */
export interface UiTemplateFiles {
  layout?: string;
  layoutCss?: string;
  projectBar?: string;
  projectBarCss?: string;
}
export const bundledUiTemplates = { layout: defaultLayout, layoutCss: defaultLayoutCss, projectBar: defaultProjectBar, projectBarCss: defaultProjectBarCss };
export interface ProjectBarValues {
  'project.name': string;
  'project.parent': string;
  'project.path': string;
  'session.present': boolean;
  'session.title': string;
  'session.badge': string;
  'session.badgeTitle': string;
  'session.harness': string;
}
const initialValues: ProjectBarValues = {
  'project.name': 'Choose a project', 'project.parent': '', 'project.path': '',
  'session.present': false, 'session.title': '', 'session.badge': '', 'session.badgeTitle': '', 'session.harness': '',
};
const actionIds = { sidebar: 'toggle-sidebar', reload: 'reload-session', delete: 'delete-session', settings: 'open-settings' } as const;
export type ProjectBarAction = keyof typeof actionIds;
const parts = new Set(['project-identity', 'project-name', 'workspace-label', 'project-session', 'project-session-separator', 'project-session-name', 'mode-badge']);
const tags = new Set(['DIV', 'HEADER', 'FOOTER', 'MAIN', 'SECTION', 'NAV', 'ASIDE', 'SPAN', 'P', 'SMALL', 'STRONG', 'EM', 'B', 'I', 'BR', 'BUTTON', 'SVG', 'PATH', 'CIRCLE', 'LINE', 'POLYLINE', 'RECT', 'G', 'NIMROD-SLOT']);
const attributes = new Set(['class', 'role', 'title', 'hidden', 'type', 'name', 'tabindex', 'disabled', 'viewbox', 'width', 'height', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'd', 'cx', 'cy', 'r', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'rx', 'points', 'transform',
  'data-nimrod-action', 'data-nimrod-part', 'data-nimrod-text', 'data-nimrod-title', 'data-nimrod-visible', 'data-nimrod-sidebar-layout', 'data-nimrod-sidebar-side']);

function parse(document: Document, html: string, region: 'layout' | 'project-bar'): DocumentFragment {
  if (html.length > 256 * 1024) throw new Error('Template exceeds 256 KiB');
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const element of template.content.querySelectorAll('*')) {
    if (!tags.has(element.tagName.toUpperCase())) throw new Error(`Unsupported template element: ${element.tagName}`);
    for (const attribute of element.attributes) {
      if (!attributes.has(attribute.name.toLowerCase()) && !/^aria-[a-z-]+$/.test(attribute.name)) throw new Error(`Unsupported template attribute: ${attribute.name}`);
      if (['fill', 'stroke'].includes(attribute.name) && /url\s*\(|\\/i.test(attribute.value)) throw new Error('SVG external paint resources are not supported');
    }
    if (region === 'layout' && [...element.attributes].some(a => a.name.startsWith('data-nimrod-') && !['data-nimrod-sidebar-layout', 'data-nimrod-sidebar-side'].includes(a.name))) throw new Error('Bindings and actions belong in the Project bar template');
    if (region === 'project-bar' && (element.tagName === 'NIMROD-SLOT' || element.hasAttribute('data-nimrod-sidebar-layout') || element.hasAttribute('data-nimrod-sidebar-side'))) throw new Error('Layout slots belong in the layout template');
    if (element.tagName === 'BUTTON' && !element.hasAttribute('data-nimrod-action')) throw new Error('Template buttons require a named action');
  }
  return template.content;
}

/** CSSOM scopes each selector (including comma lists), preserving media/supports rules.
 * CSS is trusted local presentation, not a sandbox. No imports, resources or global rules.
 */
function scopedCss(document: Document, css: string, scope: string): string {
  if (css.length > 256 * 1024) throw new Error('Stylesheet exceeds 256 KiB');
  // Comments cannot disguise resource loading; escapes are outside the initial API.
  const checked = css.replace(/\/\*[\s\S]*?\*\//g, '');
  if (/\\|url\s*\(|image-set\s*\(|@import/i.test(checked)) throw new Error('Template CSS does not support escapes or external resources');
  const style = document.createElement('style'); style.textContent = css; style.media = 'not all';
  // A non-matching media sheet is parseable in WebKit and jsdom without applying it.
  document.head.append(style);
  const sheet = style.sheet;
  if (!sheet) { style.remove(); throw new Error('Could not parse template CSS'); }
  const serialize = (rules: CSSRuleList): string => [...rules].map(rule => {
    if (rule.type === 1) {
      const value = rule as CSSStyleRule;
      if ('cssRules' in value && (value as CSSStyleRule & { cssRules: CSSRuleList }).cssRules.length) throw new Error('Nested style rules are not supported');
      return `:where(${scope}):is(${value.selectorText}), :where(${scope}) :is(${value.selectorText}) { ${value.style.cssText} }`;
    }
    if (rule.type === 4 || rule.type === 12) {
      const group = rule as CSSGroupingRule;
      return `${rule.cssText.slice(0, rule.cssText.indexOf('{'))}{${serialize(group.cssRules)}}`;
    }
    throw new Error('Template CSS supports only style, @media and @supports rules');
  }).join('\n');
  try { return serialize(sheet.cssRules); } finally { style.remove(); }
}

interface Binding { element: HTMLElement; key: keyof ProjectBarValues; kind: 'text' | 'title' | 'visible'; }
function prepareProjectBar(document: Document, html: string) {
  const fragment = parse(document, html, 'project-bar'), bindings: Binding[] = [];
  const actions = Object.fromEntries(Object.keys(actionIds).map(name => [name, document.createElement('button')])) as Record<ProjectBarAction, HTMLButtonElement>;
  const seenActions = new Set<string>(), seenParts = new Set<string>();
  for (const element of fragment.querySelectorAll<HTMLElement>('*')) {
    const part = element.dataset.nimrodPart;
    if (part !== undefined) {
      if (!parts.has(part) || seenParts.has(part)) throw new Error(`Unknown or duplicate Project bar part: ${part}`);
      seenParts.add(part); element.id = part;
    }
    const action = element.dataset.nimrodAction;
    if (action !== undefined) {
      if (!Object.hasOwn(actionIds, action) || seenActions.has(action) || element.tagName !== 'BUTTON') throw new Error(`Unknown, duplicate or non-button Project bar action: ${action}`);
      seenActions.add(action); actions[action as ProjectBarAction] = element as HTMLButtonElement;
    }
    for (const kind of ['text', 'title', 'visible'] as const) {
      const key = element.getAttribute(`data-nimrod-${kind}`);
      if (key === null) continue;
      if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml') throw new Error('Bindings require HTML elements; SVG is static presentation');
      if (!Object.hasOwn(initialValues, key) || (kind === 'visible') !== (key === 'session.present')) throw new Error(`Invalid ${kind} binding: ${key}`);
      if (kind === 'text' && element.childElementCount) throw new Error('Text bindings must be leaf elements');
      bindings.push({ element, key: key as keyof ProjectBarValues, kind });
    }
  }
  for (const name of Object.keys(actions) as ProjectBarAction[]) {
    const button = actions[name]; button.id = actionIds[name]; button.type = 'button';
    // These are behavior components; authors customize their contents, not their semantics.
    button.setAttribute('aria-label', { sidebar: 'Toggle session sidebar', reload: 'Reload session', delete: 'Delete session', settings: 'Project settings' }[name]);
    if (name === 'reload' || name === 'delete') button.disabled = true;
  }
  actions.sidebar.setAttribute('aria-controls', 'session-sidebar');
  actions.sidebar.setAttribute('aria-expanded', 'false');
  return { fragment, actions, bindings };
}

function prepareLayout(document: Document, html: string) {
  const fragment = parse(document, html, 'layout');
  const slots = new Map<string, Element>();
  for (const element of fragment.querySelectorAll('nimrod-slot')) {
    const name = element.getAttribute('name') ?? '';
    if (!['project-bar', 'session-sidebar', 'sidebar-resizer', 'content'].includes(name) || slots.has(name) || element.childNodes.length) throw new Error(`Invalid or duplicate layout slot: ${name}`);
    slots.set(name, element);
  }
  if (slots.size !== 4) throw new Error('Layout requires project-bar, session-sidebar, sidebar-resizer and content slots exactly once');
  const groups = fragment.querySelectorAll<HTMLElement>('[data-nimrod-sidebar-layout]');
  if (groups.length !== 1) throw new Error('Layout requires one data-nimrod-sidebar-layout container');
  const group = groups[0];
  if (!['left', 'right'].includes(group.dataset.nimrodSidebarSide ?? 'left')) throw new Error('Sidebar side must be left or right');
  for (const name of ['session-sidebar', 'sidebar-resizer', 'content']) if (slots.get(name)!.parentElement !== group) throw new Error(`${name} must be a direct child of the sidebar layout container`);
  if (group.contains(slots.get('project-bar')!)) throw new Error('Project bar must be outside the sidebar layout container');
  group.id = 'workspace-layout'; group.classList.add('sidebar-layout');
  return { fragment, slots, group };
}

/** Mount once before session/Settings listeners acquire nodes. No runtime remount or observer. */
export function installUiTemplates(document: Document, files: UiTemplateFiles = {}, report: (message: string) => void = () => {}) {
  const choose = <T>(name: string, custom: () => T, fallback: () => T): T => {
    try { return custom(); } catch (error) { report(`${name}: ${String(error)}. Using the bundled default. Fix the files and reopen the window.`); return fallback(); }
  };
  const layout = choose('Layout template', () => ({ ...prepareLayout(document, files.layout ?? defaultLayout), css: scopedCss(document, files.layoutCss ?? defaultLayoutCss, '#workspace-shell') }),
    () => ({ ...prepareLayout(document, defaultLayout), css: scopedCss(document, defaultLayoutCss, '#workspace-shell') }));
  const bar = choose('Project bar template', () => ({ ...prepareProjectBar(document, files.projectBar ?? defaultProjectBar), css: scopedCss(document, files.projectBarCss ?? defaultProjectBarCss, '#workspace-bar') }),
    () => ({ ...prepareProjectBar(document, defaultProjectBar), css: scopedCss(document, defaultProjectBarCss, '#workspace-bar') }));
  const host = document.getElementById('workspace-shell');
  const sidebar = document.getElementById('session-sidebar'), resizer = document.getElementById('sidebar-resizer'), content = document.getElementById('workspace-content');
  if (!host || !sidebar || !resizer || !content) throw new Error('Missing Nimrod workspace mount points');
  const projectBar = document.createElement('header'); projectBar.id = 'workspace-bar'; projectBar.append(bar.fragment);
  for (const [name, node] of Object.entries({ 'project-bar': projectBar, 'session-sidebar': sidebar, 'sidebar-resizer': resizer, content })) layout.slots.get(name)!.replaceWith(node);
  // Validation is complete before existing owned components are moved into the new shell.
  const storageError = document.getElementById('storage-error');
  host.replaceChildren(layout.fragment);
  if (storageError) document.body.append(storageError);
  const style = document.createElement('style'); style.dataset.nimrodUiTemplates = ''; style.textContent = `${layout.css}\n${bar.css}`; document.head.append(style);
  const values = { ...initialValues };
  const update = (patch: Partial<ProjectBarValues>) => {
    Object.assign(values, patch);
    for (const { element, key, kind } of bar.bindings) {
      const value = values[key];
      if (kind === 'visible') { if (element.hidden === !!value) element.hidden = !value; }
      else if (kind === 'title') { if (element.title !== value) element.title = String(value); }
      else if (element.textContent !== value) element.textContent = String(value);
    }
  };
  update({});
  return { actions: bar.actions, update, sidebarSide: () => layout.group.dataset.nimrodSidebarSide === 'right' ? 'right' as const : 'left' as const,
    dispose() { style.remove(); } };
}
