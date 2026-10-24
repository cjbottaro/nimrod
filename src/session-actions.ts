import type { HarnessAction, HarnessSession } from './harness-contract';
/** Actions are integration contributions, not inferred from configuration names or harness IDs. */
export function availableSessionActions(session: Pick<HarnessSession, 'actions' | 'configuration'>, cancel: () => Promise<void>): readonly HarnessAction[] {
  const actions = session.actions.current(), configuration = session.configuration.current();
  return configuration?.cancel && configuration.operations.some(operation => operation.cancellable)
    ? [...actions, { id: 'cancel-configuration', label: 'Cancel pending configuration change', detail: 'Withdraw configuration that has not been dispatched', run: cancel }]
    : actions;
}
