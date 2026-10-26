// Compiled by tsconfig.json (test is included), never executed as a Node test.
// An unused @ts-expect-error fails compilation if a mandatory boundary becomes optional.
import { defineHarness } from '../src/harness-registry';
import type { HarnessAction, HarnessProject, HarnessRegistration, HarnessSession } from '../src/harness-contract';
import { fixtureHarness } from './fixtures/fixture-harness';

type OptionalKeys<T> = { [K in keyof T]-?: {} extends Pick<T, K> ? K : never }[keyof T];
const sessionPortsAreRequired: OptionalKeys<HarnessSession> extends never ? true : false = true;
const projectPortsAreRequired: OptionalKeys<HarnessProject> extends never ? true : false = true;
const registrationPortsAreRequired: OptionalKeys<HarnessRegistration> extends never ? true : false = true;
const completeRegistration: HarnessRegistration = fixtureHarness;
void [sessionPortsAreRequired, projectPortsAreRequired, registrationPortsAreRequired, completeRegistration];

function compileAssertions(session: HarnessSession, project: HarnessProject, registration: HarnessRegistration): void {
  const { lifecycle, ...withoutLifecycle } = session;
  // @ts-expect-error A factory cannot register a session without lifecycle ownership.
  defineHarness({ ...registration, create: () => ({ ...project, create: () => withoutLifecycle }) });
  const { conversation, ...withoutConversation } = session;
  // @ts-expect-error Core input/output cannot be omitted or supplied by the project shell.
  const missingConversation: HarnessSession = withoutConversation;
  const { naming, ...withoutNaming } = session;
  // @ts-expect-error Every factory must supply an executable naming consumer port.
  defineHarness({ ...registration, create: () => ({ ...project, create: () => withoutNaming }) });
  // @ts-expect-error An unsupported flag cannot replace an explicit rejecting implementation.
  const unsupportedNaming: HarnessSession['naming'] = { supported: false };
  void naming; void unsupportedNaming;
  const { deletion, ...withoutDeletion } = session;
  // @ts-expect-error Every factory must explicitly declare mounted-session removal semantics.
  const missingDeletion: HarnessSession = withoutDeletion;
  const { reload, ...withoutReload } = session;
  // @ts-expect-error Every factory must supply the reload consumer port.
  defineHarness({ ...registration, create: () => ({ ...project, create: () => withoutReload }) });
  // @ts-expect-error A silent unsupported flag cannot stand in for reload behavior.
  const unsupportedReload: HarnessSession['reload'] = { supported: false, reason: 'Forgot reload' };
  const { run, ...withoutRun } = reload;
  // @ts-expect-error Even unavailable states require an explicit execution contract.
  const missingReloadRun: HarnessSession['reload'] = withoutRun;
  const { interactions, ...withoutInteractions } = session;
  // @ts-expect-error Even an integration without rich decisions must explicitly choose noInteractions.
  const missingInteractions: HarnessSession = withoutInteractions;
  const { actions, ...withoutProjectActions } = project;
  // @ts-expect-error Project contributions must choose an executable port or explicit noProjectActions.
  defineHarness({ ...registration, create: () => withoutProjectActions });
  const { cards, ...withoutCards } = registration;
  // @ts-expect-error A registration must choose specialized or generic card presentation.
  defineHarness(withoutCards);
  // @ts-expect-error Metadata alone is not an executable session action.
  const emptyAction: HarnessAction = { id: 'model', label: 'Model', detail: 'Missing implementation' };
  // @ts-expect-error Completion/receipt semantics require the asynchronous submission contract.
  const incorrectInput: HarnessSession['conversation']['messageInput'] = { capabilities: () => ({}), submit() {} };
  void [lifecycle, conversation, reload, run, unsupportedReload, missingReloadRun, interactions, actions, cards, missingConversation, missingInteractions, emptyAction, incorrectInput];
}
void compileAssertions;
