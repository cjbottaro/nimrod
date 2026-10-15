/** Shared argument parsing; never interpret nested or unfinished strings as preview fields. */
export function argumentRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    try { return argumentRecord(JSON.parse(value)); } catch { return partialTopLevelStrings(value); }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/**
 * Tool-call arguments stream as JSON fragments. Preserve only complete,
 * top-level string fields; incomplete escapes and nested fields are ignored.
 */
function partialTopLevelStrings(text: string): Record<string, unknown> | undefined {
  const fields: Record<string, unknown> = {};
  let index = skipWhitespace(text, 0);
  if (text[index] !== "{") return undefined;
  index++;
  while (index < text.length) {
    index = skipWhitespace(text, index);
    if (text[index] === "}") return fields;
    const key = jsonStringAt(text, index);
    if (!key) return fields;
    index = skipWhitespace(text, key.end);
    if (text[index] !== ":") return fields;
    index = skipWhitespace(text, index + 1);
    const value = jsonStringAt(text, index);
    if (value) {
      fields[key.value] = value.value;
      index = value.end;
    } else {
      const end = skipJsonValue(text, index);
      if (end === undefined) return fields;
      index = end;
    }
    index = skipWhitespace(text, index);
    if (text[index] === ",") { index++; continue; }
    if (text[index] === "}") return fields;
    return fields;
  }
  return fields;
}

function jsonStringAt(text: string, start: number): { value: string; end: number } | undefined {
  if (text[start] !== "\"") return undefined;
  let index = start + 1;
  while (index < text.length) {
    if (text[index] === "\\") { index += 2; continue; }
    if (text[index] === "\"") {
      try { return { value: JSON.parse(text.slice(start, index + 1)) as string, end: index + 1 }; } catch { return undefined; }
    }
    index++;
  }
  return undefined;
}

function skipJsonValue(text: string, start: number): number | undefined {
  if (text[start] === "\"") return jsonStringAt(text, start)?.end;
  if (text[start] !== "{" && text[start] !== "[") {
    let index = start;
    while (index < text.length && !/[\s,}\]]/.test(text[index])) index++;
    return index > start ? index : undefined;
  }
  const closing = text[start] === "{" ? "}" : "]";
  let depth = 0;
  let index = start;
  while (index < text.length) {
    if (text[index] === "\"") {
      const string = jsonStringAt(text, index);
      if (!string) return undefined;
      index = string.end;
      continue;
    }
    if (text[index] === "{" || text[index] === "[") depth++;
    if (text[index] === "}" || text[index] === "]") {
      depth--;
      if (depth === 0) return text[index] === closing ? index + 1 : undefined;
    }
    index++;
  }
  return undefined;
}

function skipWhitespace(text: string, index: number): number {
  while (index < text.length && /\s/.test(text[index])) index++;
  return index;
}

export function namedStrings(value: Record<string, unknown> | undefined, singular: string, plural: string): string | undefined {
  if (!value) return undefined;
  const parts: string[] = [];
  if (typeof value[singular] === "string" && value[singular]) parts.push(value[singular] as string);
  if (Array.isArray(value[plural])) parts.push(...value[plural].filter((entry): entry is string => typeof entry === "string" && entry.length > 0));
  return parts.join(" · ") || undefined;
}

export function firstString(value: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!value) return undefined;
  for (const key of keys) {
    if (typeof value[key] === "string" && value[key]) return value[key] as string;
  }
  return undefined;
}

export function normalizedToolName(name: unknown): string {
  return typeof name === 'string' ? name.trim().toLowerCase().split(/[.:/]/).pop() || '' : '';
}

export function fieldCountPreview(args: unknown, complete: boolean): string | undefined {
  if (!complete || args === undefined || args === '') return undefined;
  const value = argumentRecord(args);
  const count = value ? Object.keys(value).length : 0;
  return count === 1 ? '1 field' : `${count} fields`;
}

export function filePath(args: unknown): string | undefined {
  return firstString(argumentRecord(args), ['path', 'file_path', 'filePath', 'filename', 'file', 'target_path', 'targetPath']);
}

export function fileInputPreview(args: unknown, complete = true): string | undefined {
  return filePath(args) || fieldCountPreview(args, complete);
}

export function searchInputPreview(args: unknown, complete = true): string | undefined {
  if (args === undefined || args === '') return undefined;
  const record = argumentRecord(args);
  const pattern = firstString(record, ['pattern', 'query', 'search', 'glob', 'regex']);
  const path = filePath(record);
  return pattern && path ? `${pattern} in ${path}` : pattern || path || (complete ? 'Search inputs' : undefined);
}
