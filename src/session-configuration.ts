export type ConfigurationAvailability = 'ready' | 'deferred' | 'unavailable';
export interface ConfigurationChoice {
  readonly value: string;
  readonly label: string;
  readonly detail?: string;
  readonly keywords?: string;
}
export interface ConfigurationSetting {
  readonly id: string;
  readonly label: string;
  readonly availability: ConfigurationAvailability;
  readonly reason?: string;
  readonly dependsOn?: readonly string[];
}
export interface ConfigurationOperation {
  readonly key: string;
  readonly phase: 'queued' | 'applying' | 'completed' | 'failed' | 'unknown' | 'not-applied';
  readonly title: string;
  readonly text: string;
  readonly details?: string;
  readonly cause?: 'connection';
  readonly cancellable?: boolean;
  /** Pre-result transcript boundary for operations whose own output is appended before settlement. Null means before the first row. */
  readonly settlementAnchor?: string | null;
}
/** Narrow, session-bound configuration port; no transport, lifecycle or UI authority. */
export interface SessionConfiguration {
  readonly capabilities: readonly ConfigurationSetting[];
  readonly operations: readonly ConfigurationOperation[];
  get(setting: string): string | undefined;
  choices(setting: string): Promise<readonly ConfigurationChoice[]>;
  /** Accept local intent synchronously. Completion is reported through operations/effective getters. */
  set(setting: string, choice: ConfigurationChoice): void;
  /** Withdraw only if this exact operation has not entered mutation dispatch. */
  cancel?(key: string): boolean;
}
export interface ConfigurationAdapter {
  /** Stable operation title for this concrete configuration domain. */
  readonly operationTitle?: string;
  capabilities(desired: Readonly<Record<string, string>>): readonly ConfigurationSetting[];
  get(setting: string): string | undefined;
  choices(setting: string, desired: Readonly<Record<string, string>>): Promise<readonly ConfigurationChoice[]>;
  /** Revalidate concrete readiness before dispatch; return only after authoritative reconciliation. */
  apply(setting: string, value: string, current: () => boolean, dispatched: () => void): Promise<void>;
}
/** Readiness deferral proven before native mutation. Never use for ambiguous mutation delivery. */
export class ConfigurationDeferred extends Error {}
/** A newer intent superseded metadata validation before any mutation was dispatched. */
export class ConfigurationSuperseded extends Error {}
/** Mutation may have applied, but its authoritative outcome could not be established. */
export class ConfigurationUncertain extends Error {}
interface Intent { choice: ConfigurationChoice; dependencies: Record<string, string | undefined>; }

