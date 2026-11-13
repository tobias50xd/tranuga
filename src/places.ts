import type { Coordinate, Stop } from './types';
import { escapeHtml as e } from './ui';

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
export function matchStops(stops: Stop[], query: string): Place[] {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (query.trim().length < 2) return [];
  return stops.filter(stop => terms.every(term => stop.name.toLocaleLowerCase().includes(term))).sort((a, b) => Number(!a.name.toLocaleLowerCase().startsWith(query.toLocaleLowerCase())) - Number(!b.name.toLocaleLowerCase().startsWith(query.toLocaleLowerCase())) || a.name.localeCompare(b.name)).slice(0, 5).map(stop => ({ ...stop, id: `stop:${stop.id}`, label: stop.name, detail: 'Transit stop · service depends on the current network', kind: 'stop' }));
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

/** Editable ARIA combobox with stop hints, debounced addresses and stale-response protection. */
export class PlaceInput {
  private lifetime = new AbortController();
  private request?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private revision = 0;
  private active = -1;
  private choices: Place[] = [];
  private list: HTMLElement;
  private status: HTMLElement;
  constructor(private input: HTMLInputElement, private stops: () => Stop[], private bias: Coordinate, private search: PlaceSearch, private change: (place: Place | undefined, text: string) => void) {
    this.list = document.getElementById(`${input.id}-hints`)!;
    this.status = document.getElementById(`${input.id}-status`)!;
    const signal = this.lifetime.signal;
    input.addEventListener('input', () => { this.change(undefined, input.value); this.update(); }, { signal });
    input.addEventListener('focus', () => { if (input.value) this.update(); }, { signal });
    input.addEventListener('blur', () => this.close(), { signal });
    input.addEventListener('keydown', event => {
      if (event.key === 'Escape' || event.key === 'Tab') { this.close(); return; }
      if (!this.choices.length || this.list.hidden) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); this.active = this.active < 0 ? event.key === 'ArrowDown' ? 0 : this.choices.length - 1 : (this.active + (event.key === 'ArrowDown' ? 1 : -1) + this.choices.length) % this.choices.length; this.draw(this.status.textContent || ''); }
      if (event.key === 'Enter') { event.preventDefault(); this.select(this.active < 0 ? 0 : this.active); }
    }, { signal });
    this.list.addEventListener('mousedown', event => event.preventDefault(), { signal });
    this.list.addEventListener('click', event => { const option = (event.target as Element).closest<HTMLElement>('[data-choice]'); if (option && !input.disabled && !input.matches(':disabled')) this.select(Number(option.dataset.choice)); }, { signal });
  }
  setValue(text: string) { this.close(); this.input.value = text; }
  private select(index: number) { const place = this.choices[index]; if (!place) return; this.setValue(place.label); this.change(place, place.label); }
  private update() {
    this.close(); const query = this.input.value.trim(); if (query.length < 2 || query.length > 120 || /^[-+\d.\s,]+$/.test(query)) return;
    this.choices = matchStops(this.stops(), query); this.draw(query.length < 3 ? 'Type at least 3 characters to search addresses.' : 'Searching addresses…');
    if (query.length < 3 || this.choices.length >= 3 || this.choices.some(place => place.label.toLocaleLowerCase() === query.toLocaleLowerCase())) { this.status.textContent = `${this.choices.length} stop suggestions. Use arrow keys and Enter to choose.`; return; }
    const revision = this.revision;
    this.timer = setTimeout(async () => {
      const request = this.request = new AbortController();
      try {
        const places = await this.search.search(query, this.bias, request.signal);
        if (revision !== this.revision || request.signal.aborted) return;
        this.choices = [...matchStops(this.stops(), query), ...places].slice(0, 8);
        this.draw(this.choices.length ? `${this.choices.length} suggestions. Use arrow keys and Enter to choose.` : 'No matches. Try another name or use the map.');
      } catch { if (revision === this.revision && !request.signal.aborted) this.draw('Address search is unavailable. Choose a stop or use the map.'); }
    }, 500);
  }
  private draw(message: string) {
    this.list.innerHTML = this.choices.map((place, index) => `<li id="${this.input.id}-option-${index}" role="option" aria-selected="${index === this.active}" data-choice="${index}"><span class="place-kind" aria-hidden="true">${place.kind === 'stop' ? '○' : '⌖'}</span><span><strong>${e(place.label)}</strong><small>${e(place.detail)}</small></span></li>`).join('');
    this.list.hidden = !this.choices.length; this.input.setAttribute('aria-expanded', String(!!this.choices.length));
    if (this.active >= 0) { this.input.setAttribute('aria-activedescendant', `${this.input.id}-option-${this.active}`); this.list.children[this.active]?.scrollIntoView({ block: 'nearest' }); } else this.input.removeAttribute('aria-activedescendant');
    this.status.textContent = message;
  }
  close() { clearTimeout(this.timer); this.request?.abort(); this.revision++; this.active = -1; this.choices = []; this.list.hidden = true; this.input.setAttribute('aria-expanded', 'false'); this.input.removeAttribute('aria-activedescendant'); this.status.textContent = ''; }
  destroy() { this.close(); this.lifetime.abort(); }
}
