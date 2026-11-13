import type { Coordinate, Departure, Network, RoutePattern, Stop } from './types';

export interface PlannerOptions {
  /** Epoch milliseconds; defaults to the time at which planning starts. */
  now?: number;
  /** Maximum straight-line access and egress walk, independently. */
  maxWalkMeters?: number;
  maxTransferWalkMeters?: number;
  walkingSpeedMps?: number;
  busSpeedMps?: number;
  estimatedWaitSeconds?: number;
  transferBufferSeconds?: number;
  dwellSeconds?: number;
  horizonSeconds?: number;
  maxRealtimeAgeSeconds?: number;
}

export interface JourneyPlace extends Coordinate { name: string; stopId?: string }
interface BaseLeg { from: JourneyPlace; to: JourneyPlace; startTime: number; endTime: number }
export interface WalkLeg extends BaseLeg { kind: 'walk'; distanceMeters: number }
export interface WaitLeg extends BaseLeg { kind: 'wait'; source: 'live' | 'estimated' }
export interface RideLeg extends BaseLeg {
  kind: 'ride'; routeId: string; routeName: string; direction: string;
  stops: Stop[];
  /** Describes the boarding prediction; intermediate travel may be estimated. */
  source: 'live' | 'estimated';
}
export type JourneyLeg = WalkLeg | WaitLeg | RideLeg;
export interface Journey {
  departureTime: number; arrivalTime: number; durationSeconds: number;
  walkingMeters: number; transfers: number; legs: JourneyLeg[];
  confidence: 'estimated' | 'live-assisted'; assumptions: string[];
}
export type JourneyResult = { status: 'ok'; journey: Journey } | { status: 'unavailable'; reason: string };

const RADIUS = 6_371_000;
const radians = (degrees: number) => degrees * Math.PI / 180;
const validCoordinate = (point: Coordinate) => Number.isFinite(point?.lat) && Number.isFinite(point?.lon)
  && Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180;

/** Great-circle distance. Walking is an estimate, not a pedestrian street route. */
export function distanceMeters(a: Coordinate, b: Coordinate): number {
  const dLat = radians(b.lat - a.lat), dLon = radians(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return RADIUS * 2 * Math.atan2(Math.sqrt(Math.min(1, h)), Math.sqrt(Math.max(0, 1 - h)));
}

/** Accepts latitude, longitude, with optional surrounding parentheses. */
export function parseCoordinate(value: string): Coordinate | null {
  let input = value.trim();
  if (input.startsWith('(') && input.endsWith(')')) input = input.slice(1, -1);
  const match = input.match(/^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*$/);
  if (!match) return null;
  const point = { lat: Number(match[1]), lon: Number(match[2]) };
  return validCoordinate(point) ? point : null;
}

const place = (stop: Stop): JourneyPlace => ({ lat: stop.lat, lon: stop.lon, name: stop.name, stopId: stop.id });

interface PreparedPattern {
  pattern: RoutePattern; stops: Stop[]; segmentSeconds: number[]; loop: boolean;
}
interface Label {
  key: number; time: number; walking: number; boardings: number;
  previous?: Label; legs: JourneyLeg[];
}

// A later arrival can catch the same future bus with fewer transfers or less
// walking. Keep these tradeoffs until the destination rather than discarding
// them merely because another label reached the stop sooner.
const dominates = (a: Pick<Label, 'time' | 'walking' | 'boardings'>, b: Pick<Label, 'time' | 'walking' | 'boardings'>) =>
  a.time <= b.time && a.boardings <= b.boardings && a.walking <= b.walking;

/** A stable binary heap keeps the search practical for full agency networks. */
class Heap {
  private items: Label[] = [];
  static before(a: Label, b: Label): boolean {
    return a.time < b.time || (a.time === b.time && (a.boardings < b.boardings
      || (a.boardings === b.boardings && (a.walking < b.walking || (a.walking === b.walking && a.key < b.key)))));
  }
  get size() { return this.items.length; }
  push(label: Label) {
    this.items.push(label);
    let at = this.items.length - 1;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (!Heap.before(label, this.items[parent])) break;
      this.items[at] = this.items[parent]; at = parent;
    }
    this.items[at] = label;
  }
  pop(): Label {
    const first = this.items[0], last = this.items.pop()!;
    if (this.items.length) {
      let at = 0;
      while (at * 2 + 1 < this.items.length) {
        let child = at * 2 + 1;
        if (child + 1 < this.items.length && Heap.before(this.items[child + 1], this.items[child])) child++;
        if (!Heap.before(this.items[child], last)) break;
        this.items[at] = this.items[child]; at = child;
      }
      this.items[at] = last;
    }
    return first;
  }
}

