import { invoke } from '@tauri-apps/api/core';
import { piHarness } from './pi/integration';
import { copilotHarness } from './copilot/integration';
import { codexHarness } from './codex/integration';
import { HarnessRegistry, registerHarnessMetadata } from './harness-registry';
import type { HarnessProjectHost } from './harness-host';

/** The only product composition list. New integrations implement the contracts
 * and add one registration here; shared consumers never enumerate harnesses.
 */
export const bundledHarnesses = [piHarness, copilotHarness, codexHarness] as const;
// Also available in Settings/reference windows, before any project is created.
registerHarnessMetadata(bundledHarnesses);
export function createBundledHarnessRegistry(host: HarnessProjectHost): HarnessRegistry {
  return new HarnessRegistry(bundledHarnesses, host, 'pi', [async () => {
    // Dormant ACP has no product creation UI, but window reload still reaps its
    // previously owned child. Its configured adapter factory is acp/integration.ts.
    try { await invoke('stop_acp'); }
    catch (error) { if (host.current()) host.notice({ id: 'acp-startup', operation: 'Clean up agents', message: `Could not finish legacy agent cleanup; other harnesses remain available. ${String(error)}` }); }
  }]);
}
