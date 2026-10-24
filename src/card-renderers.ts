import type { ToolCardData } from './card-plugin-api';
import type { ToolCardRenderer } from './pi/tool-card';
import type { CardRenderer } from './pi/card-renderer';
import { immutableSnapshot } from './pi/immutable-snapshot';
import { defaultToolRenderer } from './pi/card-plugins/tool';

export type HarnessCardRenderer = (data: Readonly<ToolCardData>) => ToolCardRenderer;
const renderers = new Map<string, HarnessCardRenderer>();
const genericToolRenderer: CardRenderer<ToolCardData> = {
  id: 'nimrod.tool', supports: () => true,
  mount() {
    const ordinary = defaultToolRenderer.mount();
    let native: unknown, nativeText = '';
    return { update(data) {
      // The normal DOM boundary already brands snapshots; untrusted mutable
      // callers are detached instead of being memoized by their own identity.
      const snapshot = immutableSnapshot(data.native);
      if (native !== snapshot) {
        native = snapshot;
        try { nativeText = native === undefined ? '' : JSON.stringify(native, null, 2) ?? String(native); }
        catch { nativeText = String(native); }
      }
      const presentation = ordinary.update(data);
      return nativeText ? { ...presentation, sections: [...presentation.sections, { key: 'native', label: 'Native details', text: nativeText }] } : presentation;
    }, dispose: () => ordinary.dispose() };
  },
};
export function registerCardRenderer(id: string, renderer: HarnessCardRenderer): void { renderers.set(id, renderer); }
/** Unknown integrations get literal/raw recovery, never another harness's specialized renderer. */
export function selectHarnessCard(data: Readonly<ToolCardData>): ToolCardRenderer {
  return renderers.get(data.source?.backend ?? 'pi')?.(data) ?? genericToolRenderer;
}
export const genericCards: HarnessCardRenderer = () => genericToolRenderer;
