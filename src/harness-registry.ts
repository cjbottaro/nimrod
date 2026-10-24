import { savedDraftScope } from './draft-scope';
import { registerCardRenderer } from './card-renderers';
import { registerHarnessAction } from './keybindings';
import type { HarnessProjectHost, HarnessSessionHost } from './harness-host';
import type { HarnessProject, HarnessRegistration, HarnessSession, SessionRequest } from './harness-contract';
import type { SavedSessionIdentity } from './session-lifecycle';

/** A registration's factory return is contextually checked all the way to every required port. */
export function defineHarness<T extends HarnessRegistration>(registration: T): T { return registration; }

export function registerHarnessMetadata(registrations: readonly HarnessRegistration[]): void {
  const ids = new Set<string>(), creationActions = new Set<string>();
  for (const registration of registrations) {
    if (ids.has(registration.id)) throw new Error(`Duplicate harness registration: ${registration.id}`);
    ids.add(registration.id);
    const action = registration.creation.action;
    if (action && creationActions.has(action.id)) throw new Error(`Ambiguous harness creation action: ${action.id}`);
    if (action) creationActions.add(action.id);
  }
  for (const registration of registrations) {
    savedDraftScope(registration.id, 'registration');
    registerCardRenderer(registration.id, registration.cards);
    if (registration.creation.action) registerHarnessAction({ ...registration.creation.action, context: 'project', defaults: [] });
    for (const action of registration.actions) registerHarnessAction({ ...action, defaults: [] });
  }
}

export class HarnessRegistry {
  readonly projects: readonly HarnessProject[];
  constructor(registrations: readonly HarnessRegistration[], private readonly host: HarnessProjectHost, readonly defaultId: string, private readonly nativeInitializers: readonly (() => Promise<void>)[] = []) {
    registerHarnessMetadata(registrations);
    const ids = new Set<string>();
    this.projects = registrations.map(registration => {
      if (ids.has(registration.id)) throw new Error(`Duplicate harness registration: ${registration.id}`);
      ids.add(registration.id);
      if (!registration.creation.modes.includes(registration.creation.defaultMode)) throw new Error(`Harness creation default is unsupported: ${registration.id}`);
      const project = registration.create(host);
      if (project.id !== registration.id) throw new Error(`Harness factory changed registration identity: ${registration.id}`);
      if (project.creation !== registration.creation) throw new Error(`Harness factory changed creation capabilities: ${registration.id}`);
      return project;
    });
    this.get(defaultId);
  }
  get(id: string): HarnessProject {
    const project = this.projects.find(project => project.id === id);
    if (!project) throw new Error(`Harness is not registered: ${id}`);
    return project;
  }
  forReference(reference: SavedSessionIdentity): HarnessProject {
    const matches = this.projects.filter(project => project.saved.accepts(reference));
    if (matches.length !== 1) throw new Error(matches.length ? 'Saved identity has multiple harness owners' : 'Saved identity has no registered harness');
    return matches[0];
  }
  assertIdentity(project: HarnessProject, session: HarnessSession): void {
    const { identity, key, draftScope } = session.lifecycle;
    if (!identity) {
      if (key !== undefined || draftScope !== undefined) throw new Error('An integration published persistence keys without a durable identity');
      return;
    }
    if (!project.saved.accepts(identity) || project.saved.key(identity) !== key || project.saved.draftScope(identity) !== draftScope)
      throw new Error('Integration identity, project key and draft scope disagree');
  }
  create(project: HarnessProject, host: HarnessSessionHost, request: SessionRequest): HarnessSession {
    if (!this.projects.includes(project)) throw new Error('Harness project is not registered');
    if (request.mode === 'resume') {
      if (!project.saved.accepts(request.reference)) throw new Error('Saved identity belongs to another harness');
    } else {
      if (!project.creation.modes.includes(request.mode)) throw new Error(`${project.label} does not support ${request.mode} sessions`);
      if (request.initialName !== undefined && !project.creation.named) throw new Error(`${project.label} does not support initial naming`);
    }
    const session = project.create(host, request);
    this.assertIdentity(project, session);
    return {
      get lifecycle() { return session.lifecycle; },
      get conversation() { return session.conversation; },
      get presentation() { return session.presentation; },
      get configuration() { return session.configuration; },
      get restart() { return session.restart; },
      get close() { return session.close; },
      get drafts() { return session.drafts; },
      get selection() { return session.selection; },
      get interactions() { return session.interactions; },
      get references() { return session.references; },
      actions: {
        current() {
          const actions = session.actions.current();
          for (const action of actions) registerHarnessAction({ ...action, context: 'session', defaults: [] });
          return actions;
        },
        control: id => session.actions.control(id),
      },
    };
  }
  async initialize(): Promise<void> {
    for (const initialize of this.nativeInitializers) void Promise.resolve().then(initialize).catch(error => this.host.notice({ id: 'native-initialization', operation: 'Initialize native owners', message: String(error) }));
    // Preserve the default/native host's blocking boot contract. Other owners
    // report source-local failures themselves and do not gate the application.
    for (const project of this.projects.filter(project => project.initialization.blocking)) await project.initialization.run();
    for (const project of this.projects.filter(project => !project.initialization.blocking)) void Promise.resolve().then(() => project.initialization.run()).catch(error => this.host.notice({ id: `harness-init:${project.id}`, operation: `Initialize ${project.label}`, message: String(error) }));
  }
  dispose(): void { for (const project of this.projects) project.dispose(); }
}
