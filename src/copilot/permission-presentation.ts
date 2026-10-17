import { operationPreview, displayFilePath, webUrl, displayWebUrl } from '../card-plugin-ui';

/** Interpret SDK permission requests directly, not as synthetic ACP tool calls. */
export function copilotPermissionPreview(document: Document, request: Readonly<Record<string, unknown>>, projectDirectory?: string): HTMLElement {
  let title = 'Copilot requests permission', description: string | undefined, content: string[] | undefined;
  const notes: string[] = [];
  if (request.kind === 'shell' && typeof request.fullCommandText === 'string' && request.fullCommandText.trim()) {
    title = 'Run command'; description = typeof request.intention === 'string' ? request.intention : undefined;
    content = [request.fullCommandText];
  } else if (request.kind === 'read' && typeof request.path === 'string' && request.path) {
    title = 'Read file'; description = displayFilePath(request.path, projectDirectory);
  } else if (request.kind === 'write' && typeof request.fileName === 'string' && request.fileName) {
    title = 'Edit file'; description = displayFilePath(request.fileName, projectDirectory);
    if (typeof request.diff === 'string' && request.diff) content = [request.diff];
    else if (typeof request.newFileContents === 'string') content = [request.newFileContents];
    else if (Array.isArray(request.fileEdits)) content = [JSON.stringify(request.fileEdits, null, 2)];
  } else if (request.kind === 'url' && webUrl(request.url)) {
    title = 'Fetch'; description = displayWebUrl(request.url as string);
    if (typeof request.redirectedFrom === 'string') notes.push(`Redirected from: ${request.redirectedFrom}`);
  } else if (request.kind === 'mcp' && typeof request.serverName === 'string' && typeof request.toolName === 'string') {
    title = 'MCP tool'; description = `${request.serverName} · ${request.toolName}`;
    if (request.args !== undefined) content = [JSON.stringify(request.args, null, 2) ?? ''];
  } else {
    // Unknown scopes must remain prominent, not disappear into a collapsed disclosure.
    content = [JSON.stringify(request, null, 2) ?? ''];
  }
  if (request.requestSandboxBypass === true) {
    notes.push('Requests sandbox bypass');
    if (typeof request.requestSandboxBypassReason === 'string' && request.requestSandboxBypassReason) notes.push(request.requestSandboxBypassReason);
  }
  if (request.managedApprovalRequired === true) notes.push('Explicit approval required by managed policy');
  return operationPreview(document, { title, description, content, notes, raw: request });
}
