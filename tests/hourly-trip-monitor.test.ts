import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ApiClient, UGA_AGENCY, ugaEndpoints } from '../src/api';
import { normalizeRoutes, normalizeVehicles, uniqueStops } from '../src/api/normalize';
import { ugaTopology } from '../src/api/topology';
import { ATHENS_BOUNDS } from '../src/athens';
import crosswalk from '../src/data/athens-crosswalk.json';
import { distanceMeters, planJourney } from '../src/planner';
import type { Coordinate, Journey, Network, RoutePattern, Stop } from '../src/types';

const enabled = process.env.HOURLY_TRIP_CHECK === '1';
const failuresFile = fileURLToPath(new URL('../trip_failure.md', import.meta.url));
const maxWalkMeters = 1_200, maxTransferWalkMeters = 300;

interface Failure { category: string; reason: string; context: Record<string, unknown> }

function monitoredPatterns(routeIds: Set<string>, staticPatterns: RoutePattern[]): RoutePattern[] {
  const stops = new Map(crosswalk.stops.map(stop => [stop.id, { id: stop.id, name: stop.name, lat: stop.lat, lon: stop.lon }]));
  const current = new Map(staticPatterns.map(pattern => [`${pattern.routeId}\0${pattern.direction}`, pattern]));
  const reviewed = crosswalk.routes.filter(route => routeIds.has(route.id)).flatMap(route => route.directions.flatMap(direction => {
    const live = current.get(`${route.id}\0${direction.id}`);
    if (live) return [live];
    const ordered = direction.ugaStopIds.flatMap(id => {
      const stop = stops.get(id); return stop ? [stop] : [];
    });
    return ordered.length > 1 ? [{ id: `reviewed:${route.id}:${direction.id}`, routeId: route.id, direction: direction.id, stops: ordered, shape: [] }] : [];
  }));
  const keys = new Set(reviewed.map(pattern => `${pattern.routeId}\0${pattern.direction}`));
  return [...reviewed, ...staticPatterns.filter(pattern => routeIds.has(pattern.routeId) && !keys.has(`${pattern.routeId}\0${pattern.direction}`))];
}

function hash(value: string): number {
  let result = 2166136261;
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return result >>> 0;
}

function randomGenerator(seed: number) {
  let state = seed || 1;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
}

function offset(point: Coordinate, meters: number, angle: number): Coordinate {
  const latitude = meters * Math.cos(angle) / 111_000;
  const longitude = meters * Math.sin(angle) / (111_000 * Math.max(.2, Math.cos(point.lat * Math.PI / 180)));
  return { lat: point.lat + latitude, lon: point.lon + longitude };
}