/** Latest-wins local intents; concrete integrations retain mutation/uncertainty semantics. */
export class SessionConfigurationController implements SessionConfiguration {
  operations: readonly ConfigurationOperation[] = [];
  private pending = new Map<string, Intent>();
  private active?: { setting: string; intent: Intent };
  private current?: ConfigurationOperation;
  private running = false;
  private updateRequested = false;
  private disposed = false;
  private dispatched = false;
  private offered = new WeakMap<ConfigurationChoice, { setting: string; dependencies: Record<string, string | undefined> }>();
  constructor(private adapter: ConfigurationAdapter, private changed: () => void, _legacyError?: (message: string) => void) {}
  get capabilities(): readonly ConfigurationSetting[] {
    const capabilities = this.adapter.capabilities(this.desired());
    return this.disposed ? capabilities.map(item => ({ ...item, availability: 'unavailable' as const, reason: 'Configuration is unavailable because the connection ended.' })) : capabilities;
  }
  get(setting: string): string | undefined { return this.adapter.get(setting); }
  private desired(): Record<string, string> {
    const values: Record<string, string> = Object.create(null);
    if (this.active) values[this.active.setting] = this.active.intent.choice.value;
    for (const [id, intent] of this.pending) values[id] = intent.choice.value;
    return values;
  }
  async choices(setting: string): Promise<readonly ConfigurationChoice[]> {
    const capability = this.capabilities.find(item => item.id === setting);
    if (this.disposed || !capability || capability.availability === 'unavailable') throw new Error(capability?.reason || 'This setting is unavailable. Nothing was changed.');
    const desired = this.desired();
    const dependencies = Object.fromEntries((capability.dependsOn || []).map(id => [id, desired[id] ?? this.get(id)]));
    const choices = await this.adapter.choices(setting, desired);
    if (this.disposed) throw new Error('The configuration connection ended. Nothing was changed.');
    const latest = this.desired();
    if (Object.entries(dependencies).some(([id, value]) => (latest[id] ?? this.get(id)) !== value)) throw new Error('Configuration changed while loading choices. Open the picker again.');
    return choices.map(choice => { const offered = { ...choice }; this.offered.set(offered, { setting, dependencies }); return offered; });
  }
  set(setting: string, choice: ConfigurationChoice): void {
    const capability = this.capabilities.find(item => item.id === setting);
    if (this.disposed || !capability || capability.availability === 'unavailable') throw new Error(capability?.reason || 'This setting is unavailable. Nothing was changed.');
    const offered = this.offered.get(choice), currentDesired = this.desired();
    if (typeof choice.value !== 'string' || !offered || offered.setting !== setting) throw new Error('Choose a value advertised by this session for this setting.');
    if (Object.entries(offered.dependencies).some(([id, value]) => (currentDesired[id] ?? this.get(id)) !== value)) throw new Error('Configuration changed while the picker was open. Open it again.');
    // A dependent effort chosen for another model must never silently carry over.
    const previous = this.pending.get(setting)?.choice.value ?? (this.active?.setting === setting ? this.active.intent.choice.value : this.get(setting));
    if (previous !== choice.value) for (const item of this.capabilities) if (item.dependsOn?.includes(setting)) this.pending.delete(item.id);
    const desired = this.desired();
    const dependencies = Object.fromEntries((capability.dependsOn || []).map(id => [id, desired[id] ?? this.get(id)]));
    this.pending.set(setting, { choice: { ...choice }, dependencies });
    if (!this.current) {
      this.dispatched = false;
      this.current = { key: `configuration:${crypto.randomUUID()}`, phase: 'queued', title: this.adapter.operationTitle || 'Configuration change', text: '' };
    }
    this.progress(this.active ? 'applying' : 'queued');
    this.update();
  }
  /** Call synchronously on concrete readiness/catalog/value transitions, not a polling timer. */
  update(): void {
    if (this.disposed || !this.pending.size) return;
    if (this.running) { this.updateRequested = true; return; }
    void this.drain();
  }
  cancel(key: string): boolean {
    if (this.disposed || !this.current || this.current.key !== key || this.active || this.dispatched) return false;
    this.pending.clear(); this.current = undefined;
    this.operations = this.operations.filter(operation => operation.key !== key);
    this.changed();
    return true;
  }
  dispose(reason = 'The configuration connection ended.', outcome?: 'failed'): void {
    if (this.disposed) return;
    this.disposed = true; this.pending.clear();
    if (this.current) this.finish(outcome ?? (this.dispatched ? 'unknown' : 'not-applied'),
      `${reason} ${outcome === 'failed' ? 'The harness reported a configuration error.' : this.dispatched ? 'The requested changes were not fully confirmed.' : 'The requested changes were not dispatched.'} Nothing was retried.`, 'connection');
  }
  private progress(phase: 'queued' | 'applying'): void {
    if (!this.current || this.disposed) return;
    const desired = new Map<string, Intent>();
    if (this.active) desired.set(this.active.setting, this.active.intent);
    for (const entry of this.pending) desired.set(...entry);
    const text = [...desired].map(([id, intent]) => `${this.capabilities.find(item => item.id === id)?.label || id}: ${intent.choice.label}`).join(' · ');
    const title = this.adapter.operationTitle || 'Configuration change', cancellable = !this.active && !this.dispatched;
    if (this.current.phase === phase && this.current.title === title && this.current.text === text && this.current.cancellable === cancellable) return;
    this.current = { ...this.current, phase, title, text, cancellable };
    this.publish();
  }
  private publish(): void {
    if (this.current) {
      const index = this.operations.findIndex(item => item.key === this.current!.key);
      this.operations = index < 0 ? [...this.operations, this.current] : this.operations.map((item, at) => at === index ? this.current! : item);
    }
    this.changed();
  }
  private finish(phase: 'completed' | 'failed' | 'unknown' | 'not-applied', details?: string, cause?: 'connection'): void {
    if (!this.current) return;
    this.current = { ...this.current, phase, title: this.adapter.operationTitle || 'Configuration change', cancellable: false, details, cause };
    this.publish(); this.current = undefined;
  }
  private async drain(): Promise<void> {
    this.running = true;
    this.updateRequested = false;
    try {
      while (!this.disposed && this.pending.size) {
        const capabilities = this.capabilities;
        // Apply prerequisites before their dependent settings.
        const eligible = [...this.pending].filter(([id]) => !(capabilities.find(item => item.id === id)?.dependsOn || []).some(dependency => this.pending.has(dependency)));
        const entry = eligible.find(([id]) => capabilities.find(item => item.id === id)?.availability === 'ready') || eligible[0];
        if (!entry) throw new Error('Configuration dependencies could not be resolved.');
        const [id, intent] = entry;
        const capability = capabilities.find(item => item.id === id);
        if (!capability || capability.availability === 'unavailable') throw new Error(capability?.reason || 'The requested setting is no longer supported.');
        if (capability.availability === 'deferred') { this.progress('queued'); return; }
        if (Object.entries(intent.dependencies).some(([key, value]) => this.get(key) !== value)) throw new Error('Configuration changed; choose the dependent setting again. Nothing was applied for that setting.');
        const operationKey = this.current?.key;
        let choices: readonly ConfigurationChoice[];
        try { choices = await this.adapter.choices(id, this.desired()); }
        catch (error) {
          if (this.current?.key !== operationKey) continue;
          throw error;
        }
        if (this.disposed) return;
        if (this.pending.get(id) !== intent) continue;
        const available = this.capabilities.find(item => item.id === id)?.availability;
        if (available === 'deferred') { this.progress('queued'); return; }
        if (available !== 'ready') throw new Error('This setting is no longer available.');
        if (!choices.some(item => item.value === intent.choice.value)) throw new Error('The requested configuration choice is no longer supported. Choose again.');
        // Recheck dependencies after asynchronous metadata reads as well.
        if (Object.entries(intent.dependencies).some(([key, value]) => this.get(key) !== value)) throw new Error('Configuration changed while validating the selection. Choose again.');
        this.pending.delete(id); this.active = { setting: id, intent }; this.progress('applying');
        const dispatchedBefore = this.dispatched;
        try { await this.adapter.apply(id, intent.choice.value, () => !this.disposed && !this.pending.has(id)
          && Object.entries(intent.dependencies).every(([key, value]) => (this.desired()[key] ?? this.get(key)) === value), () => { this.dispatched = true; }); }
        catch (error) {
          if (error instanceof ConfigurationSuperseded) { this.active = undefined; continue; }
          if (error instanceof ConfigurationDeferred) {
            // The adapter guarantees no native mutation was attempted. A bridge
            // may establish that after its own readiness/metadata preflight.
            this.dispatched = dispatchedBefore;
            if (!this.pending.has(id)) this.pending.set(id, intent);
            this.active = undefined; this.progress('queued');
            if (this.capabilities.find(item => item.id === id)?.availability === 'ready') continue;
            return;
          }
          throw error;
        }
        if (!this.disposed && (this.get(id) !== intent.choice.value || Object.entries(intent.dependencies).some(([key, value]) => this.get(key) !== value)))
          throw new ConfigurationUncertain('The harness did not confirm the requested configuration and its dependencies. No retry was made.');
        this.active = undefined;
      }
      if (!this.disposed && this.current) this.finish('completed');
    } catch (error) {
      this.pending.clear(); this.active = undefined;
      if (!this.disposed) this.finish(error instanceof ConfigurationUncertain ? 'unknown' : 'failed', String(error));
    } finally {
      this.running = false;
      if (this.updateRequested && !this.disposed && this.pending.size) queueMicrotask(() => this.update());
    }
  }
}
