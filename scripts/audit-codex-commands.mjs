#!/usr/bin/env node
// Source-only inventory/diff. Never launches Codex or invokes a command.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { createHash } from 'node:crypto';

const options = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, index, all) => {
  if (index % 2 === 0) { if (!arg.startsWith('--') || !all[index + 1]) throw new Error('Use --source ROOT --protocol GENERATED --version VERSION [--baseline JSON] [--out JSON]'); pairs.push([arg.slice(2), all[index + 1]]); }
  return pairs;
}, []));
if (!options.source || !options.protocol || !options.version) throw new Error('Required: --source, --protocol, --version');
const root = resolve(options.source), protocol = resolve(options.protocol);
const hash = text => createHash('sha256').update(text).digest('hex');
const read = path => readFileSync(join(root, path), 'utf8');
const enumPath = 'codex-rs/tui/src/slash_command.rs', source = read(enumPath);
const body = /pub enum SlashCommand\s*\{([\s\S]*?)\n\}/.exec(source)?.[1];
if (!body) throw new Error('SlashCommand enum shape changed; review the extractor.');
const commands = [], names = new Set(); let attributes = [];
for (const raw of body.split('\n')) {
  const line = raw.trim();
  if (!line || line.startsWith('//')) continue;
  if (line.startsWith('#[')) { attributes.push(line); continue; }
  const match = /^(\w+),$/.exec(line); if (!match) throw new Error(`Unknown enum syntax: ${line}`);
  const variant = match[1], attrs = attributes.join(' '); attributes = [];
  const labels = [...attrs.matchAll(/(?:serialize|to_string)\s*=\s*"([^"]+)"/g)].map(match => match[1]);
  const canonical = /to_string\s*=\s*"([^"]+)"/.exec(attrs)?.[1] ?? labels[0] ?? variant.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  if (names.has(canonical)) throw new Error(`Duplicate command: ${canonical}`); names.add(canonical);
  // Retain every match arm mentioning the variant, including description, busy,
  // inline-argument, side-conversation and visibility policies. Human review is
  // still required: source hashes surface changes this conservative parser misses.
  const arms = source.split(/(?<=,)\n/).filter(arm => arm.includes(`SlashCommand::${variant}`)).join('\n');
  commands.push({ variant, name: canonical, aliases: labels.filter(label => label !== canonical), policyHash: hash(arms) });
}
const files = ['codex-rs/tui/src/slash_command.rs', 'codex-rs/tui/src/bottom_pane/slash_commands.rs',
  'codex-rs/tui/src/chatwidget/slash_dispatch.rs', 'codex-rs/tui/src/chatwidget/slash_command_args.rs',
  'codex-rs/app-server/src/request_processors/thread_processor.rs'];
const evidence = Object.fromEntries(files.map(path => [path, hash(read(path))]));
const request = readFileSync(join(protocol, 'ClientRequest.ts'), 'utf8');
const methods = [...request.matchAll(/"method":\s*"([^"]+)"/g)].map(match => match[1]);
if (!methods.length || new Set(methods).size !== methods.length) throw new Error('ClientRequest method shape changed; review the extractor.');
const schemaHashes = {};
function schemas(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) schemas(path);
    else if (entry.name.endsWith('.ts')) schemaHashes[relative(protocol, path)] = hash(readFileSync(path, 'utf8'));
  }
}
schemas(protocol);
const snapshot = { version: options.version, sourceTag: `rust-v${options.version}`, commands, methods, evidence, schemaHashes,
  dynamicCatalogs: ['model-advertised service-tier command names', 'user presets/custom prompts', 'skill mentions (not builtin slash commands)'] };
if (options.baseline) {
  const previous = JSON.parse(readFileSync(options.baseline, 'utf8'));
  const diff = (before, after) => ({ added: Object.keys(after).filter(key => !(key in before)), removed: Object.keys(before).filter(key => !(key in after)), changed: Object.keys(after).filter(key => key in before && JSON.stringify(after[key]) !== JSON.stringify(before[key])) });
  const changes = { versions: [previous.version, snapshot.version],
    commands: diff(Object.fromEntries(previous.commands.map(command => [command.name, command])), Object.fromEntries(commands.map(command => [command.name, command]))),
    methods: diff(Object.fromEntries(previous.methods.map(method => [method, true])), Object.fromEntries(methods.map(method => [method, true]))),
    source: diff(previous.evidence, evidence), schemas: diff(previous.schemaHashes, schemaHashes) };
  console.log(JSON.stringify(changes, null, 2));
} else console.log(JSON.stringify({ version: snapshot.version, builtinCount: commands.length, commands: commands.map(command => ({ name: command.name, aliases: command.aliases })), methodCount: methods.length }, null, 2));
if (options.out) writeFileSync(options.out, JSON.stringify(snapshot, null, 2) + '\n');
