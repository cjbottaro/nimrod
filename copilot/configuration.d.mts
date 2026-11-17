interface Defaults {
  model?: string;
  reasoningEffort?: string;
  contextTier?: string;
  permissionMode?: 'manual' | 'assisted' | 'allow-all';
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
}, observe?: (event: string, metadata: unknown) => void): {
  defaults(): Promise<Defaults>;
  initializePermissions(session: {
    rpc: { permissions: {
      getMode(): Promise<{ mode: string }>;
      setMode(params: { mode: string; source: 'user_setting' }): Promise<{ success: boolean; mode: string }>;
    } };
  }, mode: Defaults['permissionMode']): Promise<void>;
  snapshot(session: ConfigurationSession, defaults?: Defaults): Promise<Snapshot>;
  apply(session: ConfigurationSession, setting: string, value: string): Promise<{
    model: Snapshot;
    mode: string;
    notice?: string;
  }>;
};
