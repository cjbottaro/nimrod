import { JSDOM } from 'jsdom';
import { SessionDrafts } from '../src/session-drafts';
import { SessionRecency } from '../src/session-recency';
import type { HarnessProjectHost, HarnessSessionHost } from '../src/harness-host';
import type { ConversationViewMessage } from '../src/conversation-view-host';
import type { ApplicationNotice } from '../src/application-notices';

export function harnessHostFixture(library = new SessionDrafts(undefined, undefined, () => {}), id = 'fixture-panel') {
  const dom = new JSDOM('<main></main>');
  const publications: ConversationViewMessage[] = [], notices: ApplicationNotice[] = [], stored = new Map<string, unknown>();
  const log = { enabled: false, append() {} };
  let current = true, selected = true, changed = 0;
  const host: HarnessSessionHost = {
    id, project: '/fixture', ownership: { starting: false, ended: true }, drafts: library.fork(), transcriptLog: log,
    performance: { measure: (_kind, work) => work(), record() {} },
    lifetime: { current: () => current, selected: () => selected, settingsOpen: () => false, closing: () => false, restarting: () => false, deleting: () => false, available: () => current, conflicts: () => false },
    effects: { publish: message => publications.push(message), title: () => 'Fixture session', changed: () => { changed++; }, identified() {}, retire() {}, input() {}, attention() {},
      notice: notice => notices.push(notice), resolve() {}, connection: message => notices.push({ id: 'connection', operation: 'Connect', message }), hasConnectionOutcome: () => false, storageFailure: error => { throw error; } },
    ui: { document: dom.window.document, root: dom.window.document.querySelector('main')!,
      palette: { startSelection: () => undefined, startInspection: () => undefined, startRetainedSelection: () => undefined },
      dialogs: { choose: async () => undefined, input: async () => undefined, confirm: async () => false, cancel() {} },
      canPresent: () => current && selected, focusComposer() {}, withDialog: (action, title) => action(title) },
  };
  host.drafts.select(`unassigned:${id}`);
  const project: HarnessProjectHost = {
    project: () => '/fixture', current: () => current, applicationReady: () => true, deletionPending: () => false, runtime: () => ({}),
    store: { read: key => stored.get(key), save: (key, value) => { stored.set(key, value); } },
    recency: () => new SessionRecency(undefined), open: () => [], participants: () => [], drafts: () => library, transcriptLog: log,
    changed: () => { changed++; }, notice: notice => notices.push(notice), resolve() {},
  };
  return { host, project, library, publications, notices, dom, changes: () => changed,
    retire: () => { current = false; }, select: (value: boolean) => { selected = value; } };
}
