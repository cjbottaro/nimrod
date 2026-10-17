interface Defaults {
  model?: string;
  reasoningEffort?: string;
  contextTier?: string;
}
interface Snapshot {
  modelId?: string;
  reasoningEffort?: string;
  contextTier?: string;
}
interface ConfigurationSession {
  rpc: {
    model: { getCurrent(): Promise<Snapshot> };
    mode: {
      get(): Promise<string>;
      set(params: { mode: string; expectedMode: string }): Promise<{
        status: string;
        modelChanged: boolean;
        modeApplied?: boolean;
        confirmation?: unknown;
        deferImplementation?: boolean;
        armInteractiveContinuation?: boolean;
        warning?: string;
        message?: string;
        deprecationWarnings?: string[];
      }>;
    };
  };
  setModel(model: string, options: { reasoningEffort?: string; contextTier?: string }): Promise<void>;
}
export function createCopilotConfiguration(client: {
  rpc: { user: { settings: { get(): Promise<unknown> } } };
}): {
  defaults(): Promise<Defaults>;
  snapshot(session: ConfigurationSession, defaults?: Defaults): Promise<Snapshot>;
  apply(session: ConfigurationSession, setting: string, value: string): Promise<{
    model: Snapshot;
    mode: string;
    notice?: string;
  }>;
};
