import type { Agency, Route } from './types';
export const FAVORITES_KEY = 'tranuga.favorites.v1';
interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }
function browserStorage(): StorageLike | undefined { try { return globalThis.localStorage; } catch { return undefined; } }
export const favoriteKey = (agency: Agency, routeId: string) => JSON.stringify([agency.kind, agency.id, routeId]);
export class Favorites {
  private keys = new Set<string>();
  constructor(private storage = browserStorage()) {
    try {
      const raw = storage?.getItem(FAVORITES_KEY);
      const saved: unknown = raw && raw.length < 100000 ? JSON.parse(raw) : [];
      if (Array.isArray(saved)) for (const key of saved.slice(-500)) {
        if (typeof key !== 'string' || key.length > 250) continue;
        try { const value = JSON.parse(key); if (Array.isArray(value) && value.length === 3 && value.every(part => typeof part === 'string' && part.length > 0)) this.keys.add(key); } catch { /* Ignore malformed entries. */ }
      }
    } catch { /* Corrupt or blocked storage does not stop route browsing. */ }
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