function appendFailure(slot: string, failure: Failure) {
  const body = JSON.stringify(failure.context, null, 2).replace(/```/g, '\u0060\u0060\u0060');
  appendFileSync(failuresFile, `\n## ${slot} — ${failure.category}\n\n${failure.reason}\n\n\`\`\`json\n${body}\n\`\`\`\n`);
}

function journeySummary(journey: Journey) {
  return {
    durationSeconds: journey.durationSeconds,
    walkingMeters: Math.round(journey.walkingMeters),
    transfers: journey.transfers,
    rides: journey.legs.filter(leg => leg.kind === 'ride').map(leg => ({ routeId: leg.routeId, direction: leg.direction, from: leg.from.stopId, to: leg.to.stopId })),
  };
}

async function crawl(): Promise<{ network: Network; calls: unknown[]; version: unknown }> {
  const client = new ApiClient(fetch, '', 20_000);
  const [rawRoutes, rawVehicles, version, rawTopology] = await Promise.all([
    client.get(ugaEndpoints.routes, 0),
    client.get(ugaEndpoints.buses, 0),
    client.get(ugaEndpoints.version, 0),
    client.get(ugaEndpoints.data, 0),
  ]);
  const routes = normalizeRoutes(rawRoutes, UGA_AGENCY.id, 'uga');
  const topology = ugaTopology(rawTopology), routeIds = new Set(routes.map(route => route.id));
  const patterns = monitoredPatterns(routeIds, topology.patterns);
  return {
    network: {
      agencyId: UGA_AGENCY.id,
      routes,
      patterns,
      stops: uniqueStops(patterns),
      vehicles: normalizeVehicles(rawVehicles, 'uga'),
      departures: [], messages: [], warnings: [], updatedAt: Date.now(),
    },
    calls: client.calls.map(call => ({ method: call.method, url: call.url, status: call.status, duration: call.duration })),
    version,
  };
}

function usablePatterns(network: Network): RoutePattern[] {
  const now = network.updatedAt, fresh = (updatedAt: number | undefined) => updatedAt !== undefined && Number.isFinite(updatedAt)
    && now - updatedAt <= 180_000 && updatedAt <= now + 60_000;
  const active = new Set([
    ...network.routes.filter(route => route.active).map(route => route.id),
    ...network.vehicles.filter(vehicle => fresh(vehicle.updatedAt)).map(vehicle => vehicle.routeId),
    ...network.departures.filter(departure => !departure.scheduled && fresh(departure.updatedAt)
      && departure.arrivalTime >= now && departure.arrivalTime <= now + 10_800_000).map(departure => departure.routeId),
  ]);
  return network.patterns.filter(pattern => active.has(pattern.routeId) && pattern.stops.length >= 2);
}

function directCases(network: Network) {
  return network.patterns.flatMap(pattern => {
    const cases: { pattern: RoutePattern; from: Stop; to: Stop; fromIndex: number; toIndex: number }[] = [];
    for (let fromIndex = 0; fromIndex < pattern.stops.length - 1; fromIndex++) {
      for (let toIndex = fromIndex + 1; toIndex < pattern.stops.length; toIndex++) {
        const from = pattern.stops[fromIndex], to = pattern.stops[toIndex];
        if (from.id !== to.id && distanceMeters(from, to) >= 500) cases.push({ pattern, from, to, fromIndex, toIndex });
      }
    }
    return cases;
  });
}

function oneRouteNetwork(network: Network, routeId: string): Network {
  const patterns = network.patterns.filter(pattern => pattern.routeId === routeId);
  return {
    ...network,
    routes: network.routes.filter(route => route.id === routeId).map(route => ({ ...route, active: true })),
    patterns,
    stops: uniqueStops(patterns),
    vehicles: network.vehicles.filter(vehicle => vehicle.routeId === routeId),
    departures: network.departures.filter(departure => departure.routeId === routeId),
  };
}

interface Reachability { possible: boolean; accessStops: number; egressStops: number; visitedStates: number }

/** Independent, timing-free proof that at least one directed bus path exists. */
function reachable(network: Network, origin: Coordinate, destination: Coordinate): Reachability {
  const patterns = usablePatterns(network), stops = uniqueStops(patterns), byId = new Map(stops.map(stop => [stop.id, stop]));
  const serving = new Map<string, { pattern: RoutePattern; at: number }[]>();
  for (const pattern of patterns) pattern.stops.forEach((stop, at) => serving.set(stop.id, [...(serving.get(stop.id) ?? []), { pattern, at }]));
  const access = stops.filter(stop => distanceMeters(origin, stop) <= maxWalkMeters);
  const egress = new Set(stops.filter(stop => distanceMeters(stop, destination) <= maxWalkMeters).map(stop => stop.id));
  const queue = access.map(stop => ({ stopId: stop.id, mode: 0 })), seen = new Set(queue.map(state => `${state.stopId}:0`));
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const state = queue[cursor];
    if (state.mode > 0 && egress.has(state.stopId)) return { possible: true, accessStops: access.length, egressStops: egress.size, visitedStates: seen.size };
    if (state.mode === 2) for (const stop of stops) {
      if (stop.id === state.stopId || distanceMeters(byId.get(state.stopId)!, stop) > maxTransferWalkMeters) continue;
      const key = `${stop.id}:1`; if (!seen.has(key)) { seen.add(key); queue.push({ stopId: stop.id, mode: 1 }); }
    }
    for (const { pattern, at } of serving.get(state.stopId) ?? []) {
      const count = pattern.loop ? pattern.stops.length - 1 : pattern.stops.length - at - 1;
      for (let step = 1; step <= count; step++) {
        const stop = pattern.stops[(at + step) % pattern.stops.length], key = `${stop.id}:2`;
        if (!seen.has(key)) { seen.add(key); queue.push({ stopId: stop.id, mode: 2 }); }
      }
    }
  }
  return { possible: false, accessStops: access.length, egressStops: egress.size, visitedStates: seen.size };
}

