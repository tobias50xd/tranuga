import authoritySnapshot from '../data/authorities.json';
import type { Agency, Coordinate, Departure, Network, Route, RouteDetail, RoutePattern, Stop, StopDetail, Vehicle } from '../types';
import { ApiClient } from './client';
import { discoveryEndpoints, infoEndpoints, kmlEndpoint, ugaEndpoints } from './endpoints';
import { infoDepartures, list, messages, normalizeAgencies, normalizeRoutes, normalizeStops, normalizeVehicles, parseKml, record, rows, text, ugaDepartures, uniqueStops } from './normalize';
import { infoPatterns, ugaTopology, ugaTrackingPatterns, withDirectionStops, type UgaTopology } from './topology';

export { ApiClient } from './client';
export { discoveryEndpoints, infoEndpoints, kmlEndpoint, ugaEndpoints } from './endpoints';
export const UGA_AGENCY: Agency = { id: 'uga', name: 'UGA + Athens', kind: 'uga', center: { lat: 33.948, lon: -83.377 } };
export const KNOWN_AGENCIES: Agency[] = authoritySnapshot as Agency[];
export async function discoverAgencies(client = new ApiClient()): Promise<Agency[]> { return normalizeAgencies(await client.get(discoveryEndpoints.all, 3600000)); }
export async function locateAgencies(point: Coordinate, client = new ApiClient()): Promise<Agency[]> {
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lon) || Math.abs(point.lat) > 90 || Math.abs(point.lon) > 180) throw new Error('Choose valid coordinates to locate an agency.');
  return normalizeAgencies(await client.get(discoveryEndpoints.locate(point), 60000));
}
export async function findAgenciesByCode(code: string, client = new ApiClient()): Promise<Agency[]> {
  if (!code.trim()) throw new Error('Enter an agency code.');
  return normalizeAgencies(await client.get(discoveryEndpoints.code(code.trim()), 60000));
}
async function concurrent<T, U>(values: T[], fn: (value: T) => Promise<U>, limit = 4): Promise<PromiseSettledResult<U>[]> {
  const result: PromiseSettledResult<U>[] = new Array(values.length); let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (index < values.length) { const at = index++; try { result[at] = { status: 'fulfilled', value: await fn(values[at]) }; } catch (reason) { result[at] = { status: 'rejected', reason }; } }
  })); return result;
}
const failure = (error: unknown) => error instanceof Error ? error.message : 'Transit request failed.';
const staleWarning = (vehicles: Vehicle[]) => vehicles.some(v => !v.updatedAt || Date.now() - v.updatedAt > 120000) ? ['Some vehicle positions are older than two minutes or have no timestamp. Check their update time.'] : [];

