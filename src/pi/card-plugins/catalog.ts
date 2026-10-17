import { bundledAcpPlugin } from '../../acp/card-plugins';
import { pluginTargets, matchesTarget, pluginKinds, targetSpecificity } from '../../card-plugin-targets';
import { immutableSnapshot } from '../immutable-snapshot';
import type { CardPluginTarget } from '../../card-plugin-api';
import type { CardRenderer } from '../card-renderer';
import { presentationPlugin, type DomCardRenderer } from '../dom-card-renderer';
import type { ToolCardRenderer, ToolCardBlock } from '../tool-card';
import { defaultToolRenderer, rawToolPresentation } from './tool';
import { bundledToolRenderer } from './registry';
import { normalizedToolName } from './tool-input';
import { declarativeRenderer, parsePluginPackage, type PluginSettings } from './declarative';
import { parseExecutableManifest, importCardModule, executableRenderer, personalRenderer } from './executable';

export interface PersonalBundles {
  entries: string[];
  plugins: { entry: string; source: string; cacheHit: boolean }[];
  warnings: string[];
}
export interface CatalogReport { personalLoaded: number; cacheHits: number; manifestLoaded: number; }
export interface ExecutablePluginHost {
  loadPersonal?(): Promise<PersonalBundles>;
  readModule(name: string, expectedManifest: string): Promise<string>;
  importModule?(source: string): Promise<unknown>;
}
interface Entry { tools: string[]; kinds?: readonly string[]; renderer: DomCardRenderer<ToolCardBlock>; file: string; executable: boolean; personal?: boolean; targets?: readonly CardPluginTarget[]; }
function targetMetadata(renderer: DomCardRenderer<ToolCardBlock>) {
  const targets = pluginTargets(renderer.targets), kinds = pluginKinds(renderer.kinds);
  if (kinds.length && !targets.some(target => target.backend === 'acp')) throw new Error('Tool kinds require an ACP target');
  return { targets, kinds };
}
export class CardPluginCatalog {
  private generation = 0;
  private enabled = new Set<string>();
  private trusted = new Set<string>();
  private personal = new Set<string>();
  private autoLoad = true;
  private config: PluginSettings = { files: [], overrides: {}, trusted: [] };
  private packages = new Map<string, Entry>();

  async reload(config: PluginSettings, read: (name: string) => Promise<string>, report: (message: string) => void, host?: ExecutablePluginHost): Promise<CatalogReport | undefined> {
    const generation = ++this.generation;
    this.autoLoad = config.autoLoad !== false;
    this.enabled = new Set(config.files); this.trusted = new Set(config.trusted ?? []);
    const packages = new Map<string, Entry>();
    const errors: string[] = [];
    for (const file of config.files) {
      try {
        const text = await read(file);
        if (generation !== this.generation) return;
        if (new TextEncoder().encode(text).length > 256 * 1024) throw new Error('Card manifest exceeds 256 KiB');
        if (JSON.parse(text)?.apiVersion === 2) {
          const manifest = parseExecutableManifest(text);
          if (packages.has(manifest.id)) throw new Error(`Duplicate renderer ID ${manifest.id}`);
          if (!config.trusted?.includes(file)) throw new Error('Executable plugin requires explicit cards.trustedPlugins opt-in');
          if (!host) throw new Error('Executable module host unavailable');
          const source = await host.readModule(file, text);
          if (generation !== this.generation) return;
          const module = await (host.importModule ?? importCardModule)(source);
          if (generation !== this.generation) return;
          const renderer = executableRenderer(manifest, module);
          packages.set(manifest.id, { tools: manifest.tools, renderer, file, executable: true, ...targetMetadata(renderer) });
        } else {
          const pkg = parsePluginPackage(text);
          if (packages.has(pkg.id)) throw new Error(`Duplicate renderer ID ${pkg.id}`);
          const declaration = declarativeRenderer(pkg);
          const withRaw: CardRenderer<ToolCardBlock> = { ...declaration, mount() {
            const instance = declaration.mount();
            return { update(value) { const presentation = instance.update(value); return { ...presentation, sections: [...presentation.sections, ...rawToolPresentation(value).sections] }; }, dispose: () => instance.dispose() };
          } };
          packages.set(pkg.id, { tools: pkg.tools, renderer: presentationPlugin(withRaw), file, executable: false });
        }
      } catch (error) { errors.push(`${file}: ${String(error)}`); }
    }
    let personalLoaded = 0; let cacheHits = 0;
    const manifestLoaded = packages.size;
    if (this.autoLoad && host?.loadPersonal) {
      try {
        const result = await host.loadPersonal();
        if (generation !== this.generation) return;
        this.personal = new Set(result.entries);
        errors.push(...result.warnings);
        for (const item of result.plugins) {
          try {
            if (generation !== this.generation) return;
            const module = await (host.importModule ?? importCardModule)(item.source);
            if (generation !== this.generation) return;
            const { renderer, tools } = personalRenderer(module);
            if (packages.has(renderer.id)) throw new Error(`Duplicate renderer ID ${renderer.id}`);
            packages.set(renderer.id, { renderer, tools, file: item.entry, executable: true, personal: true, ...targetMetadata(renderer) });
            personalLoaded++; if (item.cacheHit) cacheHits++;
          } catch (error) { errors.push(`${item.entry}: ${String(error)}`); }
        }
      } catch (error) {
        if (generation !== this.generation) return;
        this.personal.clear(); errors.push(`Personal plugins: ${String(error)}`);
      }
    } else if (!this.autoLoad) this.personal.clear();
    if (generation !== this.generation) return;
    this.config = config; this.packages = packages;
    report(errors.join('\n'));
    return { personalLoaded, cacheHits, manifestLoaded };
  }

