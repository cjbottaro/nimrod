import { invoke } from '@tauri-apps/api/core';

export interface NativeDraftRecord { key: string; revision: number; value: unknown; }
/** In-memory changes are immediate; IPC is ordered and Rust debounces disk writes. */
export class NativeDrafts {
  private work = Promise.resolve();
  private revisions = new Map<string, number>();
  private failed = new Map<string, NativeDraftRecord>();
  constructor(private project: string, private report: (error: unknown) => void,
    private host = { load: (project: string) => invoke<NativeDraftRecord[]>('drafts_load', { project }),
      stage: (project: string, record: NativeDraftRecord) => invoke('drafts_stage', { project, record }),
      flush: (project: string) => invoke('drafts_flush', { project }) }) {}
  async load(): Promise<Record<string, unknown>> {
    const records = await this.host.load(this.project);
    for (const record of records) { this.revisions.set(record.key, record.revision); }
    return Object.fromEntries(records.filter(record => record.value !== null).map(record => [record.key, record.value]));
  }
  change(key: string, value: unknown): void {
    const revision = (this.revisions.get(key) ?? 0) + 1;
    this.revisions.set(key, revision);
    const record = { key, revision, value };
    this.work = this.work.then(async () => {
      try { await this.host.stage(this.project, record); this.failed.delete(key); }
      catch (error) { this.failed.set(key, record); this.report(error); }
    });
  }
  async flush(): Promise<void> {
    await this.work;
    for (const [key, record] of this.failed) {
      await this.host.stage(this.project, record);
      if (this.failed.get(key) === record) this.failed.delete(key);
    }
    await this.host.flush(this.project);
  }
}
