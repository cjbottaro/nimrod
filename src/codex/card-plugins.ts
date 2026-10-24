import type { CardPlugin, CardPresentation, ToolCardData } from '../card-plugin-api';
import { definePresentationPlugin, rawToolPresentation, shellPresentation, displayFilePath } from '../card-plugin-ui';
import { isRecord } from '../json-rpc-connection';
/** Native Codex tool records use the same public presentation components as plugins. */
export const codexToolPlugin: CardPlugin = definePresentationPlugin<ToolCardData>({
  id: 'nimrod.codex.tool', supports: data => data.source?.backend === 'codex',
  mount: context => ({
    update: data => {
      const native = isRecord(data.native) ? data.native : {};
      const raw = rawToolPresentation(data);
      if (native.type === 'commandExecution') return shellPresentation({ title: 'Run command', command: typeof native.command === 'string' ? native.command : undefined, sections: raw.sections });
      if (native.type === 'fileChange' && Array.isArray(native.changes)) {
        const sections: CardPresentation['sections'] = native.changes.filter(isRecord).filter(change => typeof change.path === 'string' && typeof change.diff === 'string').map((change, index) => ({ key: `file:${index}`, label: displayFilePath(change.path as string, context.projectDirectory), text: change.diff as string, format: 'diff' as const }));
        // Only server terminal status claims application. Pending changes remain requested edits.
        return { title: native.status === 'completed' ? 'Changed files' : native.status === 'failed' || native.status === 'declined' ? 'File changes not completed' : 'Requested file changes',
          preview: `${sections.length} ${sections.length === 1 ? 'file' : 'files'}`, rawInputsPlacement: 'after', sections: sections.length ? sections : raw.sections };
      }
      return raw;
    },
    dispose() {},
  }),
});