/** Find a stop's distance along a trace; retain distance from trace to reject unrelated geometry. */
function projection(point: Coordinate, shape: Coordinate[]): { along: number; away: number; total: number } {
  let cumulative = 0, best = { along: 0, away: Infinity, total: 0 };
  const cos = Math.max(0.00001, Math.cos(radians(point.lat)));
  for (let i = 1; i < shape.length; i++) {
    const a = shape[i - 1], b = shape[i];
    const ax = radians(a.lon - point.lon) * RADIUS * cos, ay = radians(a.lat - point.lat) * RADIUS;
    const bx = radians(b.lon - point.lon) * RADIUS * cos, by = radians(b.lat - point.lat) * RADIUS;
    const dx = bx - ax, dy = by - ay;
    const ratio = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    const away = Math.hypot(ax + ratio * dx, ay + ratio * dy), length = distanceMeters(a, b);
    if (away < best.away) best = { along: cumulative + length * ratio, away, total: 0 };
    cumulative += length;
  }
  best.total = cumulative;
  return best;
}

function preparePattern(pattern: RoutePattern, busSpeed: number, dwell: number): PreparedPattern | null {
  let stops = pattern.stops.filter(stop => validCoordinate(stop));
  // An explicitly repeated terminal closes the loop without creating a phantom extra stop.
  const closed = stops.length > 2 && stops[0].id === stops.at(-1)!.id;
  if (closed) stops = stops.slice(0, -1);
  if (stops.length < 2) return null;
  const loop = pattern.loop === true || closed;
  const shape = pattern.shape.filter(validCoordinate);
  const projected = shape.length > 1 ? stops.map(stop => projection(stop, shape)) : [];
  const segmentSeconds = stops.map((stop, i) => {
    const next = stops[(i + 1) % stops.length], straight = distanceMeters(stop, next);
    let meters = straight * 1.25;
    if (projected.length && projected[i].away <= 300 && projected[(i + 1) % stops.length].away <= 300) {
      let along = projected[(i + 1) % stops.length].along - projected[i].along;
      if (along < 0 && loop) along += projected[i].total;
      if (along >= straight * 0.95) meters = Math.max(straight, along);
    }
    return meters / busSpeed + dwell;
  });
  return { pattern, stops, segmentSeconds, loop };
}

function sameRun(a: Departure, b: Departure): boolean {
  if (a.tripId && b.tripId) return a.tripId === b.tripId;
  return !!a.vehicleId && a.vehicleId === b.vehicleId;
}

function boardingTime(departure: Departure): number {
  return Number.isFinite(departure.departureTime) && departure.departureTime! >= departure.arrivalTime
    ? departure.departureTime! : departure.arrivalTime;
}

/**
 * Preserve known run arrival anchors. Interpolate unknown intermediate times
 * between anchors instead of discarding a valid downstream ETA just because an
 * earlier, unobserved stop had an overly pessimistic travel estimate.
 */
