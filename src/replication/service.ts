import type { Agency, Coordinate, Departure, Network, Route, RouteDetail, RoutePattern, Stop, StopDetail, Vehicle } from '../types';
import type { PassioSystemInfo, PassioTimetable, PassioJourneyComparison } from '../api/passio';
import type { ApiClient } from '../api/client';
import { MergeSession, type Crosswalk, type MergeCounts, type Observation, type SourceIdentity } from './merge';
import { SnapshotStore } from './store';

export interface TransitProvider {
  readonly client: ApiClient;
  listRoutes(): Promise<Route[]>;
  getRoute(id: string): Promise<RouteDetail>;
  getStop(id: string): Promise<StopDetail>;
  getNetwork(): Promise<Network>;
  refreshVehicles(): Promise<Vehicle[]>;
  getMessages(): Promise<string[]>;
  getSystemInfo?(): Promise<PassioSystemInfo>;
  searchBuses?(query: string): Promise<Vehicle[]>;
  getTimetable?(stopId: string, routeId?: string): Promise<PassioTimetable>;
  compareJourney?(from: Coordinate, to: Coordinate): Promise<PassioJourneyComparison>;
}
export interface ReplicaSource extends SourceIdentity { service: TransitProvider }
export interface SourceHealth { id: string; label: string; state: 'healthy' | 'degraded' | 'cached' | 'unavailable'; lastSuccessAt?: number; lastAttemptAt: number; error?: string; detail?: string }
export interface ReplicationReport extends MergeCounts {
  label: string; mode: 'replicas' | 'providers'; total: number; healthy: number; sources: SourceHealth[]; lastSyncAt?: number;
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const arrayOf = <T>(value: unknown, guard: (item: unknown) => item is T): value is T[] => Array.isArray(value) && value.every(guard);
const point = (value: unknown): value is Coordinate => object(value) && Number.isFinite(value.lat) && Number.isFinite(value.lon) && Math.abs(Number(value.lat)) <= 90 && Math.abs(Number(value.lon)) <= 180;
const optional = (value: Record<string, unknown>, key: string, type: 'number' | 'string' | 'boolean') => value[key] === undefined || (typeof value[key] === type && (type !== 'number' || Number.isFinite(value[key])));
const provenance = (value: Record<string, unknown>) => optional(value, 'snapshotAt', 'number') && (value.agreement === undefined || ['corroborated','single-source','conflict','stale-backup'].includes(String(value.agreement))) && (value.sources === undefined || arrayOf(value.sources, (ref): ref is {source:string;id:string;fetchedAt:number} => object(ref) && typeof ref.source === 'string' && typeof ref.id === 'string' && Number.isFinite(ref.fetchedAt) && optional(ref, 'cached', 'boolean')));
const isStop = (value: unknown): value is Stop => object(value) && point(value) && typeof value.id === 'string' && typeof value.name === 'string' && provenance(value);
const isRoute = (value: unknown): value is Route => object(value) && ['id', 'name', 'shortName', 'color', 'agencyId'].every(key => typeof value[key] === 'string') && typeof value.active === 'boolean' && (value.availability === undefined || ['current','published','unknown'].includes(String(value.availability))) && provenance(value);
const isVehicle = (value: unknown): value is Vehicle => point(value) && object(value) && typeof value.id === 'string' && typeof value.routeId === 'string' && Number.isFinite(value.heading) && ['updatedAt','speed'].every(key => optional(value,key,'number')) && ['tripId','destination'].every(key => optional(value,key,'string')) && provenance(value);
const isDeparture = (value: unknown): value is Departure => object(value) && typeof value.stopId === 'string' && typeof value.routeId === 'string' && Number.isFinite(value.arrivalTime) && ['updatedAt','departureTime'].every(key => optional(value,key,'number')) && ['tripId','direction','vehicleId'].every(key => optional(value,key,'string')) && optional(value,'scheduled','boolean') && provenance(value);
const isPattern = (value: unknown): value is RoutePattern => object(value) && ['id', 'routeId', 'direction'].every(key => typeof value[key] === 'string') && arrayOf(value.stops, isStop) && arrayOf(value.shape, point) && optional(value,'loop','boolean') && provenance(value) && (value.shapeSegments === undefined || arrayOf(value.shapeSegments, (part): part is Coordinate[] => arrayOf(part, point)));
const isStrings = (value: unknown): value is string[] => arrayOf(value, (item): item is string => typeof item === 'string');
const isDetail = (value: unknown): value is RouteDetail => object(value) && isRoute(value.route) && arrayOf(value.patterns, isPattern) && arrayOf(value.stops, isStop) && arrayOf(value.vehicles, isVehicle) && arrayOf(value.departures, isDeparture) && isStrings(value.messages) && isStrings(value.warnings);
const isNetwork = (value: unknown): value is Network => object(value) && typeof value.agencyId === 'string' && Number.isFinite(value.updatedAt) && arrayOf(value.routes, isRoute) && arrayOf(value.patterns, isPattern) && arrayOf(value.stops, isStop) && arrayOf(value.vehicles, isVehicle) && arrayOf(value.departures, isDeparture) && isStrings(value.messages) && isStrings(value.warnings);
const isStopDetail = (value: unknown): value is StopDetail => object(value) && isStop(value.stop) && arrayOf(value.departures, isDeparture);
const problem = (error: unknown) => error instanceof Error ? error.message : 'Transit source unavailable.';

/** Concurrent crawling, persistent last-good replicas, identity-aware reconciliation. */
export class ReplicatedTransitService implements TransitProvider {
  readonly client: ApiClient;
  readonly report: ReplicationReport;
  private health = new Map<string, SourceHealth>();
  private resourceHealth = new Map<string, SourceHealth>();
  private pending = new Map<string, Promise<unknown>>();
  private sourceCalls = new Map<string, Promise<unknown>>();
  private catalog = new Map<string, Set<string>>();
  private stopDirectory = new Map<string, Set<string>>();
  private lastNetwork?: Network;
  private resultMeta = new Map<string, { cached: boolean; at: number }>();
  constructor(readonly agency: Agency, private sources: ReplicaSource[], private aliases: Crosswalk = { routes: [], stops: [], vehicles: [] }, private store = new SnapshotStore(), private now = Date.now, mode: 'replicas' | 'providers' = 'providers', private sourceDeadlineMs = 30000) {
    if (!sources.length || new Set(sources.map(source => source.id)).size !== sources.length) throw new Error('Replication requires distinct, configured sources.');
    this.client = sources[0].service.client;
    this.report = { label: agency.name, mode, total: sources.length, healthy: 0, sources: [], agreements: 0, conflicts: 0, singleSource: 0, cached: 0 };
  }
  private recordHealth(source: ReplicaSource, operation: string, health: SourceHealth) {
    // UGA has no public-messages endpoint; an empty local placeholder is not evidence of recovery.
    if (operation === 'messages' && source.aliasKey === 'uga') return;
    this.resourceHealth.set(`${source.id}:${operation}`, health);
    const recent = [...this.resourceHealth.values()].filter(value => value.id === source.id && this.now() - value.lastAttemptAt <= 300000);
    const responding = recent.some(value => value.state === 'healthy' || value.state === 'degraded');
    const errors = [...new Set(recent.map(value => value.error).filter(Boolean))].join(' ');
    const state = responding ? recent.some(value => value.state !== 'healthy') ? 'degraded' : 'healthy' : recent.some(value => value.state === 'cached') ? 'cached' : 'unavailable';
    this.health.set(source.id, { ...health, state, error: errors || undefined, lastSuccessAt: Math.max(0, ...recent.map(value => value.lastSuccessAt ?? 0)) || undefined });
  }
  private async collect<T>(operation: string, invoke: (source: ReplicaSource) => Promise<T>, valid: (value: unknown) => value is T, sources = this.sources): Promise<Observation<T>[]> {
    const results = await Promise.all(sources.map(async source => {
      const key = `${this.agency.id}:${source.id}:${operation}`;
      const at = this.now(); const previous = this.health.get(source.id);
      try {
        const childOperation = operation.startsWith('route:') ? `route:${this.session().native('routes', operation.slice(6), source)}` : operation.startsWith('stop:') ? `stop:${this.session().native('stops', operation.slice(5), source)}` : operation;
        let running = this.sourceCalls.get(key) as Promise<T> | undefined;
        if (!running) {
          running = Promise.resolve().then(() => invoke(source)).then(value => {
            if (!valid(value)) throw new Error('Transit response failed normalized schema validation.');
            const metadata = source.service instanceof ReplicatedTransitService ? source.service.getResultMeta(childOperation) : undefined;
            this.store.put(key, value, metadata?.cached ? metadata.at : this.now());
            return value;
          }).finally(() => this.sourceCalls.delete(key));
          this.sourceCalls.set(key, running);
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Source crawl timed out; remaining replicas are used.')), this.sourceDeadlineMs); });
        let value: T;
        try { value = await Promise.race([running, deadline]); } finally { clearTimeout(timer); }
        if (!valid(value)) throw new Error('Transit response failed normalized schema validation.');
        const childMeta = source.service instanceof ReplicatedTransitService ? source.service.getResultMeta(childOperation) : undefined;
        const wasCached = childMeta?.cached === true;
        const received = wasCached ? childMeta.at : this.now(); this.store.put(key, value, received);
        const warnings = object(value) && Array.isArray(value.warnings) ? value.warnings : [];
        const child = source.service instanceof ReplicatedTransitService ? source.service.report : undefined;
        const degraded = warnings.length > 0 || (child && child.healthy < child.total);
        this.recordHealth(source, operation, { id: source.id, label: source.label, state: wasCached ? 'cached' : degraded ? 'degraded' : 'healthy', lastAttemptAt: at, lastSuccessAt: received, detail: child ? `${child.healthy}/${child.total} backend nodes responding` : undefined });
        return { source, value, at: received, cached: wasCached } as Observation<T>;
      } catch (error) {
        let saved = this.store.get(key, valid);
        // A full network snapshot can restore core views even after smaller LRU entries expired.
        if (!saved) {
          const network = this.store.get(`${this.agency.id}:${source.id}:network`, isNetwork);
          if (network) {
            let recovered: unknown;
            if (operation === 'routes') recovered = network.value.routes;
            if (operation === 'vehicles') recovered = network.value.vehicles;
            if (operation === 'messages') recovered = network.value.messages;
            if (operation.startsWith('route:')) {
              const id = this.session().native('routes', operation.slice(6), source);
              const route = network.value.routes.find(value => value.id === id);
              if (route) { const patterns = network.value.patterns.filter(value => value.routeId === id); const ids = new Set(patterns.flatMap(pattern => pattern.stops.map(stop => stop.id))); recovered = { route, patterns, stops: network.value.stops.filter(stop => ids.has(stop.id)), vehicles: network.value.vehicles.filter(bus => bus.routeId === id), departures: network.value.departures.filter(value => value.routeId === id), messages: network.value.messages, warnings: network.value.warnings }; }
            }
            if (operation.startsWith('stop:')) {
              const id = this.session().native('stops', operation.slice(5), source), stop = network.value.stops.find(value => value.id === id);
              if (stop) recovered = { stop, departures: network.value.departures.filter(value => value.stopId === id) };
            }
            if (valid(recovered)) saved = { at: network.at, value: recovered };
          }
        }
        this.recordHealth(source, operation, { id: source.id, label: source.label, state: saved ? 'cached' : 'unavailable', lastAttemptAt: at, lastSuccessAt: saved?.at ?? previous?.lastSuccessAt, error: problem(error) });
        return saved ? { source, value: saved.value, at: saved.at, cached: true } as Observation<T> : undefined;
      }
    }));
    this.report.sources = this.sources.map(source => this.health.get(source.id)).filter((value): value is SourceHealth => !!value);
    this.report.healthy = this.report.sources.filter(source => source.state === 'healthy' || source.state === 'degraded').length;
    this.report.lastSyncAt = this.now();
    const values = results.filter((value): value is Observation<T> => !!value);
    if (!values.length) throw new Error(`All available transit sources failed. ${sources.map(source => `${source.label}: ${this.health.get(source.id)?.error ?? 'No data'}`).join(' ')}`);
    const allCached = values.every(value => value.cached);
    this.resultMeta.set(operation, { cached: allCached, at: allCached ? Math.max(...values.map(value => value.at)) : this.now() });
    return values;
  }
  private run<T>(key: string, invoke: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key); if (existing) return existing as Promise<T>;
    const promise = invoke().finally(() => this.pending.delete(key)); this.pending.set(key, promise); return promise;
  }
  private session() { return new MergeSession(this.aliases, this.now(), this.agency.id); }
  private finish(session: MergeSession) { Object.assign(this.report, session.counts); }
  private warnings(input: Observation<unknown>[], session: MergeSession): string[] {
    const warnings: string[] = [];
    const failed = this.report.sources.filter(source => source.state === 'unavailable' || source.state === 'cached');
    if (failed.length) warnings.push(`Backup data in use: ${failed.map(source => source.label).join(', ')} ${failed.length === 1 ? 'is' : 'are'} unavailable.`);
    if (input.some(value => value.cached)) warnings.push('Showing saved transit snapshots. Original observation times are preserved; snapshots older than two minutes cannot establish current service for planning.');
    if (session.counts.conflicts) warnings.push(`${session.counts.conflicts} data disagreements detected. Matching reports take precedence; disputed stop sequences are excluded from trip planning.`);
    return warnings;
  }
  private remember(input: Observation<RouteDetail | Network>[]) {
    for (const observation of input) this.stopDirectory.set(observation.source.id, new Set(observation.value.stops.map(stop => stop.id)));
  }
  async listRoutes(): Promise<Route[]> {
    return this.run('routes', async () => {
      const input = await this.collect('routes', source => source.service.listRoutes(), (value): value is Route[] => arrayOf(value, isRoute));
      input.forEach(value => this.catalog.set(value.source.id, new Set(value.value.map(route => route.id))));
      const session = this.session(), routes = session.routes(input); this.finish(session); return routes;
    });
  }
  async getRoute(id: string): Promise<RouteDetail> {
    return this.run(`route:${id}`, async () => {
      if (!this.catalog.size) await this.listRoutes();
      const session = this.session();
      const eligible = this.sources.filter(source => { const native = session.native('routes', id, source); return native !== undefined && (!this.catalog.has(source.id) || this.catalog.get(source.id)!.has(native)); });
      if (!eligible.length) throw new Error('No source supplies this route.');
      const input = await this.collect(`route:${id}`, source => source.service.getRoute(session.native('routes', id, source)!), isDetail, eligible);
      this.remember(input);
      const result = session.route(input); result.warnings = [...new Set([...result.warnings, ...this.warnings(input, session)])]; this.finish(session); return result;
    });
  }
  async getStop(id: string): Promise<StopDetail> {
    return this.run(`stop:${id}`, async () => {
      const session = this.session();
      const eligible = this.sources.filter(source => { const native = session.native('stops', id, source); return native !== undefined && (!this.stopDirectory.has(source.id) || this.stopDirectory.get(source.id)!.has(native)); });
      if (!eligible.length) throw new Error('No source supplies this stop.');
      const input = await this.collect(`stop:${id}`, source => source.service.getStop(session.native('stops', id, source)!), isStopDetail, eligible);
      const result = session.stopDetail(input); this.finish(session); return result;
    });
  }
  async getNetwork(): Promise<Network> {
    return this.run('network', async () => {
      const input = await this.collect('network', source => source.service.getNetwork(), isNetwork);
      for (const observation of input) this.catalog.set(observation.source.id, new Set(observation.value.routes.map(route => route.id)));
      this.remember(input);
      const session = this.session(), result = session.network(input);
      result.warnings = [...new Set([...result.warnings, ...this.warnings(input, session)])]; this.lastNetwork = result; this.finish(session); return result;
    });
  }
  /** Full configured-network crawl; only public transit data is retained. */
  async sync(): Promise<Network> { return this.getNetwork(); }
  /** Lightweight periodic crawl. Large stop-prediction batches remain on-demand. */
  async crawlLive(): Promise<void> { await Promise.allSettled([this.listRoutes(), this.refreshVehicles(), this.getMessages()]); }
  async refreshVehicles(): Promise<Vehicle[]> {
    return this.run('vehicles', async () => {
      const input = await this.collect('vehicles', source => source.service.refreshVehicles(), (value): value is Vehicle[] => arrayOf(value, isVehicle));
      const session = this.session(), result = session.vehicles(input); this.finish(session); return result;
    });
  }
  async getMessages(): Promise<string[]> {
    return this.run('messages', async () => {
      const input = await this.collect('messages', source => source.service.getMessages(), isStrings);
      return this.session().messages(input);
    });
  }
  get cachedNetwork(): Network | undefined { return this.lastNetwork; }
  getResultMeta(operation: string) { return this.resultMeta.get(operation); }
  private passioSources(routeId?: string, stopId?: string): ReplicaSource[] {
    const session = this.session();
    return this.sources.filter(source => {
      if (!source.service.getSystemInfo) return false;
      const route = routeId ? session.native('routes', routeId, source) : undefined;
      const stop = stopId ? session.native('stops', stopId, source) : undefined;
      if (routeId && route === undefined || stopId && stop === undefined) return false;
      return !(source.service instanceof ReplicatedTransitService) || source.service.hasPassioFor(route, stop);
    });
  }
  hasPassioFor(routeId?: string, stopId?: string): boolean { return this.passioSources(routeId, stopId).length > 0; }
  private utilityWinner<T>(input: Observation<T>[]): T {
    const groups = new Map<string, Observation<T>[]>();
    for (const value of input) { const key = JSON.stringify(value.value); const list = groups.get(key) ?? []; list.push(value); groups.set(key, list); }
    const best = [...groups.values()].sort((a, b) => b.filter(value => !value.cached).length - a.filter(value => !value.cached).length || a[0].source.priority - b[0].source.priority)[0];
    return best.sort((a, b) => Number(a.cached) - Number(b.cached) || a.source.priority - b.source.priority)[0].value;
  }
  async getSystemInfo(): Promise<PassioSystemInfo> {
    const sources = this.passioSources(); if (!sources.length) throw new Error('This network has no Passio metadata service.');
    const input = await this.collect('system-info', source => source.service.getSystemInfo!(), (value): value is PassioSystemInfo => object(value) && typeof value.id === 'string' && typeof value.name === 'string' && Array.isArray(value.routeGroups), sources);
    return this.utilityWinner(input);
  }
  async searchBuses(query: string): Promise<Vehicle[]> {
    const sources = this.passioSources(); if (!sources.length) throw new Error('This network has no Passio bus search.');
    const input = await this.collect(`search:${query}`, source => source.service.searchBuses!(query), (value): value is Vehicle[] => arrayOf(value, isVehicle), sources);
    const session = this.session(), result = session.vehicles(input); this.finish(session); return result;
  }
  async getTimetable(stopId: string, routeId?: string): Promise<PassioTimetable> {
    const sources = this.passioSources(routeId, stopId); if (!sources.length) throw new Error('This stop has no Passio timetable.');
    const session = this.session();
    const input = await this.collect(`timetable:${stopId}:${routeId ?? ''}`, source => source.service.getTimetable!(session.native('stops', stopId, source)!, routeId ? session.native('routes', routeId, source) : undefined), (value): value is PassioTimetable => object(value) && typeof value.routeId === 'string' && typeof value.stopId === 'string' && isStrings(value.times), sources);
    return this.utilityWinner(input);
  }
  /** Explicit comparison only: coordinates are never persisted or used in a snapshot key. */
  async compareJourney(from: Coordinate, to: Coordinate): Promise<PassioJourneyComparison> {
    const sources = this.passioSources(); if (!sources.length) throw new Error('This network has no operator journey service.');
    const results = await Promise.allSettled(sources.map(source => source.service.compareJourney!(from, to)));
    const input = results.flatMap((result, index) => result.status === 'fulfilled' && object(result.value) && Array.isArray(result.value.routes) ? [{ source: sources[index], value: result.value, at: this.now(), cached: false }] : []);
    if (!input.length) throw new Error('The operator journey service is unavailable on every configured replica.');
    const result = this.utilityWinner(input);
    return { ...result, warnings: [...new Set([...result.warnings, ...(input.length < sources.length ? ['Some operator planner replicas were unavailable; this comparison uses the remaining response.'] : []), 'Operator suggestions are a separate comparison, not a quorum proof of the quickest trip.'])] };
  }
}
