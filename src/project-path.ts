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
