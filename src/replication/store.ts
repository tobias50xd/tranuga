export interface Snapshot<T> { at: number; value: T }
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }
const KEY = 'tranuga.transit-replicas.v1';
const MAX_AGE = 24 * 60 * 60 * 1000;

/** Last-good public transit responses only. No trip endpoints or user locations are stored. */
export class SnapshotStore {
  private entries = new Map<string, Snapshot<unknown>>();
  constructor(private storage?: StorageLike, private now = Date.now) {
    try {
      const raw = storage?.getItem(KEY);
      if (!raw || raw.length > 3_000_000) return;
      const data: unknown = JSON.parse(raw);
      if (!data || typeof data !== 'object' || (data as { version?: unknown }).version !== 1) return;
      const items = (data as { entries?: unknown }).entries;
      if (!Array.isArray(items)) return;
      for (const item of items.slice(-64)) {
        if (!Array.isArray(item) || typeof item[0] !== 'string' || !item[1] || typeof item[1] !== 'object') continue;
        const snapshot = item[1] as Snapshot<unknown>;
        if (Number.isFinite(snapshot.at) && snapshot.at <= now() + 60000 && now() - snapshot.at <= MAX_AGE) this.entries.set(item[0], snapshot);
      }
    } catch { /* Storage may be disabled, full, or contain an older/corrupt version. */ }
  }
  get<T>(key: string, valid: (value: unknown) => value is T, maxAge = MAX_AGE): Snapshot<T> | undefined {
    const item = this.entries.get(key);
    return item && item.at <= this.now() + 60000 && this.now() - item.at <= maxAge && valid(item.value) ? item as Snapshot<T> : undefined;
  }
  put<T>(key: string, value: T, at = this.now()) {
    this.entries.delete(key); this.entries.set(key, { at, value });
    for (const [entryKey, entry] of this.entries) if (this.now() - entry.at > MAX_AGE) this.entries.delete(entryKey);
    while (this.entries.size > 64) this.entries.delete(this.entries.keys().next().value!);
    if (!this.storage) return;
    try {
      let data = JSON.stringify({ version: 1, entries: [...this.entries] });
      while (data.length > 2_000_000 && this.entries.size > 1) {
        this.entries.delete(this.entries.keys().next().value!);
        data = JSON.stringify({ version: 1, entries: [...this.entries] });
      }
      if (data.length <= 2_000_000) this.storage.setItem(KEY, data);
    } catch { /* In-memory replication continues when persistent storage is unavailable. */ }
  }
}