  dispose(): void { this.generation++; this.enabled.clear(); this.trusted.clear(); this.personal.clear(); this.packages.clear(); }

  /** Reload updates permissions before publishing replacement entries. Retained
   * entries must use current permissions for every managed callback. */
  private callbacksAllowed(entry: Entry): boolean {
    return !entry.executable || (entry.personal
      ? this.autoLoad && this.personal.has(entry.file)
      : this.enabled.has(entry.file) && this.trusted.has(entry.file));
  }

  select(data: Readonly<ToolCardBlock>): ToolCardRenderer {
    const name = normalizedToolName(data.name);
    // Existing tool-only overrides belong to Pi. ACP never inherits a Pi match.
    const override = data.source?.backend === 'acp' ? undefined : Object.hasOwn(this.config.overrides, name) ? this.config.overrides[name] : undefined;
    if (override === 'nimrod.raw') return presentationPlugin({ id: 'nimrod.raw', supports: () => true, mount: () => ({ update: rawToolPresentation, dispose() {} }) });
    const bundled = data.source?.backend === 'acp' ? bundledAcpPlugin(data) : bundledToolRenderer(data);
    if (override === bundled.id || override === 'nimrod.tool') return override === 'nimrod.tool' ? presentationPlugin(defaultToolRenderer) : bundled;
    // ACP categories are intentionally broad. Select applicable candidates in a
    // deterministic order, then latch the chosen instance for its whole lifetime.
    // Pi's legacy first-name/explicit-override behavior is unchanged.
    const acp = data.source?.backend === 'acp';
    const matchesMetadata = (entry: Entry) => matchesTarget(entry.targets ?? [{ backend: 'pi' }], data)
      && (entry.tools.includes(name) || acp && !!entry.kinds?.includes(data.kind || 'other'));
    const candidates = [...this.packages.values()].filter(matchesMetadata);
    if (acp) candidates.sort((a, b) => targetSpecificity(b.targets ?? [], data) - targetSpecificity(a.targets ?? [], data)
      || Number(b.tools.includes(name)) - Number(a.tools.includes(name)));
    let snapshot: Readonly<ToolCardBlock> | undefined;
    const applicable = (entry: Entry) => {
      if (!this.callbacksAllowed(entry)) return false;
      if (!entry.renderer.matches) return true;
      try {
        const result: unknown = entry.renderer.matches(snapshot ??= immutableSnapshot(data));
        if (result && typeof (result as { then?: unknown }).then === 'function') {
          void Promise.resolve(result).catch(() => {}); // A rejected async matcher must not escape containment.
          return false;
        }
        return result === true;
      } catch { return false; } // Faulty selection cannot disable unrelated cards/plugins.
    };
    const entry = override ? this.packages.get(override) : candidates.find(applicable);
    if (entry && matchesMetadata(entry)) {
      if (!entry.executable) return entry.renderer;
      // Fixed renderer selection, but managed work must still honor current package trust.
      return { ...entry.renderer, supports: value => this.callbacksAllowed(entry) && entry.renderer.supports(value) };
    }
    if (override) return { apiVersion: 2, id: override, supports: () => false, mount() { throw new Error('Missing or incompatible renderer'); } };
    return bundled;
  }
}
