import type { CardRenderer, CardPresentation, CardSection } from '../card-renderer';
import type { ToolCardBlock } from '../tool-card';

export interface PluginSettings { files: string[]; overrides: Record<string, string>; trusted?: string[]; }
export interface PluginPackage {
  apiVersion: 1;
  id: string;
  tools: string[];
  title?: string;
  preview?: string;
  sections: { key: string; label: string; template: string; format?: 'text' | 'diff' }[];
}
const identifier = /^[a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)+$/;
const toolName = /^[a-z0-9_-]+$/;
const fileName = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function readPluginSettings(settings: Record<string, unknown>): PluginSettings {
  const files = settings['cards.plugins'] ?? [];
  const overrides = settings['cards.renderers'] ?? {};
  const trusted = settings['cards.trustedPlugins'] ?? [];
  if (!Array.isArray(trusted) || trusted.length > 50 || trusted.some(file => typeof file !== 'string' || file.length > 128 || !fileName.test(file)) || new Set(trusted).size !== trusted.length) throw new Error('cards.trustedPlugins must contain at most 50 unique manifest filenames.');
  if (!Array.isArray(files) || files.length > 50 || files.some(file => typeof file !== 'string' || file.length > 128 || !fileName.test(file)) || new Set(files).size !== files.length) throw new Error('cards.plugins must contain at most 50 unique JSON filenames (no paths).');
  if (!object(overrides) || Object.keys(overrides).length > 100 || Object.entries(overrides).some(([name, id]) => !toolName.test(name) || typeof id !== 'string' || !identifier.test(id))) throw new Error('cards.renderers must map normalized tool names to renderer IDs.');
  return { files: [...files], overrides: { ...overrides } as Record<string, string>, trusted: [...trusted] };
}

function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unknown card plugin field');
}
function template(value: unknown, optional = false): void {
  if (optional && value === undefined) return;
  if (typeof value !== 'string' || value.length > 16_384) throw new Error('Invalid card template');
  const stripped = value.replace(/\{\{(\/[^{}]*)\}\}/g, (_match, pointer: string) => {
    if (pointer.length > 512 || pointer.split('/').slice(1).some(part => /~(?![01])/.test(part) || ['__proto__', 'constructor', 'prototype'].includes(part.replace(/~1/g, '/').replace(/~0/g, '~')))) throw new Error('Invalid template JSON pointer');
    return '';
  });
  if (stripped.includes('{{') || stripped.includes('}}')) throw new Error('Invalid template placeholder');
}

export function parsePluginPackage(text: string): PluginPackage {
  if (new TextEncoder().encode(text).length > 256 * 1024) throw new Error('Card plugin exceeds 256 KiB');
  const value: unknown = JSON.parse(text);
  if (!object(value)) throw new Error('Card plugin must be a JSON object');
  keys(value, ['apiVersion', 'id', 'tools', 'title', 'preview', 'sections']);
  if (value.apiVersion !== 1) throw new Error('Unsupported card plugin API version');
  if (typeof value.id !== 'string' || !identifier.test(value.id) || value.id.startsWith('nimrod.')) throw new Error('Invalid or reserved card plugin ID');
  if (!Array.isArray(value.tools) || !value.tools.length || value.tools.length > 50 || value.tools.some(name => typeof name !== 'string' || !toolName.test(name)) || new Set(value.tools).size !== value.tools.length) throw new Error('Invalid card plugin tool matching');
  template(value.title, true); template(value.preview, true);
  if (!Array.isArray(value.sections) || value.sections.length > 32) throw new Error('Invalid card plugin sections');
  const ids = new Set<string>();
  for (const section of value.sections) {
    if (!object(section)) throw new Error('Invalid card plugin section');
    keys(section, ['key', 'label', 'template', 'format']);
    if (typeof section.key !== 'string' || !section.key || section.key.length > 128 || ids.has(section.key)) throw new Error('Invalid/duplicate card section key');
    ids.add(section.key); template(section.label); template(section.template);
    if (section.format !== undefined && !['text', 'diff'].includes(String(section.format))) throw new Error('External tool sections support text or diff only');
  }
  return value as unknown as PluginPackage;
}

function substitute(source: string, data: Readonly<ToolCardBlock>): string {
  return source.replace(/\{\{(\/[^{}]*)\}\}/g, (_match, pointer: string) => {
    let value: unknown = data;
    for (const raw of pointer.split('/').slice(1)) {
      const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
      if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return '';
      value = (value as Record<string, unknown>)[key];
    }
    if (value === undefined || value === null) return '';
    return typeof value === 'string' ? value : JSON.stringify(value);
  });
}

/** No eval, JS modules, remote resources, DOM, CSS or action permissions. */
export function declarativeRenderer(pkg: PluginPackage): CardRenderer<ToolCardBlock> {
  return { id: pkg.id, supports: () => true, mount: () => ({
    update(data): CardPresentation {
      const sections: CardSection[] = pkg.sections.map(section => ({ key: `plugin:${section.key}`, label: substitute(section.label, data), text: substitute(section.template, data), format: section.format }));
      const presentation = { title: pkg.title === undefined ? typeof data.name === 'string' ? data.name : 'tool' : substitute(pkg.title, data),
        preview: pkg.preview === undefined ? undefined : substitute(pkg.preview, data), sections };
      const size = presentation.title.length + (presentation.preview?.length || 0) + sections.reduce((sum, section) => sum + section.label.length + section.text.length, 0);
      if (size > 2 * 1024 * 1024) throw new Error('Expanded card plugin presentation exceeds 2 Mi characters');
      return presentation;
    }, dispose() {},
  }) };
}
