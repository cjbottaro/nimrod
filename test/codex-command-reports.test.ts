import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { mcpServer, mcpReport, projectEntry, skillReport, hookReport, terminal, terminalReport } from '../src/codex/command-reports';
import audit from '../.agents/skills/slash-commands/references/codex-audit-0.164.0.json' with { type: 'json' };

test('Codex reports preserve literal native labels without inferring executable commands', () => {
  const server = mcpServer({ name: '<literal>', authStatus: 'notLoggedIn', runtimeStatus: 'authenticationRequired',
    tools: { query: { description: 'Read **literal** data' } }, toolsError: null, resources: [{ name: 'Resource', uri: 'fixture://resource' }], resourceTemplates: [] });
  assert.match(mcpReport([server], true), /<literal>/); assert.match(mcpReport([server], true), /Read \*\*literal\*\*/);
  assert.match(mcpReport([server], true), /fixture:\/\/resource/);
  assert.doesNotMatch(mcpReport([server], false), /fixture:\/\/resource/);
  assert.match(terminalReport([terminal({ itemId: 'item', processId: 'process', command: 'sleep 1', cwd: '/fixture' })]), /sleep 1/);
});
test('Codex skills/hooks reports explicitly expose only a read-only subset and retain diagnostics', () => {
  const skills = projectEntry({ data: [{ cwd: '/fixture', skills: [{ name: 'review', description: 'Review changes', path: '/skills/review', enabled: false }],
    errors: [{ path: '/skills/bad', message: 'Invalid metadata' }] }] }, '/fixture', 'skills');
  assert.match(skillReport(skills), /no invocation or configuration/); assert.match(skillReport(skills), /disabled/); assert.match(skillReport(skills), /Invalid metadata/);
  const hooks = projectEntry({ data: [{ cwd: '/fixture', hooks: [{ eventName: 'SessionStart', enabled: true, trustStatus: 'untrusted', handlerType: 'command', command: 'echo fixture', sourcePath: '/fixture/hooks.json' }], warnings: ['Fixture warning'], errors: [] }] }, '/fixture', 'hooks');
  assert.match(hookReport(hooks), /no.*trust changes|trust changes are not implemented/); assert.match(hookReport(hooks), /untrusted/); assert.match(hookReport(hooks), /Fixture warning/);
  assert.throws(() => projectEntry({ data: [{ cwd: '/elsewhere', skills: [], errors: [] }] }, '/fixture', 'skills'), /different project/);
  assert.throws(() => mcpServer({ name: 'bad', tools: [], resources: [], resourceTemplates: [], authStatus: 'unknown' }), /Invalid/);
});
test('pinned Codex audit accounts for every enum command and all known serialization aliases', () => {
  assert.equal(audit.commands.length, 65); assert.equal(new Set(audit.commands.map(command => command.name)).size, 65);
  assert.deepEqual(audit.commands.find(command => command.name === 'pwd')?.aliases, ['cwd']);
  assert.deepEqual(audit.commands.find(command => command.name === 'stop')?.aliases, ['clean']);
  const inventory = readFileSync('.agents/skills/slash-commands/references/codex-audit.md', 'utf8');
  for (const command of audit.commands) assert.ok(inventory.includes(`\`/${command.name}\``), `Missing audit classification: ${command.name}`);
  assert.ok(audit.methods.includes('thread/compact/start'));
});
test('source-only audit reports added/removed/changed commands and APIs without invoking Codex', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nimrod-command-audit-'));
  const source = join(directory, 'source'), protocol = join(directory, 'protocol'), baseline = join(directory, 'baseline.json');
  const write = (path: string, value: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value); };
  const script = resolve('scripts/audit-codex-commands.mjs');
  try {
    write(join(source, 'codex-rs/tui/src/slash_command.rs'), 'pub enum SlashCommand {\n    Model,\n    Removed,\n}\n');
    for (const path of ['codex-rs/tui/src/bottom_pane/slash_commands.rs', 'codex-rs/tui/src/chatwidget/slash_dispatch.rs', 'codex-rs/tui/src/chatwidget/slash_command_args.rs', 'codex-rs/app-server/src/request_processors/thread_processor.rs']) write(join(source, path), '// Fixture source\n');
    write(join(protocol, 'ClientRequest.ts'), 'export type Request = { "method": "model/list" };');
    const args = [script, '--source', source, '--protocol', protocol, '--version', 'fixture'];
    const initial = spawnSync(process.execPath, [...args, '--out', baseline], { encoding: 'utf8' }); assert.equal(initial.status, 0, initial.stderr);
    write(join(source, 'codex-rs/tui/src/slash_command.rs'), 'pub enum SlashCommand {\n    #[strum(serialize = "models")]\n    Model,\n    Added,\n}\n');
    write(join(protocol, 'ClientRequest.ts'), 'export type Request = { "method": "model/list" } | { "method": "new/api" };');
    const updated = spawnSync(process.execPath, [...args, '--baseline', baseline], { encoding: 'utf8' }); assert.equal(updated.status, 0, updated.stderr);
    const diff = JSON.parse(updated.stdout); assert.deepEqual(diff.commands.added, ['models', 'added']);
    assert.deepEqual(diff.commands.removed, ['model', 'removed']); assert.deepEqual(diff.methods.added, ['new/api']);
    assert.ok(diff.schemas.changed.includes('ClientRequest.ts'));
    write(join(source, 'codex-rs/tui/src/slash_command.rs'), 'pub enum SlashCommand {\n    Unexpected { field: String },\n}\n');
    assert.notEqual(spawnSync(process.execPath, args, { encoding: 'utf8' }).status, 0, 'unknown syntax must not silently truncate the audit');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
