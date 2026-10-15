import type { CardPresentation, ToolCardData } from '../../card-plugin-api';
import { argumentRecord, filePath, fieldCountPreview } from './tool-input';
import { rawToolPresentation, toolPlugin } from './tool-shared';

export function readInputPreview(args: unknown, complete = true): string | undefined {
  const record = argumentRecord(args);
  const path = filePath(record);
  if (!path) return fieldCountPreview(args, complete);
  const offset = record?.offset;
  const limit = record?.limit;
  if (offset !== undefined && (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 1)) return path;
  if (limit !== undefined && (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1)) return path;
  const start = typeof offset === 'number' ? offset : 1;
  if (typeof limit === 'number' && Number.isSafeInteger(limit) && limit > 0 && Number.isSafeInteger(start + limit - 1)) {
    return `${path} · lines ${start}–${start + limit - 1}`;
  }
  return start > 1 ? `${path} · from line ${start}` : path;
}

export function readPresentation(data: Readonly<ToolCardData>): CardPresentation {
  return { ...rawToolPresentation(data), preview: readInputPreview(data.arguments, data.toolStatus !== undefined) };
}

export default toolPlugin('nimrod.read', ['read'], readPresentation);
