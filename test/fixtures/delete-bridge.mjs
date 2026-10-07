// Disposable protocol fixture only. Never imports Pi, calls a model, or removes files.
import { appendFileSync } from 'node:fs';
const [extension, root, child, mode, log] = process.argv.slice(2);
let plan;
let buffer = '';
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
const status = (id, data) => emit({ type: 'extension_ui_request', method: 'setStatus', statusKey: 'pi-gui-delete-v1', statusText: JSON.stringify({ version: 1, id, ...data }) });
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  for (;;) {
    const end = buffer.indexOf('\n'); if (end < 0) break;
    const request = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
    appendFileSync(log, JSON.stringify(request) + '\n');
    if (request.type === 'get_commands') emit({ type: 'response', id: request.id, success: true, data: { commands: [{ name: 'pi-gui-delete', source: 'extension', sourceInfo: { path: mode === 'bad-source' ? '/unrelated.ts' : extension } }] } });
    else if (request.type === 'get_state') emit({ type: 'response', id: request.id, success: true, data: { sessionFile: mode === 'persisted' ? root : undefined, isStreaming: false } });
    else if (request.type === 'prompt') {
      if (!request.message.startsWith('/pi-gui-delete ')) throw new Error('Model prompts forbidden');
      const action = JSON.parse(request.message.slice('/pi-gui-delete '.length));
      emit({ type: 'response', id: request.id, success: true }); // Not a deletion result.
      status('wrong-correlation-id', { ok: true, results: [] });
      if (action.action === 'preview') {
        plan = 'single-use';
        status(action.id, { ok: true, token: plan, root, sessions: [{ file: root, cwd: '/fixture', title: 'Root 🦀\u2028line' }, { file: child, cwd: '/other', title: 'Child' }] });
      } else if (action.action === 'execute') {
        const token = plan; plan = undefined;
        if (!token || token !== action.token) status(action.id, { ok: false, error: 'Expired preview token' });
        else if (mode === 'disconnect') process.exit(0);
        else if (mode === 'changed') status(action.id, { ok: false, error: 'Subtree changed; nothing deleted' });
        else status(action.id, { ok: true, results: mode === 'incomplete' ? [{ file: root, deleted: true }] : [{ file: child, deleted: false, error: 'fixture permission failure' }, { file: root, deleted: true }] });
      } else throw new Error('Unexpected bridge action');
    } else throw new Error('Unexpected RPC request');
  }
});
process.stdin.on('end', () => process.exit(0));
