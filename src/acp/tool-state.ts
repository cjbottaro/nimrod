import { immutableSnapshot } from '../pi/immutable-snapshot';
import type { AcpRecord } from './connection';

/** ACP optional tool-update fields use null/omission for "unchanged", not deletion. */
export function patchTool(previous: Readonly<AcpRecord> | undefined, update: Readonly<AcpRecord>): AcpRecord {
  const next: AcpRecord = { ...previous };
  for (const [key, value] of Object.entries(update)) if (value !== null && value !== undefined) next[key] = value;
  return immutableSnapshot(next);
}

export function toolValueText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '';
}

/** Permission details are not a card-plugin surface: choices remain session-owned. */
export function renderPermissionDetails(document: Document, tool: Readonly<AcpRecord>): HTMLElement {
  const region = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = typeof tool.title === 'string' ? tool.title : `Permission for tool ${String(tool.toolCallId)}`;
  region.append(title);
  const identity = document.createElement('small');
  identity.textContent = `Tool call: ${String(tool.toolCallId)}`;
  region.append(identity);
  let details = false;
  for (const [key, label] of [['rawInput', 'Inputs'], ['content', 'Operation content'], ['locations', 'Locations']] as const) {
    const value = tool[key];
    if (value === undefined || value === null || Array.isArray(value) && !value.length) continue;
    const section = document.createElement('div');
    const heading = document.createElement('span'); heading.textContent = label;
    const pre = document.createElement('pre'); pre.textContent = toolValueText(value);
    section.append(heading, pre); region.append(section); details = true;
  }
  if (!details) {
    const note = document.createElement('p'); note.textContent = 'The agent did not supply additional operation details.'; region.append(note);
  }
  return region;
}
