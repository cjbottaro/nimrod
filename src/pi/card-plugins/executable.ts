import type { DomCardRenderer } from '../dom-card-renderer';
import type { ToolCardBlock } from '../tool-card';

export interface ExecutableManifest { apiVersion: 2; id: string; tools: string[]; entry: string; }
export function parseExecutableManifest(text: string): ExecutableManifest {
  if (new TextEncoder().encode(text).length > 256 * 1024) throw new Error('Card manifest exceeds 256 KiB');
  const value = JSON.parse(text) as Partial<ExecutableManifest>;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['apiVersion', 'id', 'tools', 'entry'].includes(key))) throw new Error('Invalid executable card manifest');
  if (value.apiVersion !== 2) throw new Error('Unsupported card plugin API version');
  if (typeof value.id !== 'string' || !/^[a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)+$/.test(value.id) || value.id.startsWith('nimrod.')) throw new Error('Invalid or reserved card plugin ID');
  if (!Array.isArray(value.tools) || !value.tools.length || value.tools.length > 50 || value.tools.some(name => typeof name !== 'string' || !/^[a-z0-9_-]+$/.test(name)) || new Set(value.tools).size !== value.tools.length) throw new Error('Invalid executable tool matching');
  if (typeof value.entry !== 'string' || value.entry.length > 128 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:js|mjs)$/.test(value.entry)) throw new Error('Executable entry must be a local JS filename, not a path or URL');
  return value as ExecutableManifest;
}

/** Trusted, self-contained ESM. No eval or runtime TypeScript compilation. */
export async function importCardModule(source: string): Promise<unknown> {
  if (typeof source !== 'string' || new TextEncoder().encode(source).length > 1024 * 1024) throw new Error('Card module exceeds 1 MiB');
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      import(/* @vite-ignore */ url),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Card module import timed out')), 5000); }),
    ]);
  } finally { if (timer !== undefined) clearTimeout(timer); URL.revokeObjectURL(url); }
}

export function executableRenderer(manifest: ExecutableManifest, module: unknown): DomCardRenderer<ToolCardBlock> {
  const renderer = module && typeof module === 'object' ? (module as { default?: unknown }).default : undefined;
  if (!renderer || typeof renderer !== 'object') throw new Error('Card module must default-export a renderer');
  const candidate = renderer as Partial<DomCardRenderer<ToolCardBlock>>;
  if (candidate.apiVersion !== 2 || candidate.id !== manifest.id || typeof candidate.supports !== 'function' || typeof candidate.mount !== 'function') throw new Error('Card module API/identity does not match manifest');
  return candidate as DomCardRenderer<ToolCardBlock>;
}
