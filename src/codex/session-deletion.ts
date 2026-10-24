import type { SessionDeletionContext, SessionDeletionSource } from '../session-deletion-operation';
import type { CodexDeletionTree } from './deletion-tree';
import { codexScope } from './session-lifecycle';
export interface CodexDeletionHistory {
  readonly supportsDeletion: boolean;
  previewTree(rootId: string, signal: AbortSignal): Promise<CodexDeletionTree>;
  reserveDeletion(operationId: string, rootId: string, ids: readonly string[]): Promise<void>;
  stopDeletionOwners(operationId: string): Promise<void>;
  deleteTree(rootId: string, confirmed: (id: string) => void): Promise<void>;
  finishDeletion(operationId: string, uncertain: boolean): Promise<void>;
}
/** Shared review/coordination, concrete Codex inventory, native guard and recursive API. */
export function codexSessionDeletion(history: () => CodexDeletionHistory | undefined, context: SessionDeletionContext): SessionDeletionSource {
  return {
    pending: false,
    operation(reference, title) {
      if (!('kind' in reference) || reference.kind !== 'codex') return;
      const rootId = reference.sessionId, scope = codexScope(rootId);
      return {
        target: { key: scope, draftScope: scope }, label: 'Delete Codex thread tree…', detail: 'Review this persisted thread and its spawned descendants',
        get supported() { return !!history()?.supportsDeletion; },
        get unavailableReason() { return history()?.supportsDeletion ? undefined : 'Codex deletion requires its project catalog and native ownership guards. A failed cleanup must be resolved before another deletion.'; },
        available: () => !!history()?.supportsDeletion,
        async run() {
          const source = history();
          if (!source?.supportsDeletion) throw new Error('Codex deletion is unavailable. Nothing was deleted.');
          const operationId = crypto.randomUUID(); let uncertain = false;
          try {
            context.signal.throwIfAborted(); context.loadingReview();
            let plan = await source.previewTree(rootId, context.signal);
            const scopeIds = new Set(plan.ids);
            context.lock(plan.targets, false);
            await source.reserveDeletion(operationId, rootId, [...scopeIds]);
            if (!await context.review({ id: operationId, title: 'Delete Codex thread tree', sessions: plan.review,
              description: `Permanently delete ${title} and its spawned descendants, including descendants created during review/shutdown. Stops affected Nimrod-owned agents; removes Codex rollout history/associated metadata and confirmed Nimrod drafts/references. Project files are not removed by Nimrod. External writers are not coordinated. This cannot be undone.` })) return;
            // Like Pi, confirmation covers current descendants, not just a stale review snapshot.
            for (let round = 0; ; round++) {
              if (round >= 32) throw new Error('Codex descendants did not stabilize after 32 shutdown/discovery rounds. Nothing was deleted.');
              context.signal.throwIfAborted(); context.lock(plan.targets, true); context.progress('stopping');
              await context.stop(plan.targets);
              await source.stopDeletionOwners(operationId);
              const fresh = await source.previewTree(rootId, context.signal);
              const freshIds = new Set(fresh.ids);
              if ([...scopeIds].some(id => !freshIds.has(id))) throw new Error('Codex tree membership shrank or changed during review/shutdown. Nothing was deleted; refresh before another explicit attempt.');
              const expanded = fresh.ids.some(id => !scopeIds.has(id));
              for (const id of fresh.ids) scopeIds.add(id);
              if (scopeIds.size > 10_000) throw new Error('Codex cumulative deletion scope exceeds 10,000 threads');
              plan = fresh;
              if (!expanded) break;
              await source.reserveDeletion(operationId, rootId, [...scopeIds]);
            }
            context.signal.throwIfAborted(); context.progress('deleting');
            const targets = new Map(plan.ids.map((id, index) => [id, plan.targets[index]]));
            const unexpected = new Set<string>();
            uncertain = true; // Acknowledgement loss must never cause a second delete request.
            await source.deleteTree(rootId, id => {
              const target = targets.get(id);
              if (target) context.removed([target]); else unexpected.add(id);
            });
            uncertain = false;
            context.removed(plan.targets);
            if (unexpected.size) context.error(`Codex reported ${unexpected.size} additional deleted descendants beyond its final inventory. Known removals were reconciled; unverified local references were retained. External writers are not excluded.`);
          } catch (error) {
            throw new Error(`Codex tree deletion did not fully complete: ${String(error)}. Only authoritative removals were reconciled; unconfirmed identities/drafts remain. Nothing was retried.`);
          } finally {
            // On uncertainty the catalog process must exit before native guards release.
            // A stop failure retains the reservation instead of advertising safe reuse.
            await source.finishDeletion(operationId, uncertain);
          }
        },
      };
    },
  };
}
