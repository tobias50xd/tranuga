import type { Departure, Network, Provenance, Route, RouteDetail, RoutePattern, SourceRef, Stop, StopDetail, Vehicle } from '../types';
import { distanceMeters } from '../planner';

export interface AliasEntry { id: string; sources: Record<string, string | undefined>; directions?: { id: string; sources: Record<string, string | undefined> }[] }
export interface Crosswalk { routes: AliasEntry[]; stops: AliasEntry[]; vehicles: AliasEntry[] }
export interface SourceIdentity { id: string; label: string; priority: number; aliasKey?: string; prefix?: string }
export interface Observation<T> { source: SourceIdentity; at: number; value: T; cached: boolean }
export interface MergeCounts { agreements: number; conflicts: number; singleSource: number; cached: number }
const LIVE_BACKUP_MS = 120000;
const seq = (pattern: RoutePattern) => JSON.stringify(pattern.stops.map(stop => stop.id));
const samePattern = (a: RoutePattern, b: RoutePattern) => seq(a) === seq(b) && (a.loop === undefined || b.loop === undefined || a.loop === b.loop);
const group = <T>(values: T[], key: (value: T) => string) => {
  const groups = new Map<string, T[]>();
  for (const value of values) { const id = key(value); const items = groups.get(id) ?? []; items.push(value); groups.set(id, items); }
  return groups;
};
const mapValue = <T, U>(input: Observation<T>, value: U): Observation<U> => ({ ...input, value });
const cachedValue = (value: Provenance) => value.agreement === 'stale-backup' || !!value.sources?.length && value.sources.every(source => source.cached);
const snapshotTime = (value: Provenance, fallback: number) => Math.min(fallback, value.snapshotAt ?? (cachedValue(value) && value.sources?.length ? Math.min(...value.sources.map(source => source.fetchedAt)) : fallback));
function withRef<T extends Provenance>(value: T, observation: Observation<unknown>, id: string): T {
  return { ...value, sources: value.sources?.length ? value.sources : [{ source: observation.source.label, id, fetchedAt: observation.at, cached: observation.cached }] };
}

