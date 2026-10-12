import { CardPluginCatalog, type CatalogReport, type ExecutablePluginHost } from './pi/card-plugins/catalog';
import type { PluginSettings } from './pi/card-plugins/declarative';

/** Background startup/configuration loading with same-request coalescing and stale reporting guards. */
export function installCardPluginLoading(catalog: CardPluginCatalog, host: {
  config(): PluginSettings;
  read(name: string): Promise<string>;
  executable: ExecutablePluginHost;
  loading(): void;
  complete(report: CatalogReport, errors: string): void;
}) {
  let generation = 0; let signature: string | undefined; let disposed = false;
  let pending: { signature: string; promise: Promise<void> } | undefined;
  const reload = (force = false): Promise<void> => {
    if (disposed) return Promise.resolve();
    const config = host.config(); const next = JSON.stringify(config);
    if (pending?.signature === next) return pending.promise;
    if (!force && signature === next) return Promise.resolve();
    const current = ++generation; signature = next; host.loading();
    let errors = '';
    const promise = catalog.reload(config, host.read, message => { errors = message; }, host.executable).then(report => {
      if (!disposed && generation === current && report) host.complete(report, errors);
    }).catch(error => {
      if (!disposed && generation === current) host.complete({ personalLoaded: 0, cacheHits: 0, manifestLoaded: 0 }, String(error));
    }).finally(() => { if (pending?.promise === promise) pending = undefined; });
    pending = { signature: next, promise }; return promise;
  };
  return { reload, dispose() { disposed = true; generation++; catalog.dispose(); } };
}
