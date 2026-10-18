import type { ConfigurationChoice, ConfigurationOperation, SessionConfiguration } from './session-configuration';

/** Configuration execution domains are chosen by the integration, not by UI busy state. */
export interface ConfigurationOwner extends SessionConfiguration {
  update(): void;
  dispose(reason?: string): void;
}

/** One consumer port over independently scheduled, session-bound configuration owners.
 * Dependencies belong within an owner; no cross-owner dependency or universal scheduler.
 */
export class SessionConfigurationSet implements ConfigurationOwner {
  private publications: readonly (readonly ConfigurationOperation[])[] = [];
  private combined: readonly ConfigurationOperation[] = [];
  constructor(private readonly owners: readonly ConfigurationOwner[]) {}
  get capabilities() { return this.owners.flatMap(owner => owner.capabilities); }
  get operations(): readonly ConfigurationOperation[] {
    const publications = this.owners.map(owner => owner.operations);
    if (publications.every((operations, index) => operations === this.publications[index])) return this.combined;
    // Keep first-observed ordering across domains, updating/removing keys in place.
    const current = new Map(publications.flatMap(operations => operations.map(operation => [operation.key, operation] as const)));
    const ordered = this.combined.flatMap(operation => {
      const updated = current.get(operation.key); current.delete(operation.key); return updated ? [updated] : [];
    });
    this.combined = [...ordered, ...current.values()];
    this.publications = publications;
    return this.combined;
  }
  private owner(setting: string): ConfigurationOwner | undefined {
    const owners = this.owners.filter(owner => owner.capabilities.some(capability => capability.id === setting));
    if (owners.length > 1) throw new Error(`Multiple configuration owners advertise ${setting}.`);
    return owners[0];
  }
  get(setting: string): string | undefined { return this.owner(setting)?.get(setting); }
  choices(setting: string): Promise<readonly ConfigurationChoice[]> {
    const owner = this.owner(setting);
    return owner ? owner.choices(setting) : Promise.reject(new Error('This setting is not supported by this session.'));
  }
  set(setting: string, choice: ConfigurationChoice): void {
    const owner = this.owner(setting);
    if (!owner) throw new Error('This setting is not supported by this session.');
    owner.set(setting, choice);
  }
  cancel(key: string): boolean {
    const owner = this.owners.find(owner => owner.operations.some(operation => operation.key === key));
    return owner?.cancel?.(key) ?? false;
  }
  update(): void { for (const owner of this.owners) owner.update(); }
  dispose(reason?: string): void { for (const owner of this.owners) owner.dispose(reason); }
}
