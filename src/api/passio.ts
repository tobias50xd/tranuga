import type { Agency, Coordinate, Departure, Network, Route, RouteDetail, RoutePattern, Stop, StopDetail, Vehicle } from '../types';
import { ApiClient } from './client';
import { color, coordinate, decodePolyline, list, num, record, rows, text, timestamp, uniqueStops } from './normalize';
import { passioEndpoints, PASSIO_ORIGINS } from './passio-endpoints';
import { uniqueVehicles } from '../vehicle-selection';

export { PASSIO_ORIGINS, passioEndpoints } from './passio-endpoints';
export const PASSIO_ATHENS_AGENCY: Agency = { id: '5842', name: 'Athens Public Transit · Ohio', kind: 'passio', center: { lat: 39.33638, lon: -82.12585 } };
export const PASSIO_UGA_AGENCY: Agency = { id: '3994', name: 'University of Georgia · Passio', kind: 'passio', center: { lat: 33.948, lon: -83.377 } };
type PassioPattern = RoutePattern & { shapeSegments?: Coordinate[][] };
export interface PassioTopology { stops: Stop[]; patterns: PassioPattern[] }
export interface PassioRouteGroup { id: string; variantId: string; name: string; shortName: string; color: string; stopCount?: number }
export interface PassioSystemInfo { id: string; name: string; center?: Coordinate; version?: string; routeGroups: PassioRouteGroup[] }
export interface PassioTimetable { routeId: string; variantId: string; stopId: string; times: string[]; timezone?: string }
export interface PassioComparedLeg { mode: 'walk' | 'ride'; routeId?: string; routeName?: string; fromStopId?: string; fromStopName?: string; toStopId?: string; toStopName?: string; durationSeconds?: number }
export interface PassioComparedRoute { label: string; durationSeconds?: number; transfers?: number; legs: PassioComparedLeg[] }
export interface PassioJourneyComparison { routes: PassioComparedRoute[]; warnings: string[] }
function routeIdentity(agencyId: string, variantId: string, groupId: unknown): string {
  const group = text(groupId);
  return agencyId === '3994' && /^\d+$/.test(group) && Number(group) > 0 ? group : variantId;
}
function responseObject(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${context} has an unsupported format.`);
  const object = record(value);
  if (text(object.error)) throw new Error(`${context}: ${text(object.error)}`);
  return object;
}
/** Catalog `id` is a representative stop ID. `myid` is the actual route ID. */
export function normalizePassioRoutes(value: unknown, agencyId: string): Route[] {
  const variants = rows(value, 'Passio route catalog').flatMap(row => {
    const id = routeIdentity(agencyId, text(row.myid), row.groupId); if (!id || (row.userId !== undefined && text(row.userId) !== agencyId)) return [];
    return [{ id, agencyId, operator: agencyId === '3994' ? 'uga' as const : 'city' as const, name: text(row.name, `Route ${id}`), shortName: text(row.shortName, id), color: color(row.color), active: text(row.archive, '0') !== '1' && text(row.outdated, '0') !== '1' && text(row.mapApp, '1') !== '0', availability: 'published' as const }];
  });
  const routes = new Map<string, Route>();
  for (const route of variants) { const existing = routes.get(route.id); routes.set(route.id, existing ? { ...existing, active: existing.active || route.active } : route); }
  return [...routes.values()];
}
function passioCoordinate(value: unknown): Coordinate | undefined {
  const row = record(value); return coordinate({ latitude: row.latitude ?? row.lat, longitude: row.longitude ?? row.lng ?? row.lon });
}
function segments(value: unknown): Coordinate[][] {
  if (!Array.isArray(value)) return [];
  const result: Coordinate[][] = [];
  for (const part of value) {
    const values = Array.isArray(part) ? part : [part]; let current: Coordinate[] = [];
    const flush = () => { if (current.length > 1) result.push(current); current = []; };
    for (const item of values) {
      if (typeof item === 'string') { flush(); try { const decoded = decodePolyline(item); if (decoded.length > 1) result.push(decoded); } catch { /* Invalid segments do not become invented connecting paths. */ } }
      else { const point = passioCoordinate(item); if (point) current.push(point); else flush(); }
    }
    flush();
  }
  return result;
}
/** Preserve compact [sequence, stopId, returnVisit] rows and repeated visits in sequence order. */
export function normalizePassioTopology(value: unknown, agencyId: string): PassioTopology {
  const data = responseObject(value, 'Passio topology');
  if (!data.routes || !data.stops || typeof data.routes !== 'object' || typeof data.stops !== 'object' || Array.isArray(data.routes) || Array.isArray(data.stops)) throw new Error('Passio topology has an unsupported format.');
  const stops = Object.values(record(data.stops)).flatMap(value => {
    const row = record(value), point = passioCoordinate(row), id = text(row.stopId ?? row.id);
    return point && id && (row.userId === undefined || text(row.userId) === agencyId) ? [{ id, name: text(row.name, `Stop ${id}`), ...point }] : [];
  });
  const byId = new Map(stops.map(stop => [stop.id, stop])), geometry = record(data.routePoints);
  const groups = record(record(data.groupRoutes)[agencyId]);
  const patterns = Object.entries(record(data.routes)).flatMap(([variantId, value]) => {
    if (!Array.isArray(value)) return [];
    const visits = value.slice(3).filter(Array.isArray).map(row => row as unknown[]).sort((a, b) => (num(a[0]) ?? 0) - (num(b[0]) ?? 0));
    // If a stop has no valid coordinates, do not jump across it to manufacture an edge.
    if (visits.some(visit => !byId.has(text(visit[1])))) return [];
    const ordered = visits.map(visit => byId.get(text(visit[1]))!);
    if (ordered.length < 2) return [];
    const loop = ordered.length > 2 && ordered[0].id === ordered.at(-1)!.id ? true : undefined;
    const shapeSegments = segments(geometry[variantId]), group = record(groups[variantId]);
    const routeId = routeIdentity(agencyId, variantId, group.routeGroupId ?? group.id);
    return [{ id: `passio:${agencyId}:${variantId}`, routeId, direction: variantId, stops: loop ? ordered.slice(0, -1) : ordered, loop, shape: shapeSegments.length === 1 ? shapeSegments[0] : [], shapeSegments }];
  });
  return { stops, patterns };
}
export function normalizePassioVehicles(value: unknown, agencyId: string): Vehicle[] {
  const data = responseObject(value, 'Passio vehicles');
  if (!data.buses || typeof data.buses !== 'object') throw new Error('Passio vehicles has an unsupported format.');
  const vehicles = Object.values(record(data.buses)).flatMap(value => {
    const candidates = Array.isArray(value) ? list(value) : Object.keys(record(value)).length ? [record(value)] : [];
    return candidates.flatMap(row => {
      const point = passioCoordinate(row), id = text(row.busId), routeId = text(row.routeId);
      if (!point || !id || !routeId || text(row.userId) !== agencyId || text(row.outOfService) === '1') return [];
      const heading = num(row.calculatedCourse) ?? num(row.course);
      // The observed response has only a local 12h time without date/offset. Request time is not GPS time.
      const updatedAt = utcTimestamp(row.updatedUtc) ?? timestamp(row.updatedAt) ?? timestamp(row.timestamp);
      return [{ id, routeId, ...point, heading: heading === undefined ? 0 : ((heading % 360) + 360) % 360, updatedAt, active: text(row.outdated, '0') !== '1', destination: text(row.route, `Route ${routeId}`), tripId: text(row.tripId) || undefined }];
    });
  });
  // A feed can retain an outdated point beside the current point for one bus.
  // Keep the current point, or one outdated fallback when no current point exists.
  return uniqueVehicles(vehicles);
}
function utcTimestamp(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  // These fields explicitly have a Utc suffix in Passio, although their values omit the Z.
  const date = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  return timestamp(date);
}
const zoneFormatters = new Map<string, Intl.DateTimeFormat>();
/** Resolve a complete local date only with an explicit catalog IANA zone; DST gaps/folds are unknown. */
export function passioLocalTimestamp(value: unknown, timezone: string | undefined): number | undefined {
  if (typeof value !== 'string' || !timezone) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  if (year < 1970 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return undefined;
  const nominal = Date.UTC(year, month - 1, day, hour, minute, second), date = new Date(nominal);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  try {
    let formatter = zoneFormatters.get(timezone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
      zoneFormatters.set(timezone, formatter);
    }
    const wallTime = (instant: number) => {
      const parts = Object.fromEntries(formatter!.formatToParts(instant).map(part => [part.type, part.value]));
      return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    };
    // Sample both sides of transitions, then prove each candidate by an exact local round trip.
    const offsets = new Set<number>();
    for (let hours = -36; hours <= 36; hours += 6) { const instant = nominal + hours * 3600000; offsets.add(wallTime(instant) - instant); }
    const candidates = [...offsets].map(offset => nominal - offset).filter(instant => wallTime(instant) === nominal);
    return candidates.length === 1 ? candidates[0] : undefined;
  } catch { return undefined; }
}
export function normalizePassioDepartures(value: unknown, agencyId = '5842', variantRoutes = new Map<string, string>(), timezones: ReadonlyMap<string, string> = new Map()): Departure[] {
  const data = responseObject(value, 'Passio predictions');
  if (!data.ETAs || typeof data.ETAs !== 'object' || Array.isArray(data.ETAs)) throw new Error('Passio predictions has an unsupported format.');
  return Object.entries(record(data.ETAs)).flatMap(([stopId, value]) => list(value).flatMap(row => {
    const solid = record(row.solidEta), arrivalTime = utcTimestamp(solid.arrivalUtc) ?? timestamp(row.arrivalTimestamp) ?? timestamp(row.etaUtc);
    const variantId = text(solid.routeId ?? row.routeId ?? record(row.theStop).routeId);
    const routeId = routeIdentity(agencyId, variantRoutes.get(variantId) ?? variantId, solid.routeGroupId ?? row.routeGroupId);
    if (!arrivalTime || !routeId || text(row.outOfService ?? row.OOS) === '1' || text(row.outdated) === '1' || (Array.isArray(row.error) && row.error.length)) return [];
    const updatedAt = utcTimestamp(solid.updatedUtc) ?? utcTimestamp(row.updatedUtc) ?? passioLocalTimestamp(row.created, timezones.get(variantId));
    // No actual departure timestamp was established in the recovered contract.
    // scheduledDepartureUtc is timetable metadata, not evidence of live departure or dwell.
    return [{ stopId: text(solid.stopId, stopId), routeId, direction: variantId, arrivalTime, updatedAt, vehicleId: text(solid.busId ?? row.busId) || undefined, tripId: text(solid.tripId ?? row.tripId) || undefined, scheduled: false }];
  }));
}
export function normalizePassioMessages(value: unknown, agencyId: string): string[] {
  const data = responseObject(value, 'Passio messages');
  if (!Array.isArray(data.msgs)) throw new Error('Passio messages has an unsupported format.');
  return [...new Set(list(data.msgs).filter(row => (row.userId === undefined || text(row.userId) === agencyId) && text(row.archive, '0') !== '1' && text(row.fromOk, '1') !== '0' && text(row.toOk, '1') !== '0').map(row => text(row.name ?? row.gtfsAlertHeaderText)).filter(Boolean))];
}
/** Only the explicitly selected Passio result is compared; third-party driving alternatives are excluded. */
export function normalizePassioComparison(value: unknown, agencyId: string): PassioJourneyComparison {
  const data = responseObject(value, 'Passio journey comparison'), routes: PassioComparedRoute[] = [];
  for (const route of list(record(data.bestPath).routes)) {
    const rawLegs = list(route.legs), rawSteps = rawLegs.flatMap(leg => list(leg.steps));
    if (!rawSteps.length || rawSteps.some(step => !['TRANSIT', 'WALKING'].includes(text(step.travel_mode)))) continue;
    const legs: PassioComparedLeg[] = rawSteps.map(step => {
      const boarding = record(step.boardingStop), alighting = record(step.alightingStop), duration = num(record(step.duration).value);
      return { mode: step.travel_mode === 'TRANSIT' ? 'ride' : 'walk', routeId: text(step.routeId) ? routeIdentity(agencyId, text(step.routeId), step.routeGroupId) : undefined, routeName: text(step.name ?? step.shortName) || undefined, fromStopId: text(boarding.stopId) || undefined, fromStopName: text(boarding.stopName) || undefined, toStopId: text(alighting.stopId) || undefined, toStopName: text(alighting.stopName) || undefined, durationSeconds: duration !== undefined && duration >= 0 ? duration : undefined };
    });
    if (!legs.some(leg => leg.mode === 'ride')) continue;
    const reportedLegDurations = rawLegs.map(leg => num(record(leg.duration).value));
    const durationSeconds = reportedLegDurations.length && reportedLegDurations.every(duration => duration !== undefined && duration >= 0)
      ? reportedLegDurations.reduce<number>((total, duration) => total + duration!, 0)
      : legs.every(leg => leg.durationSeconds !== undefined) ? legs.reduce((total, leg) => total + leg.durationSeconds!, 0) : undefined;
    const transfers = num(route.transfers);
    routes.push({ label: `Operator alternative ${routes.length + 1}`, legs, durationSeconds, transfers: transfers !== undefined && Number.isInteger(transfers) && transfers >= 0 ? transfers : undefined });
  }
  return { routes, warnings: ['Operator alternatives are a separate comparison. Their reported durations may omit current waiting and do not replace the local planner result.', ...(routes.length ? [] : ['No bus-and-walk alternative was returned by the operator.'])] };
}
const failure = (value: unknown) => value instanceof Error ? value.message : 'Transit source unavailable.';
async function limited<T, U>(values: T[], fn: (value: T) => Promise<U>): Promise<PromiseSettledResult<U>[]> {
  const result: PromiseSettledResult<U>[] = new Array(values.length); let index = 0;
  await Promise.all(Array.from({ length: Math.min(4, values.length) }, async () => { while (index < values.length) { const at = index++; try { result[at] = { status: 'fulfilled', value: await fn(values[at]) }; } catch (reason) { result[at] = { status: 'rejected', reason }; } } }));
  return result;
}
/** One domain adapter for one validated backend mirror. Replication policy is composed above this layer. */
export class PassioService {
  readonly client: ApiClient;
  private catalog: Route[] = [];
  private topology?: PassioTopology;
  private variantRoutes = new Map<string, string>();
  private variantTimezones = new Map<string, string>();
  readonly origin: string;
  private readonly endpoints: ReturnType<typeof passioEndpoints>;
  constructor(readonly agency: Agency = PASSIO_ATHENS_AGENCY, client = new ApiClient(), origin = PASSIO_ORIGINS[0] as string) {
    this.endpoints = passioEndpoints(origin, agency.id); this.origin = origin; this.client = client;
  }
  async listRoutes(): Promise<Route[]> {
    const raw = await this.client.post(this.endpoints.routes, this.endpoints.routePayload);
    this.catalog = normalizePassioRoutes(raw, this.agency.id);
    this.variantRoutes = new Map(rows(raw).map(row => [text(row.myid), routeIdentity(this.agency.id, text(row.myid), row.groupId)]));
    this.variantTimezones = new Map(rows(raw).flatMap(row => {
      const timezone = text(row.timezone); if (!timezone) return [];
      try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(0); return [[text(row.myid), timezone]]; } catch { return []; }
    }));
    return this.catalog;
  }
  async getSystemInfo(): Promise<PassioSystemInfo> {
    const [systemsRaw, versionRaw, groupsRaw] = await Promise.all([
      this.client.get(this.endpoints.systems, 3600000), this.client.get(this.endpoints.version, 3600000),
      this.client.post(this.endpoints.routeGroups, this.endpoints.routePayload, 300000),
    ]);
    const system = list(responseObject(systemsRaw, 'Passio system directory').all).find(row => text(row.id) === this.agency.id);
    if (!system) throw new Error('Selected Passio agency is absent from the provider directory.');
    const groupRows = rows(responseObject(groupsRaw, 'Passio route groups').all, 'Passio route groups');
    const routeGroups = groupRows.filter(row => text(row.userId) === this.agency.id).map(row => ({ id: text(row.groupId, text(row.myid)), variantId: text(row.myid), name: text(row.name), shortName: text(row.shortName, text(row.myid)), color: color(row.color), stopCount: num(row.stopsAmount) }));
    return { id: this.agency.id, name: text(system.fullname ?? system.goAgencyName, this.agency.name), center: this.agency.center, version: text(responseObject(versionRaw, 'Passio web version').ver) || undefined, routeGroups };
  }
  async searchBuses(query: string): Promise<Vehicle[]> {
    const url = this.endpoints.search(query);
    if (this.agency.id === '3994' && !this.variantRoutes.size) await this.listRoutes();
    const raw = await this.client.post(url, this.endpoints.systemPayload, 10000), data = responseObject(raw, 'Passio bus search');
    const search = record(data.search), foundId = text(search.busId);
    if (!foundId || search.foundLocation === false) return [];
    return normalizePassioVehicles(raw, this.agency.id).filter(vehicle => vehicle.id === foundId).map(vehicle => ({ ...vehicle, routeId: this.variantRoutes.get(vehicle.routeId) ?? vehicle.routeId }));
  }
  async getTimetable(stopId: string, routeId?: string): Promise<PassioTimetable> {
    if (!this.catalog.length) await this.listRoutes();
    const topology = this.topology ?? await this.loadTopology();
    const pattern = topology.patterns.find(candidate => (!routeId || candidate.routeId === routeId || candidate.direction === routeId) && candidate.stops.some(stop => stop.id === stopId));
    if (!pattern) throw new Error('No ordered Passio route serves this stop.');
    const data = responseObject(await this.client.get(this.endpoints.timetable(stopId, pattern.direction), 60000), 'Passio timetable');
    const routeRows = Object.values(record(data.routes)).map(record).filter(row => text(row.routeId) === pattern.direction);
    const times = [...new Set(routeRows.flatMap(row => list(row.routeStops).filter(stop => text(stop.stopId) === stopId).flatMap(stop => {
      const next = record(stop.timepoints).next;
      return Array.isArray(next) ? next.filter((time): time is string => typeof time === 'string' && time.trim().length > 0) : [];
    })))];
    return { routeId: pattern.routeId, variantId: pattern.direction, stopId, times, timezone: this.variantTimezones.get(pattern.direction) };
  }
  async compareJourney(from: Coordinate, to: Coordinate): Promise<PassioJourneyComparison> {
    // Comparison coordinates are sent only for this explicit action and are not cached in the browser.
    const payload = this.endpoints.comparisonPayload(from, to);
    return normalizePassioComparison(await this.client.post(this.endpoints.compare, payload, 0), this.agency.id);
  }
  private async loadTopology(): Promise<PassioTopology> {
    this.topology = normalizePassioTopology(await this.client.post(this.endpoints.topology, this.endpoints.systemPayload, 300000), this.agency.id);
    return this.topology;
  }
  async getStops(): Promise<Stop[]> { return (await this.loadTopology()).stops; }
  async refreshVehicles(): Promise<Vehicle[]> {
    if (this.agency.id === '3994' && !this.variantRoutes.size) await this.listRoutes();
    return normalizePassioVehicles(await this.client.post(this.endpoints.buses, this.endpoints.systemPayload, 10000), this.agency.id).map(vehicle => ({ ...vehicle, routeId: this.variantRoutes.get(vehicle.routeId) ?? vehicle.routeId }));
  }
  async getMessages(): Promise<string[]> {
    return normalizePassioMessages(await this.client.post(this.endpoints.messages, this.endpoints.messagePayload, 60000), this.agency.id);
  }
  private async predictions(stopIds: string[]): Promise<{ departures: Departure[]; warnings: string[] }> {
    const batches: string[][] = []; for (let i = 0; i < stopIds.length; i += 40) batches.push(stopIds.slice(i, i + 40));
    const results = await limited(batches, async ids => normalizePassioDepartures(await this.client.get(this.endpoints.eta(ids), 10000), this.agency.id, this.variantRoutes, this.variantTimezones));
    const departures: Departure[] = [], warnings: string[] = [];
    results.forEach(result => { if (result.status === 'fulfilled') departures.push(...result.value); else warnings.push(`Passio arrival predictions unavailable: ${failure(result.reason)}`); });
    return { departures, warnings };
  }
  async getRoute(routeId: string): Promise<RouteDetail> {
    const [routes, topology] = await Promise.all([this.catalog.length ? Promise.resolve(this.catalog) : this.listRoutes(), this.loadTopology()]);
    const route = routes.find(row => row.id === routeId); if (!route) throw new Error('Route is absent from the Passio catalog.');
    const patterns = topology.patterns.filter(pattern => pattern.routeId === routeId), stops = uniqueStops(patterns), warnings: string[] = [];
    const [vehicles, messages, predictions] = await Promise.all([
      this.refreshVehicles().catch(error => { warnings.push(failure(error)); return []; }),
      this.getMessages().catch(error => { warnings.push(failure(error)); return []; }),
      this.predictions(stops.map(stop => stop.id)),
    ]);
    if (!patterns.length) warnings.push('Ordered stops unavailable for this Passio route.');
    if (patterns.some(pattern => !pattern.shape.length && !pattern.shapeSegments?.length)) warnings.push('Road trace unavailable; dashed stop connectors are approximate.');
    const routeVehicles = vehicles.filter(vehicle => vehicle.routeId === routeId);
    if (routeVehicles.some(vehicle => !vehicle.updatedAt)) warnings.push('Passio reports vehicle clock time without an absolute update date; position freshness is unknown.');
    return { route, patterns, stops, vehicles: routeVehicles, departures: predictions.departures.filter(departure => departure.routeId === routeId), messages, warnings: [...warnings, ...predictions.warnings] };
  }
  async getStop(stopId: string): Promise<StopDetail> {
    if (!this.catalog.length) await this.listRoutes();
    const topology = this.topology ?? await this.loadTopology(), stop = topology.stops.find(row => row.id === stopId);
    if (!stop) throw new Error('Stop is absent from the Passio stop directory.');
    const data = await this.client.get(this.endpoints.eta([stopId]), 10000);
    return { stop, departures: normalizePassioDepartures(data, this.agency.id, this.variantRoutes, this.variantTimezones) };
  }
  async getNetwork(): Promise<Network> {
    const warnings: string[] = [];
    const [routes, topology, vehicles, messages] = await Promise.all([
      this.listRoutes(), this.loadTopology(),
      this.refreshVehicles().catch(error => { warnings.push(`Passio vehicles unavailable: ${failure(error)}`); return []; }),
      this.getMessages().catch(error => { warnings.push(`Passio messages unavailable: ${failure(error)}`); return []; }),
    ]);
    // Topology is one agency-wide response, so retain every returned route and
    // let current vehicle/ETA evidence decide which lines are usable.
    const routeIds = new Set(routes.map(route => route.id));
    const patterns = topology.patterns.filter(pattern => routeIds.has(pattern.routeId)), stops = uniqueStops(patterns);
    const predicted = await this.predictions(stops.map(stop => stop.id));
    const missing = routes.filter(route => !patterns.some(pattern => pattern.routeId === route.id));
    if (missing.length) warnings.push(`Ordered stops unavailable for ${missing.map(route => route.shortName).join(', ')}; these routes are excluded from planning.`);
    if (vehicles.some(vehicle => !vehicle.updatedAt)) warnings.push('Passio vehicle update dates are unavailable; marker freshness is unknown.');
    return { agencyId: this.agency.id, routes, patterns, stops, vehicles, departures: predicted.departures.filter(departure => routeIds.has(departure.routeId)), messages, warnings: [...warnings, ...predicted.warnings], updatedAt: Date.now() };
  }
}
