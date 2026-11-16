import type { CatalogReport } from './pi/card-plugins/catalog';

/** Actual results from the same operation used by palette, shortcuts and CLI. */
export interface CustomizationReloadResult {
  uiTemplates: { applied: boolean; error?: string };
  cardPlugins: { report?: CatalogReport; error?: string };
}
export interface CliCustomizationRequest { requestId: string; }
