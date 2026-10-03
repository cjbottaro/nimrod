// Loaded inside Pi, not the VS Code host. No tools, commands, prompt changes, or I/O.
// ctx.scopedModels is Pi's resolved --models/enabledModels shortlist.
export const MODEL_SCOPE_STATUS = "pi-gui:model-scope";
export interface ModelReference { provider: string; id: string; }

interface ScopeContext {
  mode: string;
  scopedModels?: readonly { model: ModelReference }[];
  ui: { setStatus(key: string, text: string): void };
}
interface PiEvents {
  on(event: "session_start" | "model_select", handler: (event: unknown, ctx: ScopeContext) => void): unknown;
}

export default function modelScopeBridge(pi: PiEvents): void {
  const report = (_event: unknown, ctx: ScopeContext): void => {
    if (ctx.mode !== "rpc") return;
    const scope = Array.isArray(ctx.scopedModels)
      ? ctx.scopedModels.map(({ model }) => ({ provider: model.provider, id: model.id })) : null;
    ctx.ui.setStatus(MODEL_SCOPE_STATUS, JSON.stringify(scope));
  };
  pi.on("session_start", report);
  pi.on("model_select", report);
}

export function parseModelScope(raw: unknown): ModelReference[] | undefined {
  if (typeof raw !== "string") return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || !value.every(item => item && typeof item.provider === "string" && item.provider && typeof item.id === "string" && item.id)) return undefined;
    return value.map(({ provider, id }) => ({ provider, id }));
  } catch { return undefined; }
}

export function scopedModels<T extends ModelReference>(available: T[], scope: ModelReference[] | undefined): T[] {
  if (scope === undefined) throw new Error("Pi's scoped model list is unavailable. Retry after startup, or reconnect the session to load its model-scope bridge.");
  if (!scope.length) return available; // Pi explicitly reports that no scope is configured.
  const seen = new Set<string>();
  return scope.flatMap(reference => {
    const key = JSON.stringify([reference.provider, reference.id]);
    if (seen.has(key)) return [];
    seen.add(key);
    const model = available.find(model => model.provider === reference.provider && model.id === reference.id);
    return model ? [model] : [];
  });
}
