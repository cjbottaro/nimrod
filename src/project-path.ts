/** Display-only home abbreviation; match directory boundaries, never sibling prefixes. */
export function abbreviateHome(path: string, home?: string): string {
  if (!home) return path;
  const root = home.replace(/[\\\\/]+$/, '');
  if (!root) return path;
  if (path === root) return '~';
  if (path.startsWith(root) && /^[\\\\/]/.test(path.slice(root.length))) return '~' + path.slice(root.length);
  return path;
}

/** Display-only splitting of canonical paths. Never changes routing/search identity. */
export function projectPathParts(path: string): { name: string; parent: string } {
  // Preserve filesystem roots instead of inventing a directory name or parent.
  if (/^(?:\/|[a-z]:[\\/])$/i.test(path) || /^\\\\[^\\]+\\[^\\]+\\?$/.test(path)) {
    return { name: path, parent: '' };
  }
  const trimmed = path.replace(/[\\/]+$/, '');
  const separator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (separator < 0) return { name: trimmed || path, parent: '' };
  const parent = separator === 0 || separator === 2 && /^[a-z]:/i.test(trimmed)
    ? trimmed.slice(0, separator + 1) : trimmed.slice(0, separator);
  return { name: trimmed.slice(separator + 1), parent };
}
