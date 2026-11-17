import { CardPluginCatalog, type CatalogReport, type ExecutablePluginHost } from './pi/card-plugins/catalog';
import type { PluginSettings } from './pi/card-plugins/declarative';

export interface CardPluginLoadResult { report?: CatalogReport; error?: string; }

/** Background startup/configuration loading with same-request coalescing and stale reporting guards. */
export function installCardPluginLoading(catalog: CardPluginCatalog, host: {
  config(): PluginSettings;
  read(name: string): Promise<string>;
  executable: ExecutablePluginHost;
  loading(): void;
  complete(report: CatalogReport, errors: string): void;
}) {
  let generation = 0; let signature: string | undefined; let disposed = false;
  let last: CardPluginLoadResult | undefined;
  let pending: { signature: string; promise: Promise<CardPluginLoadResult> } | undefined;
  const reload = (force = false): Promise<CardPluginLoadResult> => {
    if (disposed) return Promise.resolve({ error: 'Card plugin loader was disposed' });
    const config = host.config(); const next = JSON.stringify(config);
    if (pending?.signature === next) return pending.promise;
    if (!force && signature === next && last) return Promise.resolve(last);
    const current = ++generation; signature = next; host.loading();
    let errors = '';
    const promise = catalog.reload(config, host.read, message => { errors = message; }, host.executable).then(report => {
      if (disposed || generation !== current || !report) return { error: 'Card plugin reload was superseded or disposed' };
      last = { report, ...(errors ? { error: errors } : {}) };
      host.complete(report, errors);
      return last;
    }).catch(error => {
      const message = String(error);
      if (!disposed && generation === current) {
        last = { error: message };
        host.complete({ personalLoaded: 0, cacheHits: 0, manifestLoaded: 0 }, message);
      }
      return { error: message };
    }).finally(() => { if (pending?.promise === promise) pending = undefined; });
    pending = { signature: next, promise }; return promise;
  };
  return { reload, dispose() { disposed = true; generation++; catalog.dispose(); } };
}
