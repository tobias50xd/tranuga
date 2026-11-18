import type { Coordinate, Stop } from './types';
import { distanceMeters } from './planner';

export interface Place extends Coordinate { id: string; label: string; detail: string; kind: 'stop' | 'place' }
const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function normalizePlaces(raw: unknown): Place[] {
  const root = object(raw); if (root.type !== 'FeatureCollection' || !Array.isArray(root.features)) return [];
  const result: Place[] = [];
  for (const value of root.features.slice(0, 20)) {
    const feature = object(value), geometry = object(feature.geometry), properties = object(feature.properties);
    if (geometry.type !== 'Point' || !Array.isArray(geometry.coordinates)) continue;
    const [lon, lat] = geometry.coordinates;
    if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const address = [clean(properties.housenumber), clean(properties.street)].filter(Boolean).join(' ');
    const label = clean(properties.name) || address;
    if (!label) continue;
    const detail = [...new Set([address, clean(properties.city) || clean(properties.town) || clean(properties.village), clean(properties.state), clean(properties.country)].filter(part => part && part !== label))].join(', ');
    const id = `${lat},${lon}:${label}`;
    if (!result.some(place => place.id === id)) result.push({ id, label, detail, lat, lon, kind: 'place' });
  }
  return result.slice(0, 5);
}
export function nearestPlaces(places: readonly Place[], near: Coordinate, limit: number): Place[] {
  return places.map(place => ({ place, distance: distanceMeters(near, place) }))
    .sort((a, b) => a.distance - b.distance || a.place.label.localeCompare(b.place.label))
    .slice(0, limit).map(({ place }) => place);
}
export function matchStops(stops: readonly Stop[], query: string, near: Coordinate): Place[] {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (query.trim().length < 2) return [];
  const matches: Place[] = stops.filter(stop => {
    const name = stop.name.toLocaleLowerCase();
    return terms.every(term => name.includes(term));
  }).map(stop => ({ ...stop, id: `stop:${stop.id}`, label: stop.name, detail: 'Transit stop · service depends on the current network', kind: 'stop' }));
  return nearestPlaces(matches, near, 5);
}
export class PlaceSearch {
  private cache = new Map<string, { at: number; places: Place[] }>();
  constructor(private fetcher: typeof fetch = (input, init) => fetch(input, init), private now = Date.now) {}
  async search(query: string, bias: Coordinate, signal?: AbortSignal): Promise<Place[]> {
    query = query.trim(); if (query.length < 3 || query.length > 120) return [];
    const key = JSON.stringify([query.toLocaleLowerCase(), bias.lat, bias.lon]);
    const saved = this.cache.get(key); if (saved && this.now() - saved.at < 300000) return saved.places;
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort(); else signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 6500);
    try {
      const response = await this.fetcher('/api/places', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, ...bias }), credentials: 'omit', cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('Address search is unavailable. Choose a stop or use the map.');
      const places = normalizePlaces(await response.json());
      if (controller.signal.aborted) throw new DOMException('Search cancelled', 'AbortError');
      this.cache.delete(key); this.cache.set(key, { at: this.now(), places });
      if (this.cache.size > 50) this.cache.delete(this.cache.keys().next().value!);
      return places;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
}
