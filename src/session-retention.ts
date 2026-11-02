/** Native history, not connection health, a runtime ID, or sidebar membership. */
export type SessionRetentionState = 'saved' | 'absent' | 'unknown';

/** Required mounted-session cleanup port. Checks never create/resume a conversation
 * or send work. Only an authoritative exact-target lookup may return absent.
 * Call again after observed owned shutdown: shutdown can finish persistence.
 * Unknown preserves drafts but must not prevent ordinary Close.
 */
export interface SessionRetention {
  check(): Promise<SessionRetentionState>;
  /** Retire integration-owned local pointers after confirmed-absent local removal.
   * Never deletes native history. The shell owns row/draft/recency cleanup.
   */
  forget(): void;
}

/** Discovery failures are not proof that local state is disposable. */
export async function checkSessionRetention(retention: SessionRetention): Promise<SessionRetentionState> {
  try { return await retention.check(); }
  catch { return 'unknown'; }
}
