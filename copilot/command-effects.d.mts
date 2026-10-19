export interface CommandEffectSession {
  setModel(model: string, options?: { reasoningEffort?: string; autoTier?: string }): Promise<void>;
  rpc: {
    model: { getCurrent(): Promise<unknown> };
    commands: {
      finalizeInvocationEffect(request: { effect: Record<string, unknown>; outcome: 'applied' | 'cancelled' }): Promise<unknown>;
    };
  };
}

export function completeCommandEffect(
  session: CommandEffectSession,
  effect: unknown,
  context?: {
    command?: { kind?: string; name?: string };
    input?: string;
    models?: () => Promise<unknown>;
  },
): Promise<Record<string, unknown>>;