function rideTimes(
  stops: Stop[], seconds: number[], start: number, prediction: Departure | undefined,
  predictions: (stop: Stop) => Departure[],
): number[] {
  const times = [start], cumulative = [0], minimum = [0];
  for (let i = 1; i < stops.length; i++) {
    cumulative[i] = cumulative[i - 1] + seconds[i - 1];
    minimum[i] = minimum[i - 1] + Math.max(.001, distanceMeters(stops[i - 1], stops[i]) / 30);
  }
  let anchor = 0, anchorDeparture = start;
  for (let i = 1; i < stops.length; i++) {
    const observed = prediction ? predictions(stops[i]).find(departure => sameRun(prediction, departure)
      && departure.arrivalTime >= anchorDeparture + (minimum[i] - minimum[anchor]) * 1000) : undefined;
    if (!observed) continue;
    const surplus = (observed.arrivalTime - anchorDeparture) / 1000 - (minimum[i] - minimum[anchor]);
    const weight = cumulative[i] - cumulative[anchor];
    for (let j = anchor + 1; j <= i; j++) {
      const secondsHere = minimum[j] - minimum[j - 1] + surplus * (seconds[j - 1] / (weight || 1));
      times[j] = (j === anchor + 1 ? anchorDeparture : times[j - 1]) + secondsHere * 1000;
    }
    times[i] = observed.arrivalTime;
    anchor = i;
    anchorDeparture = boardingTime(observed);
  }
  for (let i = anchor + 1; i < stops.length; i++) times[i] = anchorDeparture + (cumulative[i] - cumulative[anchor]) * 1000;
  return times;
}

/**
 * Earliest arrival in a declared model, not a timetable guarantee. Searches every
 * feasible access/egress stop and directed pattern, including walking transfers.
 * Each ride is a boarding-to-any-downstream-stop edge; remaining on a bus never
 * pays an extra wait. Live predictions are used only in their valid future window.
 */