function randomPoint(random: () => number): Coordinate {
  return {
    lat: ATHENS_BOUNDS.south + random() * (ATHENS_BOUNDS.north - ATHENS_BOUNDS.south),
    lon: ATHENS_BOUNDS.west + random() * (ATHENS_BOUNDS.east - ATHENS_BOUNDS.west),
  };
}

function randomReachableCase(network: Network, random: () => number) {
  let firstUniform: ReturnType<typeof randomPoint> | undefined, firstDestination: ReturnType<typeof randomPoint> | undefined;
  for (let attempt = 1; attempt <= 120; attempt++) {
    const origin = randomPoint(random), destination = randomPoint(random), proof = reachable(network, origin, destination);
    if (attempt === 1) { firstUniform = origin; firstDestination = destination; }
    if (proof.possible) return { origin, destination, proof, attempt, selection: 'uniform Athens rectangle' };
  }
  const stops = uniqueStops(usablePatterns(network));
  for (let attempt = 1; attempt <= 120 && stops.length; attempt++) {
    const first = stops[Math.floor(random() * stops.length)], second = stops[Math.floor(random() * stops.length)];
    const origin = offset(first, random() * 400, random() * Math.PI * 2), destination = offset(second, random() * 400, random() * Math.PI * 2);
    const proof = reachable(network, origin, destination);
    if (proof.possible) return { origin, destination, proof, attempt, selection: 'random stop anchors with random offsets' };
  }
  const origin = firstUniform!, destination = firstDestination!;
  return { origin, destination, proof: reachable(network, origin, destination), attempt: 1, selection: 'uniform Athens rectangle; no independently reachable pair found in bounded search' };
}

