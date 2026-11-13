import { describe, expect, it } from 'vitest';
import { distanceMeters, parseCoordinate, planJourney, type Journey, type PlannerOptions } from '../src/planner';
import type { Departure, Network, RoutePattern, Stop } from '../src/types';

const NOW = 1_800_000_000_000;
const a: Stop = { id: 'a', name: 'A', lat: 0, lon: 0 };
const b: Stop = { id: 'b', name: 'B', lat: 0, lon: 0.01 };
const c: Stop = { id: 'c', name: 'C', lat: 0, lon: 0.02 };
const d: Stop = { id: 'd', name: 'D', lat: 0.01, lon: 0.01 };
const options: PlannerOptions = {
  now: NOW, maxWalkMeters: 10, maxTransferWalkMeters: 0, walkingSpeedMps: 1,
  busSpeedMps: 10, estimatedWaitSeconds: 0, transferBufferSeconds: 0, dwellSeconds: 0,
};
const pattern = (routeId: string, stops: Stop[], extra: Partial<RoutePattern> = {}): RoutePattern => ({
  id: routeId, routeId, direction: 'outbound', stops, shape: [], ...extra,
});
function network(patterns: RoutePattern[], departures: Departure[] = []): Network {
  const ids = [...new Set(patterns.map(item => item.routeId))];
  return {
    agencyId: 'test', routes: ids.map(id => ({ id, name: `Route ${id}`, shortName: id, color: '#333333', active: true, agencyId: 'test' })),
    stops: [...new Map(patterns.flatMap(item => item.stops).map(stop => [stop.id, stop])).values()],
    patterns, vehicles: [], departures, messages: [], warnings: [], updatedAt: NOW,
  };
}
function journey(result: ReturnType<typeof planJourney>): Journey {
  expect(result.status).toBe('ok');
  if (result.status !== 'ok') throw new Error(result.reason);
  return result.journey;
}
const prediction = (stopId: string, routeId: string, seconds: number, extra: Partial<Departure> = {}): Departure => ({
  stopId, routeId, arrivalTime: NOW + seconds * 1000, direction: 'outbound', tripId: 'trip', ...extra,
});

describe('coordinate input and walking distances', () => {
  it('parses typed map coordinates and geolocation coordinates identically', () => {
    expect(parseCoordinate(' (33.948, -83.377) ')).toEqual({ lat: 33.948, lon: -83.377 });
    expect(parseCoordinate('.5, +.1')).toEqual({ lat: 0.5, lon: 0.1 });
    const data = network([pattern('1', [a, b])]);
    expect(planJourney(data, parseCoordinate('0,0')!, parseCoordinate('0,.01')!, options))
      .toEqual(planJourney(data, { lat: 0, lon: 0 }, { lat: 0, lon: .01 }, options));
  });
  it.each(['91,0', '0,-181', 'foo', '33,-83,2', '33,-83)', '(33,-83', 'NaN,0', 'Infinity,0'])('rejects invalid coordinate %s', value => {
    expect(parseCoordinate(value)).toBeNull();
  });
  it('calculates a known geodesic, including antipodes and identical points', () => {
    expect(distanceMeters(a, b)).toBeCloseTo(1111.949, 2);
    expect(distanceMeters(a, a)).toBe(0);
    expect(distanceMeters(a, { lat: 0, lon: 180 })).toBeCloseTo(Math.PI * 6_371_000);
  });
});

