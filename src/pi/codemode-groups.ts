import type { RenderBlock as ContentBlock, RenderMessage as DisplayMessage } from '../conversation-view-host';
import { toolMessageBlock } from './tool-call';
import { normalizedToolName } from './card-plugins/tool-input';

export function rowTool(message: DisplayMessage): ContentBlock | undefined {
  if (message.role === 'tool') return toolMessageBlock(message);
  if (message.role === 'assistant' && Array.isArray(message.content) && message.content.length === 1 && message.content[0]?.type === 'toolCall') return message.content[0];
  return undefined;
}
export function isPiCodemode(block: ContentBlock): boolean {
  return (!block.source || block.source.backend === 'pi') && normalizedToolName(block.name) === 'codemode';
}
interface RecordedCall { id: string; name: string; arguments?: unknown; status?: string; error?: string; }
function recordedCalls(value: unknown): { calls: RecordedCall[]; complete: boolean } {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const calls = Array.isArray(record.calls) ? record.calls.filter((call): call is RecordedCall => !!call && typeof call === 'object'
    && typeof call.id === 'string' && typeof call.name === 'string') : [];
  return { calls, complete: record.complete !== false };
}
interface Group {
  card: HTMLDetailsElement;
  children: HTMLElement;
  count: HTMLElement;
  bar: HTMLProgressElement;
  recorded: Map<string, RecordedCall>;
  records?: unknown;
  complete: boolean;
  fallback: Map<string, HTMLElement>;
  fallbackSources: Map<string, RecordedCall>;
  note: HTMLElement;
}

/** Mounted composition only. Canonical Pi messages remain flat and authoritative.
 * Output deltas touch only their own group; structural reconciliation owns placement/pruning.
 */
export class CodemodeGroups {
  private blocks = new Map<string, ContentBlock>();
  private members = new Map<string, Map<string, ContentBlock>>();
  private groups = new Map<string, Group>();

  constructor(private readonly renderRecorded: (block: ContentBlock) => HTMLDetailsElement) {}

  update(block: ContentBlock, card: HTMLDetailsElement): void {
    if (typeof block.id !== 'string' || !block.id || block.source && block.source.backend !== 'pi') return;
    if (!block.parentToolCallId && !isPiCodemode(block) && !this.blocks.has(block.id)) return;
    const previous = this.blocks.get(block.id);
    this.blocks.set(block.id, block);
    if (previous?.parentToolCallId && previous.parentToolCallId !== block.parentToolCallId) this.members.get(previous.parentToolCallId)?.delete(block.id);
    if (block.parentToolCallId) {
      let members = this.members.get(block.parentToolCallId);
      if (!members) this.members.set(block.parentToolCallId, members = new Map());
      members.set(block.id, block);
      this.refresh(block.parentToolCallId);
    }
    if (!isPiCodemode(block) || block.parentToolCallId) return;
    let group = this.groups.get(block.id);
    if (!group || group.card !== card) {
      const doc = card.ownerDocument;
      const children = doc.createElement('div'); children.className = 'codemode-children';
      const count = doc.createElement('span'); count.className = 'codemode-count';
      const bar = doc.createElement('progress'); bar.className = 'codemode-progress';
      bar.setAttribute('aria-label', 'Completed calls out of calls discovered so far');
      card.querySelector('.tool-card-summary')!.append(count, bar);
      card.querySelector(':scope > summary')!.after(children);
      card.classList.add('codemode-group');
      const note = doc.createElement('div'); note.className = 'codemode-incomplete'; note.textContent = 'Pi retained an incomplete call record.'; note.hidden = true; children.append(note);
      group = { card, children, count, bar, recorded: new Map(), complete: true, fallback: new Map(), fallbackSources: new Map(), note };
      this.groups.set(block.id, group);
    }
    if (group.records !== block.nestedCalls) {
      const snapshot = recordedCalls(block.nestedCalls);
      group.records = block.nestedCalls; group.recorded = new Map(snapshot.calls.map(call => [call.id, call])); group.complete = snapshot.complete;
    }
    this.refresh(block.id);
  }

