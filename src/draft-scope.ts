/** App-owned draft keys, never paths to harness history or filesystem authority.
 * Namespaced identities are opaque to shared consumers. Keep the existing wire
 * encoding so adopting this contract does not migrate saved drafts.
 */
const reserved = new Set(['file', 'unassigned', 'temporary', 'demo', 'legacy']);
const validNamespace = (name: string) => /^[a-z]/.test(name) && !/[^a-z0-9-]/.test(name);
export const MAX_DRAFT_SCOPE_BYTES = 32768;
// Rust strings contain Unicode scalar values; reject unpaired JS surrogates too.
const scalarString = (value: string) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(new TextEncoder().encode(value)) === value;
const bounded = (key: string) => new TextEncoder().encode(key).length <= MAX_DRAFT_SCOPE_BYTES && scalarString(key);

export function savedDraftScope(integration: string, identity: string): string {
  if (!validNamespace(integration) || reserved.has(integration) || !identity.length || !scalarString(identity)) throw new Error('Invalid saved draft identity');
  const key = `${integration}:${JSON.stringify(identity)}`;
  if (!bounded(key)) throw new Error('Invalid saved draft scope');
  return key;
}

export function isSavedDraftScope(key: string): boolean {
  if (!bounded(key)) return false;
  const separator = key.indexOf(':');
  if (separator < 1) return false;
  const name = key.slice(0, separator), identity = key.slice(separator + 1);
  if (name === 'file') return identity.length > 0;
  if (!validNamespace(name) || reserved.has(name)) return false;
  try { const value: unknown = JSON.parse(identity); return typeof value === 'string' && value.length > 0 && scalarString(value); }
  catch { return false; }
}

export function isPersistentDraftScope(key: string): boolean {
  return isSavedDraftScope(key) || key.startsWith('unassigned:') && key.length > 'unassigned:'.length && bounded(key);
}