describe('directed bus journeys', () => {
  it('can use a dated schedule without describing it as a live prediction', () => {
    const data = network([pattern('1', [a, b])], [prediction('a', '1', 60, { scheduled: true })]);
    const trip = journey(planJourney(data, a, b, { ...options, estimatedWaitSeconds: 450 }));
    expect(trip.legs.find(leg => leg.kind === 'ride')?.startTime).toBe(NOW + 60000);
    expect(trip.confidence).toBe('estimated');
  });
  it('ignores old original ETA update times even when a newly downloaded network contains them', () => {
    const data = network([pattern('1', [a, b])], [prediction('a', '1', 60, { updatedAt: NOW - 181000 })]);
    const trip = journey(planJourney(data, a, b, { ...options, estimatedWaitSeconds: 450 }));
    expect(trip.legs.find(leg => leg.kind === 'ride')?.startTime).toBe(NOW + 450000);
    expect(trip.confidence).toBe('estimated');
  });
  it('rides through intermediate stops without paying a second boarding wait', () => {
    const result = journey(planJourney(network([pattern('1', [a, b, c])]), a, c, { ...options, estimatedWaitSeconds: 60 }));
    expect(result.legs.map(leg => leg.kind)).toEqual(['wait', 'ride']);
    expect(result.legs[1].kind === 'ride' && result.legs[1].stops.map(stop => stop.id)).toEqual(['a', 'b', 'c']);
    expect(result.durationSeconds).toBeCloseTo(60 + distanceMeters(a, c) * 1.25 / 10);
    expect(result.transfers).toBe(0);
    expect(result.confidence).toBe('estimated');
    expect(result.assumptions.join(' ')).toContain('complete timetable');
  });
  it('does not ride a directed pattern backwards or invent a loop', () => {
    expect(planJourney(network([pattern('1', [a, b, c])]), c, a, options).status).toBe('unavailable');
  });
  it('allows an explicitly defined loop to wrap from its last stop to its first', () => {
    const result = journey(planJourney(network([pattern('1', [a, b, c], { loop: true })]), c, b, options));
    const ride = result.legs.find(leg => leg.kind === 'ride');
    expect(ride?.stops.map(stop => stop.id)).toEqual(['c', 'a', 'b']);
  });
  it('recognizes repeated terminal stops as a closed loop without duplicating terminals', () => {
    const result = journey(planJourney(network([pattern('1', [a, b, c, a])]), c, b, options));
    expect(result.legs.find(leg => leg.kind === 'ride')?.stops.map(stop => stop.id)).toEqual(['c', 'a', 'b']);
  });
  it('excludes inactive routes with topology but no fresh service evidence', () => {
    const data = network([pattern('1', [a, b]), pattern('2', [c, d])]);
    data.routes[0].active = false;
    expect(planJourney(data, a, b, options)).toMatchObject({ status: 'unavailable' });
  });
  it('uses a recent bus position to activate and time a route without a stop ETA', () => {
    const data = network([pattern('1', [a, b, c])]);
    data.routes[0].active = false;
    data.vehicles = [{ id: 'bus', routeId: '1', lat: 0, lon: .005, heading: 90, updatedAt: NOW }];
    const result = journey(planJourney(data, b, c, { ...options, estimatedWaitSeconds: 450 }));
    const ride = result.legs.find(leg => leg.kind === 'ride');
    expect(ride?.source).toBe('vehicle');
    expect(ride?.startTime).toBeLessThan(NOW + 450_000);
    expect(result.confidence).toBe('live-assisted');
  });
  it('rejects invalid input and networks without available topology', () => {
    expect(planJourney(network([]), a, b, options)).toMatchObject({ status: 'unavailable' });
    expect(planJourney(network([pattern('1', [a])]), a, b, options)).toMatchObject({ status: 'unavailable' });
    expect(planJourney(network([pattern('1', [a, b])]), { lat: NaN, lon: 0 }, b, options)).toMatchObject({ status: 'unavailable' });
    expect(planJourney(network([pattern('1', [a, b])]), a, b, { ...options, walkingSpeedMps: 0 })).toMatchObject({ status: 'unavailable' });
  });
  it('reports access, egress, and disconnected network failures', () => {
    const data = network([pattern('1', [a, b]), pattern('2', [c, d])]);
    expect(planJourney(data, { lat: 50, lon: 50 }, b, options)).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('origin') });
    expect(planJourney(data, a, { lat: 50, lon: 50 }, options)).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('destination') });
    expect(planJourney(data, a, d, options)).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('No bus journey') });
  });
  it('never substitutes a walking-only journey, even for nearby points', () => {
    const data = network([pattern('1', [a, b])]);
    expect(planJourney(data, a, { lat: 0, lon: .0001 }, { ...options, maxWalkMeters: 100 }).status).toBe('unavailable');
  });
  it('respects the search horizon', () => {
    expect(planJourney(network([pattern('1', [a, b])]), a, b, { ...options, horizonSeconds: 1 }).status).toBe('unavailable');
  });
});