  /** Called only for full/structural paints. Missing parents stay visible in normal flow. */
  placements(rows: readonly DisplayMessage[], nodes: ReadonlyMap<string, { node: HTMLElement }>): Map<string, HTMLElement> {
    const present = new Set<string>();
    const result = new Map<string, HTMLElement>();
    for (const row of rows) { const block = rowTool(row); if (typeof block?.id === 'string') present.add(block.id); }
    for (const [id, group] of this.groups) if (!present.has(id)) { group.children.replaceChildren(); this.groups.delete(id); this.members.delete(id); }
    for (const [id, block] of this.blocks) if (!present.has(id)) {
      if (block.parentToolCallId) this.members.get(block.parentToolCallId)?.delete(id);
      this.blocks.delete(id);
    }
    for (const [id, members] of this.members) if (!members.size && !this.groups.has(id)) this.members.delete(id);
    for (const row of rows) {
      const block = rowTool(row);
      const group = block?.parentToolCallId && this.groups.get(block.parentToolCallId);
      if (group && row.key && nodes.has(row.key)) result.set(row.key, group.children);
    }
    for (const [id, group] of this.groups) {
      // Persisted nestedCalls contains bounded inputs/status, not child output.
      // A real live child always wins; never fabricate output or parse truncated previews.
      for (const [callId, node] of group.fallback) if (!group.recorded.has(callId) || this.members.get(id)?.has(callId)) {
        // A live row may already have adopted this exact registry-owned shell.
        if (node.parentElement === group.children) node.remove();
        group.fallback.delete(callId); group.fallbackSources.delete(callId);
      }
      for (const call of group.recorded.values()) {
        if (this.members.get(id)?.has(call.id)) continue;
        if (group.fallbackSources.get(call.id) === call) continue;
        const settled = call.status === 'ok' || call.status === 'error';
        const node = this.renderRecorded({
          type: 'toolCall', id: call.id, name: call.name, parentToolCallId: id,
          arguments: call.arguments,
          toolStatus: settled ? 'finished' : undefined,
          isError: call.status === 'error', uiPhase: settled ? undefined : 'stopped',
          // A retained error is actual data; missing result bodies stay absent.
          resultOutput: typeof call.error === 'string' ? call.error : undefined,
        });
        group.fallbackSources.set(call.id, call); group.fallback.set(call.id, node);
        if (node.parentElement !== group.children) group.children.append(node);
      }
      this.refresh(id);
    }
    return result;
  }

  private refresh(id: string): void {
    const group = this.groups.get(id), parent = this.blocks.get(id);
    if (!group || !parent) return;
    const calls = new Map<string, { done: boolean; failed: boolean; stopped: boolean }>();
    for (const call of group.recorded.values()) calls.set(call.id, { done: call.status === 'ok' || call.status === 'error', failed: call.status === 'error', stopped: false });
    for (const [callId, block] of this.members.get(id) ?? []) calls.set(callId, {
      done: block.toolStatus === 'finished' || block.toolStatus === 'result', failed: block.isError === true, stopped: block.uiPhase === 'stopped',
    });
    const values = [...calls.values()];
    const done = values.filter(call => call.done).length, failed = values.filter(call => call.failed).length, stopped = values.filter(call => call.stopped && !call.done).length;
    const live = (!parent.toolStatus || parent.toolStatus === 'running') && parent.uiPhase !== 'stopped';
    if (group.note.hidden !== group.complete) group.note.hidden = group.complete;
    const total = `${calls.size}${group.complete ? '' : '+'}`;
    const text = [live ? `${done}/${total} calls` : `${total} ${calls.size === 1 && group.complete ? 'call' : 'calls'}`, failed ? `${failed} failed` : '', stopped ? `${stopped} stopped` : ''].filter(Boolean).join(' · ');
    if (group.count.textContent !== text) group.count.textContent = text;
    group.count.classList.toggle('codemode-failures', failed > 0);
    if (group.bar.hidden === live) group.bar.hidden = !live;
    if (group.bar.max !== Math.max(1, calls.size)) group.bar.max = Math.max(1, calls.size);
    if (group.bar.value !== done) group.bar.value = done;
    const summary = group.card.querySelector(':scope > summary')!;
    const status = parent.isError ? 'failed' : parent.uiPhase === 'stopped' ? 'stopped' : parent.uiPhase === 'thinking' ? 'thinking' : live ? 'running' : 'completed';
    const label = `Codemode · ${text} (${status})`;
    if (summary.getAttribute('aria-label') !== label) summary.setAttribute('aria-label', label);
  }

  clear(): void { this.blocks.clear(); this.members.clear(); this.groups.clear(); }
}
