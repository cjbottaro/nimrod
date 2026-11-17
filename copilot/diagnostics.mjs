// Diagnostic metadata is an allowlist, not a redacted transcript. Never pass
// arbitrary SDK payloads, errors, prompts, tool data or credentials through it.
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
function pick(value, keys) {
  const result = {};
  if (!record(value)) return result;
  for (const key of keys) {
    const item = value[key];
    if (item === null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) result[key] = item;
    else if (typeof item === 'string') result[key] = item.slice(0, 4096);
  }
  return result;
}
const modelKeys = ['modelId', 'reasoningEffort', 'contextTier', 'contextTierExplicit'];
export function copilotDiagnosticMetadata(event, value) {
  switch (event) {
    case 'runtime.start': return pick(value, ['cliPath', 'nodeVersion']);
    case 'runtime.status': return pick(value, ['version', 'protocolVersion']);
    case 'session.connect.requested': return pick(value, ['requestId', 'operation', 'requestedSessionId', 'allowTranscriptRecovery', 'continuePendingWork']);
    case 'session.connect.completed': return pick(value, ['requestId', 'operation', 'requestedSessionId', 'returnedSessionId']);
    case 'configuration.defaults': {
      const settings = {};
      for (const key of ['model', 'effortLevel', 'contextTier']) {
        if (record(value?.settings) && Object.hasOwn(value.settings, key))
          settings[key] = value.settings[key] === null ? null : pick(value.settings[key], ['value', 'default', 'isDefault']);
      }
      return { settings };
    }
    case 'model.catalog': {
      // Accept both the SDK entry and this already-projected packet; the
      // frontend repeats the allowlist at its own logging boundary.
      const limits = value?.limits ?? value?.capabilities?.limits;
      const prices = value?.tokenPrices ?? value?.billing?.tokenPrices;
      return { found: typeof value?.found === 'boolean' ? value.found : record(value), ...pick(value, ['id']),
        limits: pick(limits, ['max_prompt_tokens', 'max_output_tokens', 'max_context_window_tokens']),
        tokenPrices: { ...pick(prices, ['maxPromptTokens']), longContext: pick(prices?.longContext, ['maxPromptTokens']) } };
    }
    case 'model.snapshot': return { raw: pick(value?.raw, modelKeys), resolved: pick(value?.resolved, modelKeys) };
    case 'context.metadata': {
      const present = record(value) && Object.hasOwn(value, 'contextInfo');
      return { present, ...(present ? { contextInfo: value.contextInfo === null ? null
        : pick(value.contextInfo, ['totalTokens', 'limit', 'promptTokenLimit', 'outputTokenLimit']) } : {}) };
    }
    case 'display.context': return pick(value, ['modelId', 'contextTier', 'currentTokens', 'reportedLimit', 'advertisedLimit', 'source', 'configuring']);
    // Do not log error.message/stack/cause: they may contain provider payloads or secrets.
    case 'operation.failed': return ['initialize', 'connect', 'context', 'configure'].includes(value?.method)
      ? pick(value, ['requestId', 'method', 'outcome']) : undefined;
    default: return undefined;
  }
}