describe('access, egress and transfers', () => {
  it('adds arbitrary-coordinate access and egress walks', () => {
    const origin = { lat: .0001, lon: 0 }, destination = { lat: .0001, lon: .01 };
    const result = journey(planJourney(network([pattern('1', [a, b])]), origin, destination, { ...options, maxWalkMeters: 20 }));
    expect(result.legs.map(leg => leg.kind)).toEqual(['walk', 'ride', 'walk']);
    expect(result.walkingMeters).toBeCloseTo(distanceMeters(origin, a) + distanceMeters(b, destination));
    expect(result.legs[0].from).toMatchObject(origin);
    expect(result.legs.at(-1)?.to).toMatchObject(destination);
  });
  it('searches every feasible boarding stop instead of greedily selecting the nearest', () => {
    const near = { ...a, id: 'near', lon: .00001 }, further = { ...a, id: 'further', lon: .0005 };
    const data = network([pattern('slow', [near, b]), pattern('fast', [further, b])], [
      prediction('near', 'slow', 900), prediction('b', 'slow', 1200),
      prediction('further', 'fast', 60), prediction('b', 'fast', 120),
    ]);
    const result = journey(planJourney(data, a, b, { ...options, maxWalkMeters: 60, estimatedWaitSeconds: 450 }));
    expect(result.legs.find(leg => leg.kind === 'ride')?.routeId).toBe('fast');
    expect(result.durationSeconds).toBe(120);
  });
  it('searches every feasible alighting stop instead of selecting the nearest destination stop', () => {
    const near = { ...c, id: 'near', lon: .02001 }, further = { ...c, id: 'further', lon: .0195 };
    const data = network([pattern('slow', [a, near]), pattern('fast', [a, further])], [
      prediction('a', 'slow', 5), prediction('near', 'slow', 900),
      prediction('a', 'fast', 5), prediction('further', 'fast', 200),
    ]);
    const result = journey(planJourney(data, a, c, { ...options, maxWalkMeters: 60, estimatedWaitSeconds: 900 }));
    expect(result.legs.find(leg => leg.kind === 'ride')?.routeId).toBe('fast');
    expect(result.legs.at(-1)?.kind).toBe('walk');
  });
  it('finds same-stop transfers and includes a change buffer and the next bus wait', () => {
    const data = network([pattern('1', [a, b]), pattern('2', [b, c])], [
      prediction('a', '1', 10), prediction('b', '1', 100),
      prediction('b', '2', 110), prediction('c', '2', 210),
      prediction('b', '2', 180, { tripId: 'second' }), prediction('c', '2', 280, { tripId: 'second' }),
    ]);
    const result = journey(planJourney(data, a, c, { ...options, estimatedWaitSeconds: 450, transferBufferSeconds: 30 }));
    expect(result.transfers).toBe(1);
    expect(result.durationSeconds).toBe(280);
    expect(result.legs.filter(leg => leg.kind === 'ride').map(leg => leg.routeId)).toEqual(['1', '2']);
    expect(result.legs.filter(leg => leg.kind === 'wait').at(-1)?.startTime).toBe(NOW + 100_000);
  });
  it('finds transfers between nearby distinct stops', () => {
    const transfer = { ...b, id: 'transfer', lat: .0001 };
    const data = network([pattern('1', [a, b]), pattern('2', [transfer, c])]);
    const result = journey(planJourney(data, a, c, { ...options, maxTransferWalkMeters: 20 }));
    expect(result.transfers).toBe(1);
    expect(result.legs.filter(leg => leg.kind === 'walk')).toHaveLength(1);
    expect(result.walkingMeters).toBeCloseTo(distanceMeters(b, transfer));
    expect(planJourney(data, a, c, { ...options, maxTransferWalkMeters: 5 }).status).toBe('unavailable');
  });
  it('does not chain short transfer walks into an arbitrary walking journey', () => {
    const x = { ...b, id: 'x', lon: .011 }, y = { ...b, id: 'y', lon: .012 }, z = { ...b, id: 'z', lon: .013 };
    const data = network([pattern('1', [a, b]), pattern('dead', [y, x]), pattern('2', [z, c])]);
    expect(planJourney(data, a, c, { ...options, maxTransferWalkMeters: 120 }).status).toBe('unavailable');
  });
  it('keeps later stop arrivals that catch the same connection with fewer transfers', () => {
    const x = { ...b, id: 'x', lon: .002 }, transfer = { ...b, lon: .004 }, goal = { ...c, lon: .006 };
    const data = network([pattern('1', [a, x]), pattern('2', [x, transfer]), pattern('3', [a, transfer]), pattern('4', [transfer, goal])], [
      prediction('a', '1', 10), prediction('x', '1', 20),
      prediction('x', '2', 30), prediction('b', '2', 40),
      prediction('a', '3', 10), prediction('b', '3', 50),
      prediction('b', '4', 100), prediction('c', '4', 150),
    ]);
    const result = journey(planJourney(data, a, goal, { ...options, estimatedWaitSeconds: 450 }));
    expect(result.durationSeconds).toBe(150);
    expect(result.transfers).toBe(1);
    expect(result.legs.filter(leg => leg.kind === 'ride').map(leg => leg.routeId)).toEqual(['3', '4']);
  });
  it('keeps later stop arrivals that catch the same connection with less walking', () => {
    const near = { ...a, id: 'near', lon: .0001 }, further = { ...a, id: 'further', lon: .0002 };
    const transfer = { ...b, lon: .004 }, goal = { ...c, lon: .006 };
    const data = network([pattern('slow', [near, transfer]), pattern('fast', [further, transfer]), pattern('last', [transfer, goal])], [
      prediction('near', 'slow', 30), prediction('b', 'slow', 60),
      prediction('further', 'fast', 30), prediction('b', 'fast', 50),
      prediction('b', 'last', 100), prediction('c', 'last', 150),
    ]);
    const result = journey(planJourney(data, a, goal, { ...options, maxWalkMeters: 30, estimatedWaitSeconds: 450 }));
    expect(result.durationSeconds).toBe(150);
    expect(result.transfers).toBe(1);
    expect(result.walkingMeters).toBeCloseTo(distanceMeters(a, near));
    expect(result.legs.find(leg => leg.kind === 'ride')?.routeId).toBe('slow');
  });
});

