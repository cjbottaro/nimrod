import { JsonRecord } from "./types";

export interface ModelIdentity {
  id: string;
  provider: string;
  name?: string;
}

export interface ModelThinkingState {
  ready: boolean;
  changing: boolean;
  model: ModelIdentity | null;
  thinkingLevel?: string;
  thinkingLevels: string[];
}

export interface RpcTransport {
  request(type: string, fields?: JsonRecord, timeoutMs?: number): Promise<JsonRecord>;
}

export interface ModelThinkingHost {
  /** Main-agent activity only; extension background activity must not block configuration. */
  isMainAgentBusy(): boolean;
  onRpcState(data: JsonRecord): void;
  onState(state: ModelThinkingState): void;
  chooseModel(models: ModelIdentity[], current: ModelIdentity | null): Promise<ModelIdentity | undefined>;
  chooseThinkingLevel(levels: string[], current: string | undefined): Promise<string | undefined>;
  showError(error: unknown): void;
}

export class ModelThinkingController {
  private disconnected = false;
  private state: ModelThinkingState = { ready: false, changing: false, model: null, thinkingLevels: [] };

  constructor(private readonly rpc: RpcTransport, private readonly host: ModelThinkingHost) {}

  async initialize(state: JsonRecord): Promise<void> {
    await this.applyRpcState(state);
  }

  disconnect(): void {
    this.disconnected = true;
    this.patch({ ready: false, changing: false });
  }

  async selectModel(ui: Pick<ModelThinkingHost, 'chooseModel' | 'showError'> = this.host): Promise<void> {
    if (!this.beginChange()) { ui.showError(new Error('Pi is not ready to change models. Wait for startup or active work to finish.')); return; }
    try {
      const response = await this.rpc.request("get_available_models");
      const models = modelArray(record(response.data).models);
      const selected = await ui.chooseModel(models, this.state.model);
      if (!selected) return;

      if (!await this.revalidateIdle()) return;
      // The selected value came from Pi's model list; never accept provider/model values from the webview.
      await this.rpc.request("set_model", { provider: selected.provider, modelId: selected.id });
      await this.refresh();
    } catch (error) {
      await this.resyncAfterFailure();
      ui.showError(error);
    } finally {
      this.patch({ changing: false });
    }
  }

  async selectThinkingLevel(ui: Pick<ModelThinkingHost, 'chooseThinkingLevel' | 'showError'> = this.host): Promise<void> {
    if (!this.beginChange()) { ui.showError(new Error('Pi is not ready to change thinking level. Wait for startup or active work to finish.')); return; }
    try {
      if (!await this.revalidateIdle()) return;
      const levels = await this.getSupportedThinkingLevels();
      if (!this.state.model) throw new Error('Select a model before choosing a thinking level.');
      if (!levels.length) throw new Error('Pi did not report any supported thinking levels for this model.');
      const selected = await ui.chooseThinkingLevel(levels, this.state.thinkingLevel);
      if (!selected) return;

      // Pi can start work or another model selection can change support while the picker is open.
      if (!await this.revalidateIdle()) return;
      const currentLevels = await this.getSupportedThinkingLevels();
      if (!currentLevels.includes(selected)) {
        throw new Error("The selected thinking level is no longer supported by the current model.");
      }
      if (this.disconnected || this.host.isMainAgentBusy()) return;
      await this.rpc.request("set_thinking_level", { level: selected });
      await this.refresh();
    } catch (error) {
      await this.resyncAfterFailure();
      ui.showError(error);
    } finally {
      this.patch({ changing: false });
    }
  }

  private beginChange(): boolean {
    if (this.disconnected || !this.state.ready || this.state.changing || this.host.isMainAgentBusy()) return false;
    this.patch({ changing: true });
    return true;
  }

  private async revalidateIdle(): Promise<boolean> {
    const state = await this.getRpcState();
    await this.applyRpcState(state);
    return !this.disconnected && !this.host.isMainAgentBusy() && state.isStreaming !== true && state.isCompacting !== true;
  }

  private async refresh(): Promise<void> {
    await this.applyRpcState(await this.getRpcState());
  }

  private async getRpcState(): Promise<JsonRecord> {
    const response = await this.rpc.request("get_state");
    const data = record(response.data);
    if (!this.disconnected) this.host.onRpcState(data);
    return data;
  }

  private async applyRpcState(data: JsonRecord): Promise<void> {
    if (this.disconnected) return;
    const model = modelIdentity(data.model);
    const thinkingLevel = typeof data.thinkingLevel === "string" ? data.thinkingLevel : undefined;
    this.patch({ ready: true, model, thinkingLevel, thinkingLevels: [] });
    if (model) this.patch({ thinkingLevels: await this.getSupportedThinkingLevels() });
  }

  private async getSupportedThinkingLevels(): Promise<string[]> {
    if (!this.state.model) return [];
    const response = await this.rpc.request("get_available_thinking_levels");
    const levels = stringArray(record(response.data).levels);
    if (!this.disconnected) this.patch({ thinkingLevels: levels });
    return levels;
  }

  private async resyncAfterFailure(): Promise<void> {
    try {
      await this.refresh();
    } catch {
      // Preserve the original mutation error. process_error will independently disable disconnected controls.
    }
  }

  private patch(change: Partial<ModelThinkingState>): void {
    this.state = { ...this.state, ...change };
    this.host.onState(this.state);
  }
}

function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function modelArray(value: unknown): ModelIdentity[] {
  return Array.isArray(value) ? value.flatMap((item) => {
    const model = modelIdentity(item);
    return model ? [model] : [];
  }) : [];
}

function modelIdentity(value: unknown): ModelIdentity | null {
  const model = record(value);
  return typeof model.id === "string" && model.id && typeof model.provider === "string" && model.provider
    ? { id: model.id, provider: model.provider, ...(typeof model.name === "string" && model.name ? { name: model.name } : {}) }
    : null;
}
