import { record } from './api/normalize';
import { readPreviousPreferences } from './preferences';
import type { Agency, Route } from './types';
export const FAVORITES_KEY = 'tranuga.favorites.v1';
const FAVORITES_MIGRATED_KEY = 'tranuga.favorites.migrated';
interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }
function browserStorage(): StorageLike | undefined { try { return globalThis.localStorage; } catch { return undefined; } }
export const favoriteKey = (agency: Agency, routeId: string) => JSON.stringify([agency.kind, agency.id, routeId]);

function favoriteParts(key: unknown): string[] | undefined {
  if (typeof key !== 'string' || key.length > 250) return;
  try {
    const value: unknown = JSON.parse(key);
    if (Array.isArray(value) && value.length === 3 && value.every(part => typeof part === 'string' && part.length > 0)) return value;
  } catch { /* Ignore malformed entries. */ }
}

export class Favorites {
  private keys = new Set<string>();
  constructor(private storage = browserStorage()) {
    try {
      const raw = storage?.getItem(FAVORITES_KEY);
      const saved: unknown = raw && raw.length < 100000 ? JSON.parse(raw) : [];
      if (Array.isArray(saved)) for (const key of saved.slice(-500)) if (favoriteParts(key)) this.keys.add(key);
    } catch { /* Corrupt or blocked storage does not stop route browsing. */ }
    this.restoreSharedFavorites();
  }
  private restoreSharedFavorites() {
    const storage = this.storage;
    if (!storage) return;
    try {
      if (storage.getItem(FAVORITES_MIGRATED_KEY)) return;
      const scopes = Object.entries(record(readPreviousPreferences(storage).favorites))
        .filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]) && /^(uga|passio|infopoint):.+$/.test(entry[0]));
      if (!scopes.length) return;
      const imported = new Map(scopes);
      const merged = [...this.keys].filter(key => {
        const [kind, agencyId] = favoriteParts(key)!;
        return !imported.has(`${kind}:${agencyId}`);
      });
      for (const [scope, routes] of scopes) {
        const split = scope.indexOf(':');
        for (const routeId of routes.slice(-500)) {
          if (typeof routeId !== 'string') continue;
          const key = JSON.stringify([scope.slice(0, split), scope.slice(split + 1), routeId]);
          if (favoriteParts(key)) merged.push(key);
        }
      }
      this.keys = new Set([...new Set(merged)].slice(-500));
      storage.setItem(FAVORITES_KEY, JSON.stringify([...this.keys]));
      storage.setItem(FAVORITES_MIGRATED_KEY, 'true');
    } catch { /* Keep the current session's favorites. */ }
  }
  has(agency: Agency, routeId: string) { return this.keys.has(favoriteKey(agency, routeId)); }
  routeIds(agency: Agency, routes: Route[]) { return new Set(routes.filter(route => this.has(agency, route.id)).map(route => route.id)); }
  toggle(agency: Agency, routeId: string) {
    const key = favoriteKey(agency, routeId);
    if (this.keys.has(key)) this.keys.delete(key); else this.keys.add(key);
    if (this.keys.size > 500) this.keys.delete(this.keys.values().next().value!);
    try { this.storage?.setItem(FAVORITES_KEY, JSON.stringify([...this.keys])); } catch { /* Keep session favorites if saving fails. */ }
    return this.keys.has(key);
  }
}
