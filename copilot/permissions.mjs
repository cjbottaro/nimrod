// Supported host decisions only. Shared by the UI and the bridge validator;
// never infer grants from model prose or synthesize a standing Nimrod policy.
export function permissionOptions(request) {
  const options = [{ id: 'once', label: 'Allow once', decision: { kind: 'approve-once', approvedInteractively: true } }];
  if (request.managedApprovalRequired === true || request.requestSandboxBypass === true) return options;
  let approval, label;
  if (request.kind === 'read' && typeof request.path === 'string' && request.path.trim()) {
    approval = { kind: 'read' }; label = 'Allow all file reads this session';
  } else if (request.kind === 'write' && typeof request.fileName === 'string' && request.fileName.trim()) {
    approval = { kind: 'write' }; label = 'Allow all file writes this session';
  } else if (request.kind === 'shell' && typeof request.fullCommandText === 'string' && request.fullCommandText.trim() && Array.isArray(request.commands) && request.commands.length
    && request.commands.every(command => command && typeof command.identifier === 'string' && command.identifier.trim())) {
    const commandIdentifiers = [...new Set(request.commands.map(command => command.identifier))];
    approval = { kind: 'commands', commandIdentifiers };
    label = `Allow commands this session: ${commandIdentifiers.join(', ')} (any arguments)`;
  } else if (request.kind === 'mcp' && typeof request.serverName === 'string' && request.serverName.trim()
    && typeof request.toolName === 'string' && request.toolName.trim()) {
    approval = { kind: 'mcp', serverName: request.serverName, toolName: request.toolName };
    label = `Allow ${request.serverName} / ${request.toolName} this session`;
  } else if (request.kind === 'url' && typeof request.url === 'string') {
    try {
      const url = new URL(request.url);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return options;
      const domain = url.hostname;
      if (!domain) return options;
      options.push({ id: 'session', label: `Allow domain this session: ${domain}`, decision: { kind: 'approve-for-session', domain } });
      options.push({ id: 'permanent', label: `Always allow domain: ${domain} (saved across sessions)`, decision: { kind: 'approve-permanently', domain } });
    } catch { /* Malformed/unknown scopes retain only one-time approval. */ }
    return options;
  }
  if (approval) options.push({ id: 'session', label, decision: { kind: 'approve-for-session', approval } });
  return options;
}
function exact(value, expected) {
  if (value === expected) return true;
  if (!value || !expected || typeof value !== 'object' || typeof expected !== 'object' || Array.isArray(value) !== Array.isArray(expected)) return false;
  const keys = Object.keys(value);
  return keys.length === Object.keys(expected).length && keys.every(key => Object.hasOwn(expected, key) && exact(value[key], expected[key]));
}
export function validPermissionDecision(request, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.kind === 'user-not-available') return exact(value, { kind: 'user-not-available' });
  if (value.kind === 'reject') return Object.keys(value).every(key => ['kind', 'feedback'].includes(key))
    && (value.feedback === undefined || typeof value.feedback === 'string');
  return permissionOptions(request).some(option => exact(value, option.decision));
}