/** Pure, region-scoped merge. Never joins entities by name or proximity alone. */
export class MergeSession {
  readonly counts: MergeCounts = { agreements: 0, conflicts: 0, singleSource: 0, cached: 0 };
  constructor(private aliases: Crosswalk = { routes: [], stops: [], vehicles: [] }, private now = Date.now(), private agencyId = 'uga', private vehicleQuorum = 1) {}
  canonical(kind: 'routes' | 'stops' | 'vehicles', id: string, source: SourceIdentity): string {
    if (!source.aliasKey) return `${source.prefix ?? ''}${id}`;
    return this.aliases[kind].find(entry => entry.sources[source.aliasKey!] === id)?.id ?? `${source.prefix ?? ''}${id}`;
  }
  native(kind: 'routes' | 'stops', id: string, source: SourceIdentity): string | undefined {
    if (!source.aliasKey) return source.prefix && id.startsWith(source.prefix) ? id.slice(source.prefix.length) : source.prefix ? undefined : id;
    const known = this.aliases[kind].find(entry => entry.id === id)?.sources[source.aliasKey];
    if (known) return known;
    if (!source.prefix) return id;
    return id.startsWith(source.prefix) ? id.slice(source.prefix.length) : undefined;
  }
  direction(routeId: string, direction: string | undefined, source: SourceIdentity): string | undefined {
    if (direction === undefined) return undefined;
    const route = this.aliases.routes.find(entry => entry.id === routeId);
    return source.aliasKey ? route?.directions?.find(entry => entry.sources[source.aliasKey!] === direction)?.id ?? `${source.prefix ?? ''}${direction}` : direction;
  }
  private preferred<T>(items: Observation<T>[], observed?: (value: T) => number | undefined): Observation<T>[] {
    return [...items].sort((a, b) => {
      const ac = a.cached || !!a.value && typeof a.value === 'object' && cachedValue(a.value as Provenance);
      const bc = b.cached || !!b.value && typeof b.value === 'object' && cachedValue(b.value as Provenance);
      if (ac !== bc) return ac ? 1 : -1;
      if (observed) {
        const av = observed(a.value), bv = observed(b.value);
        const af = av !== undefined && this.now - av <= LIVE_BACKUP_MS && av <= this.now + 60000;
        const bf = bv !== undefined && this.now - bv <= LIVE_BACKUP_MS && bv <= this.now + 60000;
        if (af !== bf) return af ? -1 : 1;
        if (af && bf && av !== bv) return bv! - av!;
      }
      return a.source.priority - b.source.priority || b.at - a.at || a.source.id.localeCompare(b.source.id);
    });
  }
  private ballot<T extends Provenance>(input: Observation<T>[], compatible: (a: T, b: T) => boolean, observed?: (value: T) => number | undefined, voteable: (value: T) => boolean = () => true) {
    const values = this.preferred(input, observed);
    // At most one vote per source. Multiple rows from one feed cannot manufacture a quorum.
    const unique = new Map<string, Observation<T>>();
    for (const value of values) if (!value.cached && !cachedValue(value.value) && voteable(value.value) && !unique.has(value.source.id)) unique.set(value.source.id, value);
    const fresh = [...unique.values()];
    let clique: Observation<T>[] = [];
    // There are three replicas/providers. Explicit pairwise cliques avoid transitive tolerance chains.
    for (let mask = 1; mask < 2 ** fresh.length && fresh.length <= 8; mask++) {
      const candidate = fresh.filter((_, index) => mask & 2 ** index);
      if (candidate.length <= clique.length) continue;
      if (candidate.every((a, i) => candidate.slice(i + 1).every(b => compatible(a.value, b.value)))) clique = candidate;
    }
    const conflict = fresh.some((a, i) => fresh.slice(i + 1).some(b => !compatible(a.value, b.value)));
    return { values, fresh, clique, conflict };
  }
  private choose<T extends Provenance>(input: Observation<T>[], compatible: (a: T, b: T) => boolean, observed?: (value: T) => number | undefined, voteable: (value: T) => boolean = () => true): T {
    const { values, clique, conflict } = this.ballot(input, compatible, observed, voteable);
    const selected = this.preferred(clique.length >= 2 ? clique : values, observed)[0];
    const selectedCached = selected.cached || cachedValue(selected.value);
    const corroborated = clique.length >= 2;
    if (corroborated) this.counts.agreements++;
    else if (selectedCached) this.counts.cached++;
    else this.counts.singleSource++;
    if (conflict) this.counts.conflicts++;
    const sources: SourceRef[] = values.flatMap(value => value.value.sources?.length ? value.value.sources.map(ref => ({ ...ref, cached: value.cached || ref.cached })) : [{ source: value.source.label, id: value.value && 'id' in value.value ? String(value.value.id) : '', fetchedAt: value.at, cached: value.cached }]);
    return { ...selected.value, snapshotAt: snapshotTime(selected.value, selected.at), sources: [...new Map(sources.map(ref => [`${ref.source}:${ref.id}`, ref])).values()], agreement: selectedCached ? 'stale-backup' : corroborated ? 'corroborated' : conflict ? 'conflict' : 'single-source' };
  }
  routes(input: Observation<Route[]>[]): Route[] {
    const values = input.flatMap(observation => observation.value.map(route => mapValue(observation, { ...withRef(route, observation, route.id), id: this.canonical('routes', route.id, observation.source), agencyId: this.agencyId, active: route.active && (!(observation.cached || cachedValue(route)) || this.now - snapshotTime(route, observation.at) <= LIVE_BACKUP_MS) })));
    return [...group(values, value => value.value.id).values()].map(items => {
      const current = items.filter(item => item.value.availability !== 'published' && item.value.availability !== 'unknown' && !item.cached && !cachedValue(item.value));
      const selected = this.choose(current.length ? current : items, (a, b) => a.active === b.active && a.availability === b.availability);
      const sources = items.flatMap(item => item.value.sources?.map(ref => ({ ...ref, cached: item.cached || ref.cached })) ?? []);
      return { ...selected, sources: [...new Map(sources.map(ref => [`${ref.source}:${ref.id}`, ref])).values()] };
    });
  }
  private stop(stop: Stop, source: SourceIdentity): Stop { return { ...stop, id: this.canonical('stops', stop.id, source) }; }
  stops(input: Observation<Stop[]>[]): Stop[] {
    const values = input.flatMap(observation => observation.value.map(stop => mapValue(observation, this.stop(withRef(stop, observation, stop.id), observation.source))));
    return [...group(values, value => value.value.id).values()].map(items => this.choose(items, (a, b) => distanceMeters(a, b) <= 50));
  }
  patterns(input: Observation<RoutePattern[]>[]): RoutePattern[] {
    const values = input.flatMap(observation => observation.value.map(pattern => {
      const routeId = this.canonical('routes', pattern.routeId, observation.source);
      return mapValue(observation, { ...withRef(pattern, observation, pattern.id), routeId, direction: this.direction(routeId, pattern.direction, observation.source)!, stops: pattern.stops.map(stop => this.stop(stop, observation.source)) });
    }));
    return [...group(values, value => `${value.value.routeId}\0${value.value.direction}`).values()].map(items => {
      const before = { ...this.counts };
      const selected = this.choose(items, samePattern);
      const agreeing = this.preferred(items.filter(item => samePattern(item.value, selected)));
      const shapeSource = agreeing.find(item => item.value.shape.length > 1 || item.value.shapeSegments?.length);
      const closureMap = new Map<string, Observation<RoutePattern>>();
      for (const item of this.preferred(items)) if (seq(item.value) === seq(selected) && !item.cached && !cachedValue(item.value) && item.value.loop !== undefined && !closureMap.has(item.source.id)) closureMap.set(item.source.id, item);
      const closure = [...closureMap.values()];
      const trueVotes = new Set(closure.filter(item => item.value.loop).map(item => item.source.id)).size;
      const falseVotes = new Set(closure.filter(item => !item.value.loop).map(item => item.source.id)).size;
      const loopConflict = trueVotes > 0 && falseVotes > 0 && Math.max(trueVotes, falseVotes) < 2;
      if (loopConflict) { this.counts.conflicts = before.conflicts + 1; this.counts.agreements = before.agreements; this.counts.singleSource = before.singleSource + 1; }
      const loop = loopConflict ? undefined : trueVotes > falseVotes ? true : falseVotes ? false : agreeing.find(item => item.value.loop !== undefined)?.value.loop;
      return { ...selected, id: `merged:${selected.routeId}:${selected.direction}`, loop, agreement: loopConflict ? 'conflict' : selected.agreement, ...(shapeSource ? { shape: shapeSource.value.shape, shapeSegments: shapeSource.value.shapeSegments } : {}) };
    });
  }
  vehicles(input: Observation<Vehicle[]>[]): Vehicle[] {
    const values = input.flatMap(observation => observation.value.filter(bus => !(observation.cached || cachedValue(bus)) || this.now - snapshotTime(bus, observation.at) <= 300000).map(bus => mapValue(observation, { ...withRef(bus, observation, bus.id), id: this.canonical('vehicles', bus.id, observation.source), routeId: this.canonical('routes', bus.routeId, observation.source) })));
    const result: Vehicle[] = [];
    for (const grouped of group(values, value => value.value.id).values()) {
      // A current marker always supersedes an explicitly outdated duplicate.
      const hasActive = grouped.some(item => !item.cached && !cachedValue(item.value) && item.value.active === true);
      const items = hasActive ? grouped.filter(item => item.value.active !== false) : grouped;
      const compatible = (a: Vehicle, b: Vehicle) => a.routeId === b.routeId && distanceMeters(a, b) <= 100 && (a.updatedAt === undefined || b.updatedAt === undefined || Math.abs(a.updatedAt - b.updatedAt) <= 60000);
      const voteable = (value: Vehicle) => value.active !== false && (value.active === true || value.updatedAt !== undefined && this.now - value.updatedAt <= LIVE_BACKUP_MS && value.updatedAt <= this.now + 60000);
      const ballot = this.ballot(items, compatible, value => value.updatedAt, voteable);
      if (this.vehicleQuorum > 1 && ballot.clique.length < this.vehicleQuorum) {
        if (ballot.conflict) this.counts.conflicts++;
        else if (ballot.values.every(item => item.cached || cachedValue(item.value))) this.counts.cached++;
        else this.counts.singleSource++;
        continue;
      }
      result.push(this.choose(items, compatible, value => value.updatedAt, voteable));
    }
    return result;
  }
  departures(input: Observation<Departure[]>[]): Departure[] {
    const values = input.filter(observation => !observation.cached || this.now - observation.at <= LIVE_BACKUP_MS).flatMap(observation => observation.value.filter(departure => (departure.departureTime ?? departure.arrivalTime) >= this.now - 30000 && (!cachedValue(departure) || this.now - snapshotTime(departure, observation.at) <= LIVE_BACKUP_MS) && (departure.updatedAt === undefined || this.now - departure.updatedAt <= 180000 && departure.updatedAt <= this.now + 60000)).map(departure => {
      const routeId = this.canonical('routes', departure.routeId, observation.source);
      return mapValue(observation, { ...withRef(departure, observation, `${departure.routeId}:${departure.stopId}:${departure.arrivalTime}`), routeId, stopId: this.canonical('stops', departure.stopId, observation.source), direction: this.direction(routeId, departure.direction, observation.source), vehicleId: departure.vehicleId ? this.canonical('vehicles', departure.vehicleId, observation.source) : undefined });
    }));
    const compatible = (a: Departure, b: Departure) => Math.abs(a.arrivalTime - b.arrivalTime) <= 90000 && Math.abs((a.departureTime ?? a.arrivalTime) - (b.departureTime ?? b.arrivalTime)) <= 90000 && !!a.scheduled === !!b.scheduled && (!a.tripId || !b.tripId || a.tripId === b.tripId) && (!a.vehicleId || !b.vehicleId || a.vehicleId === b.vehicleId);
    const pickRun = (run: Observation<Departure>[]) => {
      const live = run.filter(item => !item.cached && !cachedValue(item.value) && !item.value.scheduled);
      const mixed = live.length > 0 && run.some(item => item.value.scheduled);
      const selected = this.choose(mixed ? live : run, compatible);
      if (!mixed) return selected;
      this.counts.conflicts++;
      return { ...selected, agreement: selected.agreement === 'corroborated' ? 'corroborated' as const : 'conflict' as const, sources: run.flatMap(item => item.value.sources ?? []) };
    };
    const result: Departure[] = [];
    for (const items of group(values, value => JSON.stringify([value.value.routeId, value.value.stopId, value.value.direction])).values()) {
      const known: Observation<Departure>[][] = [];
      const claimed = new Set<Observation<Departure>>();
      for (const run of group(items.filter(value => value.value.tripId), value => value.value.tripId!).values()) {
        // A repeated visit in one feed is not another source's vote for the same visit.
        if (new Set(run.map(value => value.source.id)).size !== run.length) continue;
        known.push(run); run.forEach(value => claimed.add(value));
      }
      const unmatched = items.filter(value => !claimed.has(value));
      const previews = known.map(run => { const before = { ...this.counts }; const value = pickRun(run); Object.assign(this.counts, before); return value; });
      for (const unknown of [...unmatched]) {
        if (unknown.value.tripId) continue;
        const matches = known.map((run, index) => ({ run, index })).filter(({ run, index }) => !run.some(value => value.source.id === unknown.source.id) && compatible(unknown.value, previews[index]));
        if (matches.length !== 1) continue;
        const { run, index } = matches[0];
        if (unmatched.filter(value => value.source.id === unknown.source.id && compatible(value.value, previews[index])).length !== 1) continue;
        run.push(unknown); claimed.add(unknown);
      }
      known.forEach(run => result.push(pickRun(run)));
      const remaining = items.filter(value => !claimed.has(value)).sort((a, b) => a.value.arrivalTime - b.value.arrivalTime);
      while (remaining.length) {
        const first = remaining.shift()!, candidates = [first];
        for (const sourceId of new Set(remaining.map(value => value.source.id))) {
          if (sourceId === first.source.id) continue;
          const matches = remaining.filter(value => value.source.id === sourceId && candidates.every(candidate => compatible(candidate.value, value.value)));
          // Unidentified predictions must be uniquely matchable in both directions.
          if (matches.length !== 1) continue;
          const match = matches[0];
          if (items.filter(value => value.source.id === first.source.id && compatible(value.value, match.value)).length !== 1 || items.filter(value => value.source.id === match.source.id && compatible(value.value, first.value)).length !== 1) continue;
          candidates.push(match); remaining.splice(remaining.indexOf(match), 1);
        }
        result.push(this.choose(candidates, compatible));
      }
    }
    return result.sort((a, b) => a.arrivalTime - b.arrivalTime);
  }
  messages(input: Observation<string[]>[]): string[] { return [...new Set(input.flatMap(observation => observation.value))]; }
  network(input: Observation<Network>[]): Network {
    let routes = this.routes(input.map(value => mapValue(value, value.value.routes)));
    const vehicles = this.vehicles(input.map(value => mapValue(value, value.value.vehicles)));
    const departures = this.departures(input.map(value => mapValue(value, value.value.departures)));
    routes = routes.map(route => {
      if (route.availability !== 'published' && route.availability !== 'unknown') return route;
      const running = route.active && (vehicles.some(bus => bus.routeId === route.id && bus.updatedAt !== undefined && this.now - bus.updatedAt <= LIVE_BACKUP_MS && bus.updatedAt <= this.now + 60000) || departures.some(departure => departure.routeId === route.id && !departure.scheduled && departure.arrivalTime >= this.now && departure.arrivalTime <= this.now + 10800000 && departure.updatedAt !== undefined && this.now - departure.updatedAt <= 180000 && departure.updatedAt <= this.now + 60000));
      return { ...route, active: running, availability: running ? 'current' : 'unknown' };
    });
    const allPatterns = this.patterns(input.map(value => mapValue(value, value.value.patterns)));
    const patterns = allPatterns.filter(pattern => pattern.agreement !== 'conflict');
    const stops = this.stops(input.map(value => mapValue(value, [...value.value.stops, ...value.value.patterns.flatMap(pattern => pattern.stops)])));
    return { agencyId: this.agencyId, routes, patterns, stops, vehicles, departures, messages: this.messages(input.map(value => mapValue(value, value.value.messages))), updatedAt: Math.max(...input.map(value => value.value.updatedAt)), warnings: [...new Set([...input.flatMap(value => value.value.warnings), ...(routes.some(route => route.availability === 'unknown') ? ['Published routes without current-service evidence are excluded from planning.'] : []), ...(allPatterns.length > patterns.length ? [`${allPatterns.length - patterns.length} disputed stop sequences are excluded from planning until sources agree.`] : [])])] };
  }
  route(input: Observation<RouteDetail>[]): RouteDetail {
    return { route: this.routes(input.map(value => mapValue(value, [value.value.route])))[0], patterns: this.patterns(input.map(value => mapValue(value, value.value.patterns))), stops: this.stops(input.map(value => mapValue(value, value.value.stops))), vehicles: this.vehicles(input.map(value => mapValue(value, value.value.vehicles))), departures: this.departures(input.map(value => mapValue(value, value.value.departures))), messages: this.messages(input.map(value => mapValue(value, value.value.messages))), warnings: [...new Set(input.flatMap(value => value.value.warnings))] };
  }
  stopDetail(input: Observation<StopDetail>[]): StopDetail {
    return { stop: this.stops(input.map(value => mapValue(value, [value.value.stop])))[0], departures: this.departures(input.map(value => mapValue(value, value.value.departures))) };
  }
}
