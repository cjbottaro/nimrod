import { webUrl, displayWebUrl } from '../card-plugin-ui';
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

/** Literal command extraction only: no shell parsing, rewriting or inferred execution semantics. */
function permissionCommands(tool: Readonly<AcpRecord>): string[] | undefined {
  if (tool.kind !== 'execute' || !tool.rawInput || typeof tool.rawInput !== 'object' || Array.isArray(tool.rawInput)) return;
  const input = tool.rawInput as AcpRecord;
  let commands: string[] = [];
  for (const key of ['command', 'cmd']) {
    const command = input[key];
    if (command !== undefined && typeof command !== 'string') return;
    if (typeof command === 'string' && command.trim() && !commands.includes(command)) commands.push(command);
  }
  if (input.commands !== undefined) {
    if (!Array.isArray(input.commands) || !input.commands.every(command => typeof command === 'string' && command.trim())) return;
    const listed = input.commands as string[];
    // Drop duplicate scalar aliases, but preserve repetitions/order inside a command list.
    commands = commands.filter(command => !listed.includes(command));
    commands.push(...listed);
  }
  return commands.length ? commands : undefined;
}

function appendPermissionRaw(document: Document, region: HTMLElement, tool: Readonly<AcpRecord>): void {
  const raw = document.createElement('details'); raw.className = 'acp-permission-raw';
  const heading = document.createElement('summary'); heading.textContent = 'Raw details';
  const identity = document.createElement('small'); identity.textContent = `Tool call: ${String(tool.toolCallId)}`;
  const pre = document.createElement('pre'); pre.textContent = toolValueText(tool);
  raw.append(heading, identity, pre); region.append(raw);
}
/** Permission details are not a card-plugin surface: choices remain session-owned. */
export function renderPermissionDetails(document: Document, tool: Readonly<AcpRecord>): HTMLElement {
  const region = document.createElement('div');
  const input = tool.rawInput && typeof tool.rawInput === 'object' && !Array.isArray(tool.rawInput) ? tool.rawInput as AcpRecord : undefined;
  const url = tool.kind === 'fetch' ? webUrl(input?.url) : undefined;
  if (url) {
    const summary = document.createElement('div'); summary.className = 'acp-permission-summary';
    const label = document.createElement('strong'); label.textContent = 'Fetch';
    const detail = document.createElement('span'); detail.className = 'acp-permission-description'; detail.textContent = displayWebUrl(url);
    summary.append(label, document.createTextNode(' · '), detail); region.append(summary);
    appendPermissionRaw(document, region, tool);
    return region;
  }
  const commands = permissionCommands(tool);
  if (commands) {
    const summary = document.createElement('div'); summary.className = 'acp-permission-summary';
    const label = document.createElement('strong'); label.textContent = 'Run command'; summary.append(label);
    const input = tool.rawInput as AcpRecord;
    const description = typeof tool.title === 'string' && tool.title.trim() ? tool.title : typeof input.description === 'string' ? input.description : '';
    if (description.trim() && description.trim().toLowerCase() !== 'run command') {
      const separator = document.createElement('span'); separator.textContent = ' · '; separator.setAttribute('aria-hidden', 'true');
      const detail = document.createElement('span'); detail.className = 'acp-permission-description'; detail.textContent = description;
      summary.append(separator, detail);
    }
    region.append(summary);
    for (const command of commands) {
      const pre = document.createElement('pre'); pre.className = 'acp-permission-command'; pre.tabIndex = 0; pre.setAttribute('aria-label', 'Command');
      const code = document.createElement('code'); code.textContent = command; pre.append(code); region.append(pre);
    }
    appendPermissionRaw(document, region, tool);
    return region;
  }
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
