const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const CURATED = {
  model: { description: 'Default model for future Copilot sessions.' },
  effortLevel: { description: 'Default reasoning effort for future Copilot sessions.' },
  defaultMode: { description: 'Default mode for future Copilot sessions.', options: ['interactive', 'plan', 'autopilot'] },
  contextTier: { description: 'Default context tier for future Copilot sessions.', options: ['default', 'long_context'] },
  autoTier: { description: 'Default Auto routing profile.', options: ['efficiency', 'balance', 'intelligence'] },
  defaultPermissionMode: { description: 'Default permission mode for future Copilot sessions.', options: ['manual', 'assisted', 'allow-all'] },
};

// Pinned CLI 1.0.98 compatibility snapshot. Values/descriptions/types remain
// SDK-authoritative; this supplements leaf paths collapsed by settings.get().
const NESTED_PATHS = [
  'ahpEnvironment.acceptRemoteConnections', 'ahpEnvironment.computeId', 'ahpEnvironment.name',
  'ahpEnvironment.outgoingConnections', 'ahpEnvironment.publishNewSessionsByDefault',
  'ahpEnvironment.requireConnectionBinding', 'builtInAgents.rubberDuck',
  'builtInAgents.rubberDuckAutoInvoke', 'customAgents.defaultLocalOnly',
  'dynamicRetrieval.mcp', 'dynamicRetrieval.skills', 'extensions.disabledExtensions', 'extensions.mode',
  'feature_flags.enabled', 'footer.showAgent', 'footer.showAiUsed', 'footer.showBranch',
  'footer.showCiStatus', 'footer.showCodeChanges', 'footer.showContextWindow', 'footer.showCustom',
  'footer.showDirectory', 'footer.showModelEffort', 'footer.showPullRequest', 'footer.showQuota',
  'footer.showSandbox', 'footer.showSchedules', 'footer.showUsername', 'footer.showYolo',
  'hooks.agentStop', 'hooks.errorOccurred', 'hooks.notification', 'hooks.permissionRequest',
  'hooks.postToolUse', 'hooks.postToolUseFailure', 'hooks.preCompact', 'hooks.preMcpToolCall',
  'hooks.preToolUse', 'hooks.sessionEnd', 'hooks.sessionStart', 'hooks.subagentStart',
  'hooks.subagentStop', 'hooks.userPromptSubmitted', 'hooks.userPromptTransformed',
  'ide.autoConnect', 'ide.openDiffOnEdit', 'permissions.allow', 'permissions.ask', 'permissions.deny',
  'permissions.disableAssistedPermissionsMode', 'permissions.disableBypassPermissionsMode',
  'sandbox.addCurrentWorkingDirectory', 'sandbox.allowBypass', 'sandbox.allowDevToolAccess',
  'sandbox.auth.gh', 'sandbox.auth.git', 'sandbox.credentials.envVars', 'sandbox.enabled',
  'sandbox.sandboxLspServers', 'sandbox.sandboxMcpServers',
  'sandbox.userPolicy.experimental.seatbelt.keychainAccess',
  'sandbox.userPolicy.filesystem.deniedPaths', 'sandbox.userPolicy.filesystem.readonlyPaths',
  'sandbox.userPolicy.filesystem.readwritePaths', 'sandbox.userPolicy.network.allowLocalNetwork',
  'sandbox.userPolicy.network.allowOutbound', 'sandbox.userPolicy.network.allowedHosts',
  'sandbox.userPolicy.network.blockedHosts', 'sandbox.userPolicy.network.proxy.password', 'sandbox.userPolicy.network.proxy.url',
  'sandbox.userPolicy.network.proxy.username', 'sandbox.userPolicy.seatbelt.keychainAccess',
  'sidebar.accentActiveSession', 'sidebar.coloredHints', 'sidebar.enabled', 'sidebar.hoverFocus',
  'sidebar.showCloseButton', 'sidebar.showHeaderButtons', 'sidebar.showResumableSessions',
  'statusLine.command', 'statusLine.padding', 'statusLine.refreshInterval', 'statusLine.type',
  'subagents.agents', 'subagents.contextManagementTools', 'subagents.disabledSubagents',
  'subagents.maxConcurrency', 'subagents.maxDepth', 'tabs.enabled', 'tabs.hide', 'tabs.sort',
  'telemetry.capture.identity', 'telemetry.capture.policyDetail', 'telemetry.capture.prompts',
  'telemetry.capture.responses', 'telemetry.capture.toolArguments', 'telemetry.capture.toolOutput',
  'telemetry.captureContent', 'voice.enabled', 'voice.selectedDevice.name',
  'voice.selectedDevice.occurrence', 'voice.selectedModel',
  'workflows.defaultLimits.maxAiCredits', 'workflows.defaultLimits.maxConcurrentSubagents',
  'workflows.defaultLimits.maxTotalSubagents', 'workflows.defaultLimits.timeoutSeconds',
  'workflows.logPhaseNames', 'workflows.maxConcurrentRuns',
];
const BLOCKED_FREEFORM = new Set(['sandbox.userPolicy.network.proxy.password']);