describe('live arrival predictions and estimates', () => {
  it('includes live wait and matches the same run to downstream arrivals', () => {
    const data = network([pattern('1', [a, b])], [prediction('a', '1', 30), prediction('b', '1', 90)]);
    const result = journey(planJourney(data, a, b, options));
    expect(result.durationSeconds).toBe(90);
    expect(result.confidence).toBe('live-assisted');
    expect(result.legs[0]).toMatchObject({ kind: 'wait', startTime: NOW, endTime: NOW + 30_000, source: 'live' });
  });
  it('boards a waiting bus at its EDT after its reported arrival has passed', () => {
    const data = network([pattern('1', [a, b])], [
      prediction('a', '1', -5, { departureTime: NOW + 30_000 }), prediction('b', '1', 100),
    ]);
    const result = journey(planJourney(data, a, b, options));
    expect(result.durationSeconds).toBe(100);
    expect(result.legs.find(leg => leg.kind === 'ride')?.startTime).toBe(NOW + 30_000);
    expect(result.confidence).toBe('live-assisted');
  });
  it('preserves a feasible downstream ETA through an unpredicted intermediate stop', () => {
    const data = network([pattern('1', [a, b, c])], [prediction('a', '1', 10), prediction('c', '1', 100)]);
    const result = journey(planJourney(data, a, c, { ...options, estimatedWaitSeconds: 450 }));
    expect(result.durationSeconds).toBe(100);
    expect(result.legs.find(leg => leg.kind === 'ride')?.stops.map(stop => stop.id)).toEqual(['a', 'b', 'c']);
    const middle = journey(planJourney(data, a, b, { ...options, estimatedWaitSeconds: 450 }));
    expect(middle.durationSeconds).toBeCloseTo(55);
  });
  it('preserves intermediate stop dwell before estimating onward travel', () => {
    const data = network([pattern('1', [a, b, c])], [
      prediction('a', '1', 10), prediction('b', '1', 100, { departureTime: NOW + 300_000 }),
    ]);
    const result = journey(planJourney(data, a, c, { ...options, estimatedWaitSeconds: 450 }));
    expect(result.durationSeconds).toBeCloseTo(300 + distanceMeters(b, c) * 1.25 / 10);
    const alight = journey(planJourney(data, a, b, { ...options, estimatedWaitSeconds: 450 }));
    expect(alight.durationSeconds).toBe(100);
    data.departures.push(prediction('c', '1', 200));
    // An inconsistent next-stop ETA cannot move the bus before its EDT at B.
    expect(journey(planJourney(data, a, c, { ...options, estimatedWaitSeconds: 450 })).durationSeconds)
      .toBeCloseTo(result.durationSeconds);
  });
  it('can choose a later but faster live bus', () => {
    const data = network([pattern('1', [a, b])], [
      prediction('a', '1', 10), prediction('b', '1', 400),
      prediction('a', '1', 100, { tripId: 'express' }), prediction('b', '1', 150, { tripId: 'express' }),
    ]);
    const result = journey(planJourney(data, a, b, { ...options, estimatedWaitSeconds: 450 }));
    expect(result.durationSeconds).toBe(150);
    expect(result.legs.find(leg => leg.kind === 'ride')?.startTime).toBe(NOW + 100_000);
  });
  it('does not conflate runs of the same bus when trip IDs differ', () => {
    const data = network([pattern('1', [a, b])], [
      prediction('a', '1', 10, { vehicleId: 'bus', tripId: 'first' }),
      prediction('b', '1', 50, { vehicleId: 'bus', tripId: 'second' }),
    ]);
    const result = journey(planJourney(data, a, b, { ...options, estimatedWaitSeconds: 450 }));
    expect(result.durationSeconds).toBeGreaterThan(100);
  });
  it('does not reuse expired predictions or board a bus before reaching the stop', () => {
    const data = network([pattern('1', [a, b])], [prediction('a', '1', 5), prediction('b', '1', 100)]);
    const result = journey(planJourney(data, { lat: .0001, lon: 0 }, b, { ...options, maxWalkMeters: 20, estimatedWaitSeconds: 60 }));
    const ride = result.legs.find(leg => leg.kind === 'ride')!;
    expect(ride.source).toBe('estimated');
    expect(ride.startTime).toBeGreaterThan(NOW + 70_000);
    data.departures = [prediction('a', '1', -30)];
    expect(journey(planJourney(data, a, b, { ...options, estimatedWaitSeconds: 60 })).legs[0]).toMatchObject({ kind: 'wait', source: 'estimated', endTime: NOW + 60_000 });
  });
  it('ignores stale network predictions and impossible downstream travel', () => {
    const data = network([pattern('1', [a, b])], [prediction('a', '1', 10), prediction('b', '1', 11)]);
    expect(journey(planJourney(data, a, b, options)).durationSeconds).toBeGreaterThan(100);
    data.updatedAt = NOW - 181_000;
    expect(journey(planJourney(data, a, b, options)).confidence).toBe('estimated');
  });
  it('keeps opposite-direction departures separate and ignores ambiguous directionless predictions', () => {
    const data = network([pattern('1', [a, b]), pattern('1', [b, a], { id: 'return', direction: 'inbound' })], [
      prediction('a', '1', 10, { direction: 'inbound' }), prediction('b', '1', 90, { direction: 'inbound' }),
    ]);
    expect(journey(planJourney(data, a, b, options)).confidence).toBe('estimated');
    data.departures = data.departures.map(item => ({ ...item, direction: undefined }));
    expect(journey(planJourney(data, a, b, options)).confidence).toBe('estimated');
  });
  it('uses directionless predictions safely for a route with one available direction', () => {
    const data = network([pattern('1', [a, b])], [prediction('a', '1', 10, { direction: undefined }), prediction('b', '1', 90, { direction: undefined })]);
    expect(journey(planJourney(data, a, b, options)).confidence).toBe('live-assisted');
  });
  it('permits estimated following service without violating earliest-arrival dominance', () => {
    const data = network([pattern('1', [a, b])], [prediction('a', '1', 10), prediction('b', '1', 1000)]);
    const result = journey(planJourney(data, a, b, { ...options, estimatedWaitSeconds: 60 }));
    expect(result.legs.find(leg => leg.kind === 'ride')?.source).toBe('estimated');
    expect(result.durationSeconds).toBeCloseTo(70 + distanceMeters(a, b) * 1.25 / 10);
  });
});