export class TransitService {
  readonly client: ApiClient;
  private routes: Route[] = [];
  private topology?: UgaTopology;
  private topologyVersion?: string;
  private config: Record<string, unknown> = {};
  private cachedStops = new Map<string, Stop>();
  private recentDepartures = new Map<string, Departure[]>();
  constructor(readonly agency: Agency = UGA_AGENCY, client = new ApiClient()) {
    if (agency.kind === 'passio') throw new Error('Use PassioService for Passio agencies.');
    if (agency.kind === 'infopoint' && !agency.restUrl) throw new Error('Agency has no InfoPoint URL.');
    this.client = client;
  }
  async listRoutes(): Promise<Route[]> {
    if (this.agency.kind === 'uga') this.routes = normalizeRoutes(await this.client.get(ugaEndpoints.routes), this.agency.id, 'uga');
    else {
      const e = infoEndpoints(this.agency.restUrl!);
      const [all, visible, config] = await Promise.all([this.client.get(e.routes), this.client.get(e.visibleRoutes), this.client.get(e.config, 3600000)]);
      this.config = record(config);
      const every = normalizeRoutes(all, this.agency.id, 'infopoint'), shown = normalizeRoutes(visible, this.agency.id, 'infopoint'), ids = new Set(shown.map(r => r.id));
      this.routes = [...new Map([...every.map(r => ({ ...r, active: ids.has(r.id) })), ...shown].map(r => [r.id, r])).values()];
    }
    return this.routes;
  }
  async refreshVehicles(): Promise<Vehicle[]> {
    const data = await this.client.get(this.agency.kind === 'uga' ? ugaEndpoints.buses : infoEndpoints(this.agency.restUrl!).visibleRoutes, 10000);
    return normalizeVehicles(data, this.agency.kind === 'uga' ? 'uga' : 'infopoint');
  }
  async getMessages(): Promise<string[]> {
    return this.agency.kind === 'uga' ? [] : messages(await this.client.get(infoEndpoints(this.agency.restUrl!).messages, 60000));
  }
  private async staticNetwork(): Promise<UgaTopology> {
    const version = text(record(await this.client.get(ugaEndpoints.version, 300000)).version);
    if (!this.topology || version !== this.topologyVersion) { this.topology = ugaTopology(await this.client.get(ugaEndpoints.data, 300000)); this.topologyVersion = version; }
    return this.topology;
  }
  /** Stop names for search, without crawling arrival predictions. */
  async getStops(): Promise<Stop[]> {
    const stops = this.agency.kind === 'uga' ? (await this.staticNetwork()).stops : normalizeStops(await this.client.get(infoEndpoints(this.agency.restUrl!).stops, 300000));
    return [...new Map([...stops, ...this.cachedStops.values()].map(stop => [stop.id, stop])).values()];
  }
  async getRoute(routeId: string): Promise<RouteDetail> {
    if (!this.routes.length) await this.listRoutes();
    const route = this.routes.find(r => r.id === routeId); if (!route) throw new Error('This route is not in the current route catalog.');
    const warnings: string[] = [];
    if (this.agency.kind === 'uga') {
      const [topology, vehicles] = await Promise.all([this.staticNetwork().catch(error => { warnings.push(`Static topology unavailable: ${failure(error)}`); return { stops: [], patterns: [], shapes: new Map<string, Coordinate[]>() }; }), this.refreshVehicles().catch(error => { warnings.push(failure(error)); return []; })]);
      let patterns: RoutePattern[] = [], departures: Departure[] = [];
      try { const raw = await this.client.get(ugaEndpoints.tracking(routeId)); patterns = ugaTrackingPatterns(raw, routeId, topology); departures = ugaDepartures(raw); }
      catch (error) { warnings.push(`Live stop predictions unavailable: ${failure(error)}`); }
      if (!patterns.length) { patterns = topology.patterns.filter(p => p.routeId === routeId); warnings.push('Showing static stops; current stop availability could not be confirmed.'); }
      if (patterns.some(p => p.shape.length < 2)) warnings.push('Road trace unavailable; dashed stop connectors are approximate.');
      const stops = uniqueStops(patterns); stops.forEach(s => this.cachedStops.set(s.id, s));
      return { route, patterns, stops, vehicles: vehicles.filter(v => v.routeId === routeId), departures, messages: [], warnings: [...warnings, ...staleWarning(vehicles.filter(v => v.routeId === routeId))] };
    }
    const e = infoEndpoints(this.agency.restUrl!);
    const [raw, directionsRaw, routeStopsRaw] = await Promise.all([
      this.client.get(e.route(routeId)),
      this.client.get(e.directions(routeId), 300000).catch(error => { warnings.push(`Directions unavailable: ${failure(error)}`); return []; }),
      this.client.get(e.routeStops([routeId]), 300000).catch(error => { warnings.push(`Route stop directory unavailable: ${failure(error)}`); return []; }),
    ]);
    const row = record(raw); if (!row.RouteId) throw new Error('Route detail has an unsupported format.');
    let shape: Coordinate[] = [];
    if (text(row.RouteTraceFilename)) {
      try { const url = kmlEndpoint(this.config, text(row.RouteTraceFilename)); shape = parseKml(await this.client.get<string>(url, 3600000, 'text')); }
      catch (error) { warnings.push(`Road trace unavailable: ${failure(error)}`); }
    }
    let patterns = infoPatterns(raw, normalizeStops(routeStopsRaw), shape);
    const directions = rows(directionsRaw, 'Route directions').map(d => text(d.Dir)).filter(Boolean);
    const directionResults = await concurrent(directions, async direction => ({ direction, data: await this.client.get(e.directionStops(routeId, direction), 300000) }));
    for (const result of directionResults) {
      if (result.status === 'fulfilled') patterns = withDirectionStops(patterns, result.value.direction, result.value.data);
      else warnings.push(`Current direction stop list unavailable: ${failure(result.reason)}`);
    }
    const stops = [...new Map([...normalizeStops(routeStopsRaw), ...normalizeStops(Array.isArray(row.Stops) ? row.Stops : []), ...uniqueStops(patterns)].map(s => [s.id, s])).values()];
    stops.forEach(s => this.cachedStops.set(s.id, s));
    if (!shape.length) warnings.push('Road trace unavailable; dashed stop connectors are approximate.');
    const vehicles = normalizeVehicles([row], 'infopoint');
    return { route, patterns, stops, vehicles, departures: [...this.recentDepartures.values()].flat().filter(d => d.routeId === routeId), messages: messages(row.Messages), warnings: [...warnings, ...staleWarning(vehicles)] };
  }
  async getStop(stopId: string): Promise<StopDetail> {
    if (this.agency.kind === 'uga') {
      let stop = this.cachedStops.get(stopId);
      if (!stop) { const topology = await this.staticNetwork(); stop = topology.stops.find(s => s.id === stopId); }
      if (!stop) throw new Error('This stop is not in the current stop directory.');
      const departures = ugaDepartures(await this.client.get(ugaEndpoints.stop(stopId), 10000)); this.recentDepartures.set(stopId, departures);
      return { stop, departures };
    }
    const e = infoEndpoints(this.agency.restUrl!);
    const [rawStop, rawDepartures] = await Promise.all([this.client.get(e.stop(stopId), 300000), this.client.get(e.departures(stopId), 10000)]);
    const stop = normalizeStops([rawStop])[0]; if (!stop) throw new Error('Stop detail has no valid coordinates.');
    const departures = infoDepartures(rawDepartures); this.recentDepartures.set(stopId, departures); this.cachedStops.set(stopId, stop);
    return { stop, departures };
  }
  async getNetwork(): Promise<Network> {
    const routes = await this.listRoutes(), warnings: string[] = [];
    const [vehicles, publicMessages] = await Promise.all([
      this.refreshVehicles().catch(error => { warnings.push(`Live vehicles unavailable: ${failure(error)}`); return []; }),
      this.getMessages().catch(error => { warnings.push(`Service notices unavailable: ${failure(error)}`); return []; }),
    ]);
    let patterns: RoutePattern[] = [], departures: Departure[] = [];
    if (this.agency.kind === 'uga') {
      const topology = await this.staticNetwork().catch(error => { warnings.push(`Static topology unavailable; loop connections and road traces may be missing: ${failure(error)}`); return { stops: [], patterns: [], shapes: new Map<string, Coordinate[]>() }; });
      // Load every catalog route before the planner builds its graph. Current
      // service evidence is applied later; filtering here can hide a valid
      // transfer or a bus whose catalog flag has not caught up yet.
      const tracking = await concurrent(routes, async route => {
        const raw = await this.client.get(ugaEndpoints.tracking(route.id));
        return { routeId: route.id, patterns: ugaTrackingPatterns(raw, route.id, topology), departures: ugaDepartures(raw) };
      });
      tracking.forEach((result, i) => {
        const route = routes[i], staticPatterns = topology.patterns.filter(pattern => pattern.routeId === route.id);
        if (result.status === 'fulfilled') {
          patterns.push(...(result.value.patterns.length ? result.value.patterns : staticPatterns));
          departures.push(...result.value.departures);
          if (!result.value.patterns.length && staticPatterns.length) warnings.push(`Current stops unavailable for ${route.name}; verified static stop order is used with live vehicles and estimated timing.`);
          else if (!result.value.patterns.length) warnings.push(`Ordered stops unavailable for ${route.name}; this route cannot supply a planning edge.`);
        } else if (staticPatterns.length) {
          patterns.push(...staticPatterns);
          warnings.push(`Current stops unavailable for ${route.name}; verified static stop order is used with live vehicles and estimated timing.`);
        } else warnings.push(`Ordered stops unavailable for ${route.name}; this route cannot supply a planning edge.`);
      });
    } else {
      const e = infoEndpoints(this.agency.restUrl!);
      const [allDetails, allStops] = await Promise.all([this.client.get(e.allDetails, 300000), this.client.get(e.stops, 300000)]);
      const stops = normalizeStops(allStops);
      patterns = rows(allDetails, 'Route network').flatMap(row => infoPatterns(row, stops));
      const served = uniqueStops(patterns); served.forEach(s => this.cachedStops.set(s.id, s));
      const results = await concurrent(served, async stop => infoDepartures(await this.client.get(e.departures(stop.id), 15000)));
      results.forEach((result, i) => { if (result.status === 'fulfilled') { departures.push(...result.value); this.recentDepartures.set(served[i].id, result.value); } });
      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed) warnings.push(`Predictions unavailable at ${failed} stops; those legs use estimated wait times.`);
      const missing = routes.filter(r => !patterns.some(p => p.routeId === r.id));
      if (missing.length) warnings.push(`Ordered stop data unavailable for ${missing.map(r => r.shortName).join(', ')}; these routes are excluded from planning.`);
    }
    const stops = uniqueStops(patterns); stops.forEach(s => this.cachedStops.set(s.id, s));
    return { agencyId: this.agency.id, routes, stops, patterns, vehicles, departures, messages: publicMessages, updatedAt: Date.now(), warnings: [...warnings, ...staleWarning(vehicles)] };
  }
}