describe.skipIf(!enabled)('bounded hourly live trip monitor', () => {
  it('crawls once and checks a one-route trip and a random trip against independent reachability', async () => {
    const slot = process.env.HOURLY_SLOT || new Date().toISOString().slice(0, 13) + ':00Z';
    const random = randomGenerator(hash(slot)), failures: Failure[] = [];
    let snapshot: Awaited<ReturnType<typeof crawl>>;
    try { snapshot = await crawl(); }
    catch (error) {
      const failure = { category: 'API crawl failure', reason: error instanceof Error ? error.message : String(error), context: { slot } };
      appendFailure(slot, failure); throw error;
    }
    const { network, calls, version } = snapshot, candidates = directCases(network);
    let singleRouteId: string | undefined;
    if (!candidates.length) failures.push({
      category: 'single-route case selection failure',
      reason: 'The live snapshot had no active directed pattern with two distinct stops at least 500 m apart.',
      context: { slot, routeCount: network.routes.length, activeRoutes: network.routes.filter(route => route.active).map(route => route.id), patternCount: network.patterns.length, calls, version },
    });
    else {
      const selected = candidates[Math.floor(random() * candidates.length)], angle = random() * Math.PI * 2;
      singleRouteId = selected.pattern.routeId;
      const origin = offset(selected.from, 15, angle), destination = offset(selected.to, 15, angle + Math.PI / 2);
      const isolated = oneRouteNetwork(network, selected.pattern.routeId);
      const result = planJourney(isolated, origin, destination, { now: isolated.updatedAt, maxWalkMeters: 80, maxTransferWalkMeters });
      const rides = result.status === 'ok' ? result.journey.legs.filter(leg => leg.kind === 'ride') : [];
      if (result.status !== 'ok' || !rides.length || rides.some(leg => leg.routeId !== selected.pattern.routeId) || result.journey.transfers !== 0) failures.push({
        category: 'single-route planning failure',
        reason: result.status === 'ok' ? 'The planner returned a journey that did not remain on the isolated route.' : result.reason,
        context: { slot, origin, destination, routeId: selected.pattern.routeId, patternId: selected.pattern.id, direction: selected.pattern.direction, fromStop: selected.from, toStop: selected.to, fromIndex: selected.fromIndex, toIndex: selected.toIndex, result: result.status === 'ok' ? journeySummary(result.journey) : result, isolated: { routes: isolated.routes, patterns: isolated.patterns.map(pattern => ({ id: pattern.id, direction: pattern.direction, stops: pattern.stops.map(stop => stop.id), loop: pattern.loop })) }, calls, version },
      });
    }

    const randomCase = randomReachableCase(network, random);
    const result = planJourney(network, randomCase.origin, randomCase.destination, { now: network.updatedAt, maxWalkMeters, maxTransferWalkMeters });
    if (randomCase.proof.possible && result.status !== 'ok') failures.push({
      category: 'random reachable-trip planning failure',
      reason: result.reason,
      context: { slot, ...randomCase, result, network: { routes: network.routes.length, activeRoutes: network.routes.filter(route => route.active).map(route => route.id), patterns: network.patterns.length, stops: network.stops.length, vehicles: network.vehicles.length }, calls, version },
    });

    for (const failure of failures) appendFailure(slot, failure);
    console.log('HOURLY_TRIP_RESULT', JSON.stringify({ slot, apiCalls: calls.length, routes: network.routes.length, activeRoutes: network.routes.filter(route => route.active).length, availablePatterns: usablePatterns(network).length, patterns: network.patterns.length, vehicles: network.vehicles.length, singleRouteId, randomProvenReachable: randomCase.proof.possible, failures: failures.length }));
    if (failures.length) throw new Error(failures.map(failure => `${failure.category}: ${failure.reason}`).join('\n'));
  }, 120_000);
});

describe('hourly monitor topology fallback', () => {
  it('supplies reviewed directed patterns when the current static feed covers a different operator', () => {
    const patterns = monitoredPatterns(new Set(['1001', '5750']), []);
    expect(patterns.filter(pattern => pattern.routeId === '1001')).toHaveLength(2);
    expect(patterns.find(pattern => pattern.routeId === '1001' && pattern.direction === '1')?.stops.length).toBeGreaterThan(1);
    expect(patterns.find(pattern => pattern.routeId === '5750')?.stops.length).toBeGreaterThan(1);
  });

  it('prefers a matching current static pattern over the reviewed fallback', () => {
    const staticPattern: RoutePattern = { id: 'live', routeId: '5750', direction: '0', stops: [{ id: 'a', name: 'A', lat: 1, lon: 1 }, { id: 'b', name: 'B', lat: 2, lon: 2 }], shape: [], loop: true };
    expect(monitoredPatterns(new Set(['5750']), [staticPattern])).toEqual([staticPattern]);
  });

  it('tests an isolated single route outside service hours without claiming random reachability', () => {
    const patterns = monitoredPatterns(new Set(['1001']), []), stops = uniqueStops(patterns);
    const network: Network = {
      agencyId: 'uga', routes: [{ id: '1001', agencyId: 'uga', name: 'North Ave', shortName: '1', color: '#123456', active: false }],
      patterns, stops, vehicles: [], departures: [], messages: [], warnings: [], updatedAt: Date.now(),
    };
    expect(usablePatterns(network)).toEqual([]);
    expect(directCases(network).length).toBeGreaterThan(0);
    expect(oneRouteNetwork(network, '1001').routes[0].active).toBe(true);
    expect(reachable(network, stops[0], stops.at(-1)!)).toMatchObject({ possible: false });
  });
});