describe('geometry and determinism', () => {
  it('uses a matching route trace instead of a straight line through a bend', () => {
    const data = network([pattern('1', [a, b], { shape: [a, { lat: .01, lon: 0 }, { lat: .01, lon: .01 }, b] })]);
    const result = journey(planJourney(data, a, b, options));
    expect(result.durationSeconds).toBeGreaterThan(distanceMeters(a, b) * 2.9 / 10);
  });
  it('falls back from unrelated or reversed geometry', () => {
    const baseline = journey(planJourney(network([pattern('1', [a, b])]), a, b, options));
    const reversed = journey(planJourney(network([pattern('1', [a, b], { shape: [b, a] })]), a, b, options));
    expect(reversed.durationSeconds).toBe(baseline.durationSeconds);
  });
  it('chooses reproducibly on ties and handles an agency-sized network', () => {
    const stops = Array.from({ length: 120 }, (_, i) => ({ id: String(i), name: `Stop ${i}`, lat: 0, lon: i * .001 }));
    const data = network([pattern('1', stops), pattern('2', stops)]);
    const started = performance.now();
    const first = journey(planJourney(data, stops[0], stops.at(-1)!, { ...options, horizonSeconds: 100_000 }));
    expect(first.legs.find(leg => leg.kind === 'ride')?.routeId).toBe('1');
    expect(first).toEqual(journey(planJourney(data, stops[0], stops.at(-1)!, { ...options, horizonSeconds: 100_000 })));
    expect(performance.now() - started).toBeLessThan(3000);
  });
  it('matches exhaustive path enumeration on 40 directed networks with overtaking live trips', () => {
    // This oracle enumerates simple paths without labels, a heap, or dominance
    // pruning. Each pattern has two stops so the independent edge calculation
    // uses its published trip times directly.
    let seed = 4581;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
    for (let scenario = 0; scenario < 40; scenario++) {
      const stops = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, lat: 0, lon: i * .002 }));
      const patterns: RoutePattern[] = [], departures: Departure[] = [];
      for (let from = 0; from < stops.length; from++) for (let to = 0; to < stops.length; to++) {
        if (from === to || random() > .36) continue;
        const id = `${from}:${to}`;
        patterns.push(pattern(id, [stops[from], stops[to]]));
        const minimum = distanceMeters(stops[from], stops[to]) / 30;
        for (let run = 0; run < 2; run++) {
          const start = 10 + Math.floor(random() * 100);
          const arrival = start + minimum + 5 + Math.floor(random() * 150);
          departures.push(prediction(stops[from].id, id, start, { tripId: `${id}:${run}` }), prediction(stops[to].id, id, arrival, { tripId: `${id}:${run}` }));
        }
      }
      const data = network(patterns, departures), wait = 45, buffer = 8;
      let oracle = Infinity;
      const enumerate = (at: Stop, seconds: number, visited: Set<string>, boarded: boolean) => {
        if (at.id === stops[4].id && boarded) oracle = Math.min(oracle, seconds);
        if (seconds >= oracle) return;
        for (const edge of patterns.filter(item => item.stops[0].id === at.id)) {
          const next = edge.stops[1];
          if (visited.has(next.id)) continue;
          const ready = seconds + (boarded ? buffer : 0);
          const known = departures.filter(item => item.routeId === edge.routeId && item.stopId === at.id);
          let arrival = Math.max(ready, ...known.map(item => (item.arrivalTime - NOW) / 1000)) + wait
            + distanceMeters(at, next) * 1.25 / 10;
          for (const start of known.filter(item => (item.arrivalTime - NOW) / 1000 >= ready)) {
            const end = departures.find(item => item.routeId === edge.routeId && item.stopId === next.id && item.tripId === start.tripId)!;
            arrival = Math.min(arrival, (end.arrivalTime - NOW) / 1000);
          }
          enumerate(next, arrival, new Set([...visited, next.id]), true);
        }
      };
      enumerate(stops[0], 0, new Set([stops[0].id]), false);
      const result = planJourney(data, stops[0], stops[4], { ...options, estimatedWaitSeconds: wait, transferBufferSeconds: buffer });
      if (oracle === Infinity) expect(result.status, `scenario ${scenario}`).toBe('unavailable');
      else expect(journey(result).durationSeconds, `scenario ${scenario}`).toBeCloseTo(oracle, 5);
    }
  });
});
