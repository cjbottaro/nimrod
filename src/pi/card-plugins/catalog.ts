import type { CardRenderer } from '../card-renderer';
import type { ToolCardRenderer } from '../tool-card';
import { defaultToolRenderer } from './tool';
import type { ToolCardBlock } from '../tool-card';
import { rawToolPresentation } from './tool';
import { bundledToolRenderer } from './registry';
import { declarativeRenderer, parsePluginPackage, type PluginSettings, type PluginPackage } from './declarative';

export class CardPluginCatalog {
  private generation = 0;
  private config: PluginSettings = { files: [], overrides: {} };
  private packages = new Map<string, { package: PluginPackage; renderer: CardRenderer<ToolCardBlock> }>();
  async reload(config: PluginSettings, read: (name: string) => Promise<string>, report: (message: string) => void): Promise<void> {
    const generation = ++this.generation;
    const packages = new Map<string, { package: PluginPackage; renderer: CardRenderer<ToolCardBlock> }>();
    const errors: string[] = [];
    for (const file of config.files) {
      try {
        const pkg = parsePluginPackage(await read(file));
        if (packages.has(pkg.id)) throw new Error(`Duplicate renderer ID ${pkg.id}`);
        packages.set(pkg.id, { package: pkg, renderer: declarativeRenderer(pkg) });
      } catch (error) { errors.push(`${file}: ${String(error)}`); }
    }
    if (generation !== this.generation) return;
    this.config = config; this.packages = packages;
    report(errors.join('\n'));
  }
  select(data: Readonly<ToolCardBlock>): ToolCardRenderer {
    const name = typeof data.name === 'string' ? data.name.trim().toLowerCase().split(/[.:/]/).pop() || '' : '';
    const override = Object.hasOwn(this.config.overrides, name) ? this.config.overrides[name] : undefined;
    if (override === 'nimrod.raw') return { id: 'nimrod.raw', supports: () => true, mount: () => ({ update: rawToolPresentation, dispose() {} }) };
    const bundled = bundledToolRenderer(data);
    if (override === bundled.id || override === 'nimrod.tool') {
      return override === 'nimrod.tool' ? defaultToolRenderer : bundled;
    }
    const entry = override ? this.packages.get(override) : [...this.packages.values()].find(entry => entry.package.tools.includes(name));
    if (entry && entry.package.tools.includes(name)) {
      const renderer = entry.renderer;
      // Always retain raw result sections as recovery, including historical content.
      return { ...renderer, mount() {
        const instance = renderer.mount();
        return { update(value: Readonly<ToolCardBlock>) { const presentation = instance.update(value); return { ...presentation, sections: [...presentation.sections, ...rawToolPresentation(value).sections] }; }, dispose: () => instance.dispose() };
      } };
    }
    if (override) return { id: override, supports: () => false, mount() { throw new Error('Missing or incompatible renderer'); } };
    return bundled;
  }
}