export function planJourney(network: Network, origin: Coordinate, destination: Coordinate, options: PlannerOptions = {}): JourneyResult {
  const config = {
    now: options.now ?? Date.now(), maxWalkMeters: options.maxWalkMeters ?? 1200,
    maxTransferWalkMeters: options.maxTransferWalkMeters ?? 300,
    walkingSpeedMps: options.walkingSpeedMps ?? 1.3, busSpeedMps: options.busSpeedMps ?? 5.6,
    estimatedWaitSeconds: options.estimatedWaitSeconds ?? 450,
    transferBufferSeconds: options.transferBufferSeconds ?? 45, dwellSeconds: options.dwellSeconds ?? 20,
    horizonSeconds: options.horizonSeconds ?? 10_800, maxRealtimeAgeSeconds: options.maxRealtimeAgeSeconds ?? 180,
  };
  if (!validCoordinate(origin) || !validCoordinate(destination)) return { status: 'unavailable', reason: 'Choose valid origin and destination coordinates.' };
  if (Object.values(config).some(value => !Number.isFinite(value) || value < 0)
    || !config.walkingSpeedMps || !config.busSpeedMps || !config.horizonSeconds) {
    return { status: 'unavailable', reason: 'Journey settings must contain valid positive speeds and a planning horizon.' };
  }
  const active = new Map(network.routes.filter(route => route.active).map(route => [route.id, route]));
  const patterns = network.patterns.filter(pattern => active.has(pattern.routeId))
    .map(pattern => preparePattern(pattern, config.busSpeedMps, config.dwellSeconds))
    .filter((pattern): pattern is PreparedPattern => !!pattern);
  if (!patterns.length) return { status: 'unavailable', reason: 'No available bus routes have a usable stop sequence.' };
  const stopMap = new Map<string, Stop>();
  for (const pattern of patterns) for (const stop of pattern.stops) if (!stopMap.has(stop.id)) stopMap.set(stop.id, stop);
  const stops = [...stopMap.values()], index = new Map(stops.map((stop, i) => [stop.id, i]));
  const access = stops.map(stop => distanceMeters(origin, stop)), egress = stops.map(stop => distanceMeters(stop, destination));
  if (!access.some(distance => distance <= config.maxWalkMeters)) return { status: 'unavailable', reason: 'The origin is outside walking range of the available bus routes.' };
  if (!egress.some(distance => distance <= config.maxWalkMeters)) return { status: 'unavailable', reason: 'The destination is outside walking range of the available bus routes.' };

  const servedBy = new Map<string, { prepared: PreparedPattern; at: number }[]>();
  const directions = new Map<string, Set<string>>();
  for (const prepared of patterns) {
    const routeId = prepared.pattern.routeId;
    const values = directions.get(routeId) ?? new Set<string>(); values.add(prepared.pattern.direction); directions.set(routeId, values);
    prepared.stops.forEach((stop, at) => {
      const serving = servedBy.get(stop.id) ?? []; serving.push({ prepared, at }); servedBy.set(stop.id, serving);
    });
  }
  const deadline = config.now + config.horizonSeconds * 1000;
  const fresh = Number.isFinite(network.updatedAt) && config.now - network.updatedAt <= config.maxRealtimeAgeSeconds * 1000
    && network.updatedAt <= config.now + 60_000;
  const departures = new Map<string, Departure[]>();
  if (fresh) for (const departure of network.departures) {
    if (departure.updatedAt !== undefined && (!Number.isFinite(departure.updatedAt) || config.now - departure.updatedAt > config.maxRealtimeAgeSeconds * 1000 || departure.updatedAt > config.now + 60000)) continue;
    if (!Number.isFinite(departure.arrivalTime) || boardingTime(departure) < config.now || departure.arrivalTime > deadline) continue;
    const key = JSON.stringify([departure.stopId, departure.routeId]);
    const list = departures.get(key) ?? []; list.push(departure); departures.set(key, list);
  }
  for (const list of departures.values()) list.sort((a, b) => a.arrivalTime - b.arrivalTime);
  const predictions = (stopId: string, pattern: RoutePattern) => (departures.get(JSON.stringify([stopId, pattern.routeId])) ?? [])
    .filter(departure => departure.direction === pattern.direction
      || (departure.direction === undefined && directions.get(pattern.routeId)!.size === 1));

  const heap = new Heap(), labels = new Map<number, Label[]>();
  const offer = (label: Label) => {
    if (label.time > deadline) return;
    const previous = labels.get(label.key) ?? [];
    if (previous.some(existing => dominates(existing, label))) return;
    labels.set(label.key, [...previous.filter(existing => !dominates(label, existing)), label]);
    heap.push(label);
  };
  for (let i = 0; i < stops.length; i++) if (access[i] <= config.maxWalkMeters) {
    const time = config.now + access[i] / config.walkingSpeedMps * 1000;
    offer({ key: i * 3, time, walking: access[i], boardings: 0, legs: access[i] > 0.01 ? [{
      kind: 'walk', from: { ...origin, name: 'Origin' }, to: place(stops[i]), startTime: config.now, endTime: time, distanceMeters: access[i],
    }] : [] });
  }
  let best: { label: Label; time: number; walking: number; finalLeg?: WalkLeg } | undefined;
  // Latitude pruning makes transfer walking practical without restricting candidates.
  const latitudeOrder = stops.map((stop, i) => ({ lat: stop.lat, i })).sort((a, b) => a.lat - b.lat);
  while (heap.size) {
    const current = heap.pop();
    if (!labels.get(current.key)?.includes(current)) continue;
    if (best && current.time > best.time) break;
    const stopIndex = Math.floor(current.key / 3), mode = current.key % 3, stop = stops[stopIndex];
    if (mode > 0 && egress[stopIndex] <= config.maxWalkMeters) {
      const arrival = current.time + egress[stopIndex] / config.walkingSpeedMps * 1000;
      const walking = current.walking + egress[stopIndex];
      if (arrival <= deadline && (!best || arrival < best.time
        || (arrival === best.time && (current.boardings < best.label.boardings
          || (current.boardings === best.label.boardings && walking < best.walking))))) {
        best = { label: current, time: arrival, walking, finalLeg: egress[stopIndex] > 0.01 ? {
          kind: 'walk', from: place(stop), to: { ...destination, name: 'Destination' }, startTime: current.time, endTime: arrival, distanceMeters: egress[stopIndex],
        } : undefined };
      }
    }
    // A transfer walk can follow a ride, but walks cannot chain to bypass the access limit.
    if (mode === 2 && config.maxTransferWalkMeters > 0) {
      const latitudeWindow = config.maxTransferWalkMeters / 110_000;
      for (const candidate of latitudeOrder) {
        if (candidate.lat < stop.lat - latitudeWindow) continue;
        if (candidate.lat > stop.lat + latitudeWindow) break;
        if (candidate.i === stopIndex) continue;
        const meters = distanceMeters(stop, stops[candidate.i]);
        if (meters > config.maxTransferWalkMeters) continue;
        const time = current.time + meters / config.walkingSpeedMps * 1000;
        offer({ key: candidate.i * 3 + 1, time, walking: current.walking + meters, boardings: current.boardings, previous: current, legs: [{
          kind: 'walk', from: place(stop), to: place(stops[candidate.i]), startTime: current.time, endTime: time, distanceMeters: meters,
        }] });
      }
    }
    const ready = current.time + (mode > 0 ? config.transferBufferSeconds * 1000 : 0);
    for (const { prepared, at } of servedBy.get(stop.id) ?? []) {
      const { pattern } = prepared;
      const known = predictions(stop.id, pattern).sort((a, b) => boardingTime(a) - boardingTime(b));
      const live = known.filter(departure => boardingTime(departure) >= ready);
      // Estimated service follows the latest known departure, never jumps ahead
      // of it. Include it alongside known runs: this makes every edge FIFO even
      // if a predicted bus is slower than a following estimated run.
      const candidates: { start: number; prediction?: Departure }[] = live.map(prediction => ({ start: boardingTime(prediction), prediction }));
      candidates.push({ start: Math.max(ready, known.length ? boardingTime(known.at(-1)!) : ready) + config.estimatedWaitSeconds * 1000 });
      const count = prepared.loop ? prepared.stops.length - 1 : prepared.stops.length - at - 1;
      const ridden = Array.from({ length: count + 1 }, (_, step) => prepared.stops[(at + step) % prepared.stops.length]);
      const seconds = Array.from({ length: count }, (_, step) => prepared.segmentSeconds[(at + step) % prepared.stops.length]);
      for (const candidate of candidates) {
        const times = rideTimes(ridden, seconds, candidate.start, candidate.prediction, next => predictions(next.id, pattern));
        for (let step = 1; step <= count; step++) {
          const next = ridden[step], arrival = times[step], key = index.get(next.id)! * 3 + 2;
          if (arrival > deadline || labels.get(key)?.some(existing => dominates(existing, {
            time: arrival, boardings: current.boardings + 1, walking: current.walking,
          }))) continue;
          const source = candidate.prediction && !candidate.prediction.scheduled ? 'live' : 'estimated';
          const legs: JourneyLeg[] = [];
          if (candidate.start > current.time) legs.push({ kind: 'wait', from: place(stop), to: place(stop), startTime: current.time, endTime: candidate.start, source });
          legs.push({ kind: 'ride', routeId: pattern.routeId, routeName: active.get(pattern.routeId)!.name, direction: pattern.direction,
            from: place(stop), to: place(next), startTime: candidate.start, endTime: arrival, stops: ridden.slice(0, step + 1), source });
          offer({ key, time: arrival, walking: current.walking, boardings: current.boardings + 1, previous: current, legs });
        }
      }
    }
  }
  if (!best) return { status: 'unavailable', reason: 'No bus journey connects these points within the walking limits and planning horizon.' };
  const sections: JourneyLeg[][] = [];
  for (let label: Label | undefined = best.label; label; label = label.previous) sections.push(label.legs);
  const legs = sections.reverse().flat();
  if (best.finalLeg) legs.push(best.finalLeg);
  const liveAssisted = legs.some(leg => leg.kind === 'ride' && leg.source === 'live');
  return { status: 'ok', journey: {
    departureTime: config.now, arrivalTime: best.time, durationSeconds: (best.time - config.now) / 1000,
    walkingMeters: best.walking, transfers: Math.max(0, best.label.boardings - 1), legs,
    confidence: liveAssisted ? 'live-assisted' : 'estimated',
    assumptions: [
      'Fastest in this model across available directed bus routes; these APIs do not provide a complete timetable or guarantee a departure.',
      `Walks use straight-line distances at ${config.walkingSpeedMps} m/s; verify safe, accessible paths on the ground.`,
      `Unpublished repeating service is estimated ${Math.round(config.estimatedWaitSeconds / 60 * 10) / 10} minutes after you are ready or after the last known departure, whichever is later.`,
      `Unpredicted bus travel uses route geometry where consistent, otherwise stop distances × 1.25, at ${config.busSpeedMps} m/s plus ${config.dwellSeconds} seconds per stop.`,
      `Transfers include ${config.transferBufferSeconds} seconds to change buses. Predictions older than ${config.maxRealtimeAgeSeconds} seconds are ignored.`,
    ],
  } };
}