function flatten(prefix, value, paths) {
  if (!record(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const path = `${prefix}.${key}`;
    if (record(child)) flatten(path, child, paths);
    else paths.add(path);
  }
}
function getPath(value, path) {
  let current = value;
  for (const part of path.split('.')) {
    if (!record(current) || !Object.hasOwn(current, part)) return undefined;
    current = current[part];
  }
  return current;
}
function setPath(value, path, next) {
  const parts = path.split('.');
  const root = record(value) ? structuredClone(value) : {};
  let current = root;
  for (const part of parts.slice(0, -1)) {
    if (!record(current[part])) current[part] = {};
    current = current[part];
  }
  current[parts.at(-1)] = next;
  return root;
}
function parseValue(raw) {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('A value is required.');
  if (/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?)$/i.test(trimmed)
    || trimmed.startsWith('[') || trimmed.startsWith('{') || trimmed.startsWith('"')) {
    try { return JSON.parse(trimmed); }
    catch (error) { throw new Error(`Invalid JSON value: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return trimmed;
}
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

async function metadata(client) {
  const result = await client.rpc.user.settings.get();
  if (!record(result) || !record(result.settings)) throw new Error('Copilot returned invalid user settings metadata.');
  return result.settings;
}
export async function configCommand(client) {
  const settings = await metadata(client);
  const paths = new Set(Object.keys(settings));
  for (const path of NESTED_PATHS) if (Object.hasOwn(settings, path.split('.')[0])) paths.add(path);
  for (const [key, value] of Object.entries(settings)) {
    if (!record(value)) continue;
    flatten(key, value.value, paths); flatten(key, value.default, paths);
  }
  const models = await client.listModels();
  const configuredModel = typeof settings.model?.value === 'string' ? settings.model.value : undefined;
  const selectedModel = models.find(model => model.id === configuredModel);
  const values = {
    model: models.filter(model => !record(model.policy) || model.policy.state === 'enabled')
      .map(model => ({ id: model.id, label: model.name, detail: model.id })),
    effortLevel: (selectedModel?.supportedReasoningEfforts || []).map(value => ({ id: value, label: value })),
    ...Object.fromEntries(Object.entries(CURATED).filter(([, item]) => item.options)
      .map(([key, item]) => [key, item.options.map(value => ({ id: value, label: value }))])),
  };
  return {
    name: 'config', aliases: [], kind: 'client', allowDuringAgentExecution: false,
    description: 'Configure defaults for future Copilot sessions',
    input: {
      hint: '[key]', valueHint: '[value]',
      choices: [...paths].sort().map(name => ({ name, description: CURATED[name]?.description || 'Copilot setting' })),
    },
    configValues: values,
  };
}
export async function applyConfigCommand(client, input) {
  if (typeof input !== 'string') throw new Error('Usage: /config <key> <value>');
  const match = /^([^\s]+)(?:\s+([\s\S]*))?$/.exec(input.trim());
  if (!match?.[1] || !match[2]?.trim()) throw new Error(`Usage: /config ${match?.[1] || '<key>'} <value>`);
  const command = await configCommand(client);
  if (!command.input.choices.some(choice => choice.name === match[1])) throw new Error(`Unknown Copilot setting: ${match[1]}`);
  if (BLOCKED_FREEFORM.has(match[1])) throw new Error(`Copilot setting ${match[1]} requires the native secure configuration UI.`);
  const settings = await metadata(client), [top, ...rest] = match[1].split('.');
  if (!record(settings[top])) throw new Error(`Copilot setting ${match[1]} is unavailable in this runtime.`);
  const raw = match[2].trim(), offered = command.configValues[match[1]];
  const selected = offered?.find(choice => choice.id.toLowerCase() === raw.toLowerCase());
  if (offered && raw !== 'null' && !selected) throw new Error(`Choose a value advertised by Copilot for ${match[1]}.`);
  const next = selected?.id ?? parseValue(raw);
  const value = rest.length ? setPath(settings[top].value, rest.join('.'), next) : next;
  const writes = { [top]: value };
  if (match[1] === 'model') {
    const models = await client.listModels();
    const model = next === null ? undefined : models.find(item => item.id.toLowerCase() === String(next).toLowerCase());
    if (next !== null && !model) throw new Error('Choose a model advertised by Copilot.');
    writes.model = model?.id ?? null;
    writes.modelProviderId = record(model?.provider) && typeof model.provider.id === 'string' ? model.provider.id : null;
  }
  await client.rpc.user.settings.set({ settings: writes });
  const confirmed = await metadata(client);
  const actual = rest.length ? getPath(confirmed[top]?.value, rest.join('.')) : confirmed[top]?.value;
  if (!(next === null && !rest.length && confirmed[top]?.isDefault === true) && !equal(actual, next))
    throw new Error(`Copilot did not confirm ${match[1]}.`);
  return { kind: 'text', text: `Configured ${match[1]} for future Copilot sessions.`, markdown: false };
}
