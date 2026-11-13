import { describe, expect, it } from 'vitest';
import { MergeSession, type Crosswalk, type Observation, type SourceIdentity } from '../src/replication/merge';
import { planJourney } from '../src/planner';
import type { Departure, Network, Route, RouteDetail, RoutePattern, Stop, Vehicle } from '../src/types';

const NOW = 1_800_000_000_000;
const A: SourceIdentity = { id: 'a', label: 'Primary', priority: 0 };
const B: SourceIdentity = { id: 'b', label: 'Replica B', priority: 1 };
const C: SourceIdentity = { id: 'c', label: 'Replica C', priority: 2 };
const observe = <T>(source: SourceIdentity, value: T, extra: Partial<Observation<T>> = {}): Observation<T> => ({ source, value, at: NOW, cached: false, ...extra });
const route = (extra: Partial<Route> = {}): Route => ({ id: '1', agencyId: 'test', name: 'Route One', shortName: '1', color: '#123456', active: true, ...extra });
const a: Stop = { id: 'a', name: 'A', lat: 33.95, lon: -83.37 };
const b: Stop = { id: 'b', name: 'B', lat: 33.96, lon: -83.37 };
const c: Stop = { id: 'c', name: 'C', lat: 33.97, lon: -83.37 };
const pattern = (extra: Partial<RoutePattern> = {}): RoutePattern => ({ id: 'p', routeId: '1', direction: '0', stops: [a, b, c], shape: [], loop: false, ...extra });
const vehicle = (extra: Partial<Vehicle> = {}): Vehicle => ({ id: 'v', routeId: '1', lat: 33.95, lon: -83.37, heading: 0, updatedAt: NOW - 1000, ...extra });
const departure = (extra: Partial<Departure> = {}): Departure => ({ stopId: 'a', routeId: '1', direction: '0', arrivalTime: NOW + 100_000, ...extra });
const network = (extra: Partial<Network> = {}): Network => ({ agencyId: 'test', routes: [route()], stops: [a, b, c], patterns: [pattern()], vehicles: [], departures: [], messages: [], warnings: [], updatedAt: NOW, ...extra });
const detail = (extra: Partial<RouteDetail> = {}): RouteDetail => ({ route: route(), stops: [a, b, c], patterns: [pattern()], vehicles: [], departures: [], messages: [], warnings: [], ...extra });
const session = (aliases?: Crosswalk) => new MergeSession(aliases, NOW, 'test');

describe('replicated observations and fallback selection', () => {
  it('uses a 2-of-3 agreeing pair when the preferred primary is an outlier', () => {
    const merger = session();
    const result = merger.routes([observe(A, [route({ active: true })]), observe(B, [route({ active: false, name: 'B selected' })]), observe(C, [route({ active: false })])]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ active: false, name: 'B selected', agreement: 'corroborated' });
    expect(result[0].sources?.map(source => source.source)).toEqual(['Primary', 'Replica B', 'Replica C']);
    expect(merger.counts).toEqual({ agreements: 1, conflicts: 1, singleSource: 0, cached: 0 });
  });
  it('keeps a surviving backup usable when the other two sources are absent', () => {
    const merger = session();
    const [result] = merger.routes([observe(B, [route()])]);
    expect(result).toMatchObject({ id: '1', active: true, agreement: 'single-source' });
    expect(result.sources).toEqual([{ source: 'Replica B', id: '1', fetchedAt: NOW, cached: false }]);
    expect(merger.counts.singleSource).toBe(1);
  });
  it('does not let duplicated rows from one source manufacture a majority', () => {
    const merger = session();
    const [result] = merger.routes([observe(A, [route(), route(), route()])]);
    expect(result.agreement).toBe('single-source');
    expect(result.sources).toHaveLength(1);
    expect(merger.counts.agreements).toBe(0);
  });
  it('prefers fresh primary observations over an agreeing cached majority', () => {
    const merger = session();
    const [result] = merger.routes([
      observe(A, [route({ active: true })]),
      observe(B, [route({ active: false })], { cached: true, at: NOW - 10_000 }),
      observe(C, [route({ active: false })], { cached: true, at: NOW - 10_000 }),
    ]);
    expect(result).toMatchObject({ active: true, agreement: 'single-source' });
    expect(result.sources?.filter(source => source.cached)).toHaveLength(2);
    expect(merger.counts.agreements).toBe(0);
  });
  it('does not refresh or prefer a nested coordinator cached result over a fresh surviving provider', () => {
    const saved = route({ active: true, agreement: 'stale-backup', sources: [{ source: 'Old backend', id: '1', fetchedAt: NOW - 10_000, cached: true }] });
    const merger = session();
    const [result] = merger.routes([observe(A, [saved]), observe(B, [route({ active: false })])]);
    expect(result).toMatchObject({ active: false, agreement: 'single-source' });
    expect(result.sources?.find(source => source.source === 'Old backend')).toMatchObject({ fetchedAt: NOW - 10_000, cached: true });
  });
  it('expires nested cached active service and predictions using their original snapshot times', () => {
    const original = NOW - 120_001;
    const saved = { agreement: 'stale-backup' as const, sources: [{ source: 'Old backend', id: '1', fetchedAt: original, cached: true }] };
    const merger = session();
    expect(merger.routes([observe(A, [route(saved)])])[0]).toMatchObject({ active: false, agreement: 'stale-backup' });
    expect(merger.departures([observe(A, [departure(saved)])])).toEqual([]);
  });
  it('preserves stale topology for inspection but expires cached active service', () => {
    const merger = session();
    const [current] = merger.routes([observe(B, [route()], { cached: true, at: NOW - 120_000 })]);
    const [expired] = merger.routes([observe(B, [route()], { cached: true, at: NOW - 120_001 })]);
    expect(current).toMatchObject({ active: true, agreement: 'stale-backup' });
    expect(expired).toMatchObject({ active: false, agreement: 'stale-backup' });
    expect(expired.sources?.[0].fetchedAt).toBe(NOW - 120_001);
    expect(merger.patterns([observe(B, [pattern()], { cached: true, at: NOW - 3_600_000 })])[0].stops).toEqual([a, b, c]);
  });
});

describe('published routes versus current service availability', () => {
  it('does not let two publication flags outvote an explicit current inactive report', () => {
    const merger = session();
    const [result] = merger.routes([
      observe(A, [route({ availability: 'current', active: false })]),
      observe(B, [route({ availability: 'published', active: true })]),
      observe(C, [route({ availability: 'published', active: true })]),
    ]);
    expect(result).toMatchObject({ active: false, availability: 'current', agreement: 'single-source' });
    expect(merger.counts.agreements).toBe(0);
    expect(merger.counts.conflicts).toBe(0);
  });
  it('uses actual current-state votes while publication metadata abstains', () => {
    const merger = session();
    const [result] = merger.routes([
      observe(A, [route({ availability: 'current', active: false })]),
      observe(B, [route({ availability: 'current', active: false })]),
      observe(C, [route({ availability: 'published', active: true })]),
    ]);
    expect(result).toMatchObject({ active: false, agreement: 'corroborated' });
    expect(merger.counts.conflicts).toBe(0);
  });
  it('keeps a published day route visible but cannot invent a bus journey when service is unconfirmed', () => {
    const merger = session();
    const published = route({ availability: 'published', active: true });
    expect(merger.routes([observe(B, [published])])).toHaveLength(1);
    const result = session().network([observe(B, network({ routes: [published] }))]);
    expect(result.routes[0].active).toBe(false);
    expect(planJourney(result, a, c, { now: NOW, maxWalkMeters: 10 }).status).toBe('unavailable');
  });
  it('can enable a published fallback route from a credible current arrival prediction', () => {
    const result = session().network([observe(B, network({
      routes: [route({ availability: 'published' })],
      departures: [departure({ updatedAt: NOW - 1000, scheduled: false })],
    }))]);
    expect(result.routes[0].active).toBe(true);
    expect(planJourney(result, a, c, { now: NOW, maxWalkMeters: 10 }).status).toBe('ok');
  });
  it('can enable a published fallback route from a fresh reported vehicle', () => {
    const result = session().network([observe(B, network({ routes: [route({ availability: 'published' })], vehicles: [vehicle()] }))]);
    expect(result.routes[0].active).toBe(true);
  });
  it.each([
    ['expired', NOW - 180_001, false], ['unknown age', undefined, false],
    ['invalid future time', NOW + 60_001, false], ['schedule only', NOW - 1000, true],
  ] as const)('does not infer current service from %s arrival data', (_label, updatedAt, scheduled) => {
    const result = session().network([observe(B, network({
      routes: [route({ availability: 'published' })], departures: [departure({ updatedAt, scheduled })],
    }))]);
    expect(result.routes[0].active).toBe(false);
  });
  it('does not infer current service from stale or unknown-age vehicle positions', () => {
    for (const updatedAt of [undefined, NOW - 120_001]) {
      const result = session().network([observe(B, network({ routes: [route({ availability: 'published' })], vehicles: [vehicle({ updatedAt })] }))]);
      expect(result.routes[0].active).toBe(false);
    }
  });
});

describe('vehicle identity, position and freshness agreement', () => {
  it('selects a concrete agreeing observation without averaging coordinates or headings', () => {
    const first = vehicle({ lat: 33.97, heading: 100 });
    const second = vehicle({ lat: 33.9501, heading: 359 });
    const third = vehicle({ lat: 33.9502, heading: 1 });
    const merger = session();
    const [result] = merger.vehicles([observe(A, [first]), observe(B, [second]), observe(C, [third])]);
    expect(result).toMatchObject({ lat: second.lat, lon: second.lon, heading: 359, agreement: 'corroborated' });
    expect(result.lat).not.toBe((second.lat + third.lat) / 2);
    expect(result.heading).not.toBe(180);
    expect(merger.counts.conflicts).toBe(1);
  });
  it('uses pairwise agreement rather than treating a tolerance chain as three agreeing sources', () => {
    const merger = session();
    const [result] = merger.vehicles([
      observe(A, [vehicle({ lat: 33.95 })]),
      observe(B, [vehicle({ lat: 33.9507 })]),
      observe(C, [vehicle({ lat: 33.9514 })]),
    ]);
    expect(result).toMatchObject({ lat: 33.95, agreement: 'corroborated' });
    // A-B and B-C are within100m; A-C are not. The disagreement remains visible.
    expect(merger.counts.conflicts).toBe(1);
  });
  it.each([
    ['unknown', undefined], ['stale', NOW - 120_001], ['future', NOW + 60_001],
  ] as const)('does not allow %s measurement times to vote', (_name, updatedAt) => {
    const merger = session();
    const [result] = merger.vehicles([observe(A, [vehicle({ updatedAt })]), observe(B, [vehicle({ updatedAt })])]);
    expect(result.agreement).not.toBe('corroborated');
    expect(merger.counts.agreements).toBe(0);
    expect(result.updatedAt).toBe(updatedAt);
  });
  it('prefers an actual fresh measurement over unknown-time primary data', () => {
    const merger = session();
    const [result] = merger.vehicles([
      observe(A, [vehicle({ updatedAt: undefined, lat: 33.97 })]),
      observe(B, [vehicle({ updatedAt: NOW - 5000, lat: 33.95 })]),
    ]);
    expect(result).toMatchObject({ lat: 33.95, updatedAt: NOW - 5000, agreement: 'single-source' });
  });
  it('does not corroborate a same-fleet position when route assignments disagree', () => {
    const merger = session();
    const [result] = merger.vehicles([
      observe(A, [vehicle({ routeId: '12' })]),
      observe(B, [vehicle({ routeId: '14' })]),
    ]);
    expect(result).toMatchObject({ id: 'v', routeId: '12', agreement: 'conflict' });
    expect(merger.counts.conflicts).toBe(1);
  });
  it('keeps original timestamps on a bounded cached fallback and drops older cached positions', () => {
    const merger = session(), old = vehicle({ updatedAt: NOW - 180_000 });
    const [result] = merger.vehicles([observe(B, [old], { cached: true, at: NOW - 300_000 })]);
    expect(result).toMatchObject({ updatedAt: old.updatedAt, agreement: 'stale-backup' });
    expect(merger.vehicles([observe(B, [old], { cached: true, at: NOW - 300_001 })])).toEqual([]);
  });
});

describe('complete directed topology and planning safety', () => {
  it('takes the complete majority pattern and preserves the agreeing road trace', () => {
    const merger = session(), shape = [{ lat: 33.95, lon: -83.37 }, { lat: 33.96, lon: -83.38 }];
    const [result] = merger.patterns([
      observe(A, [pattern({ stops: [a, c, b] })]),
      observe(B, [pattern()]),
      observe(C, [pattern({ shape })]),
    ]);
    expect(result.stops.map(stop => stop.id)).toEqual(['a', 'b', 'c']);
    expect(result.shape).toEqual(shape);
    expect(result.agreement).toBe('corroborated');
  });
  it('shows conflicting topology in route details but excludes it from the planning network', () => {
    const merger = session();
    const inputs = [observe(A, network()), observe(B, network({ patterns: [pattern({ stops: [a, c, b] })] }))];
    const result = merger.network(inputs);
    expect(result.patterns).toEqual([]);
    expect(result.warnings.join(' ')).toContain('excluded from planning');
    const routeDetail = session().route([observe(A, detail()), observe(B, detail({ patterns: [pattern({ stops: [a, c, b] })] }))]);
    expect(routeDetail.patterns[0]).toMatchObject({ agreement: 'conflict' });
    expect(routeDetail.patterns[0].stops.map(stop => stop.id)).toEqual(['a', 'b', 'c']);
  });
  it('does not confuse a stop set with directed order or splice disjoint variants', () => {
    const merger = session();
    const result = merger.network([
      observe(A, network({ patterns: [pattern({ stops: [a, b, c] })] })),
      observe(B, network({ patterns: [pattern({ stops: [c, b, a] })] })),
      observe(C, network({ patterns: [pattern({ stops: [a, c] })] })),
    ]);
    expect(result.patterns).toHaveLength(0);
  });
  it('treats unknown loop closure as abstention and retains known UGA loop evidence', () => {
    const merger = session();
    const result = merger.network([
      observe(A, network({ patterns: [pattern({ loop: undefined })] })),
      observe(B, network({ patterns: [pattern({ loop: true })] })),
    ]);
    expect(result.patterns[0]).toMatchObject({ loop: true, agreement: 'corroborated' });
  });
  it('excludes conflicting known loop closure instead of silently making a bus cycle', () => {
    const merger = session();
    const result = merger.network([
      observe(A, network({ patterns: [pattern({ loop: false })] })),
      observe(B, network({ patterns: [pattern({ loop: true })] })),
    ]);
    expect(result.patterns).toHaveLength(0);
  });
  it('does not let an unknown loop vote break a tie between contradictory known loop evidence', () => {
    const merger = session();
    const result = merger.network([
      observe(A, network({ patterns: [pattern({ loop: undefined })] })),
      observe(B, network({ patterns: [pattern({ loop: false })] })),
      observe(C, network({ patterns: [pattern({ loop: true })] })),
    ]);
    expect(result.patterns).toHaveLength(0);
    expect(result.warnings.join(' ')).toContain('excluded from planning');
  });
  it('counts a closure conflict once and does not count the final disputed pattern as corroborated', () => {
    const merger = session();
    const [result] = merger.patterns([
      observe(A, [pattern({ loop: undefined })]),
      observe(B, [pattern({ loop: false })]),
      observe(C, [pattern({ loop: true })]),
    ]);
    expect(result.agreement).toBe('conflict');
    expect(merger.counts).toEqual({ agreements: 0, conflicts: 1, singleSource: 1, cached: 0 });
  });
  it('keeps additional explicit pattern variants separate', () => {
    const merger = session();
    const result = merger.network([
      observe(A, network()),
      observe(B, network({ patterns: [pattern(), pattern({ id: 'p2', direction: 'variant2', stops: [a, c] })] })),
    ]);
    expect(result.patterns).toHaveLength(2);
    expect(result.patterns.find(item => item.direction === '0')?.agreement).toBe('corroborated');
    expect(result.patterns.find(item => item.direction === 'variant2')).toMatchObject({ agreement: 'single-source', stops: [a, c] });
  });
});

describe('reviewed identities and operator boundaries', () => {
  const aliases: Crosswalk = {
    routes: [
      { id: '1001', sources: { uga: '1001', infopoint: '1' }, directions: [{ id: '1', sources: { uga: '1', infopoint: 'O' } }] },
      { id: '5750', sources: { uga: '5750', passio: '5750' }, directions: [{ id: '0', sources: { uga: '0', passio: '44886' } }] },
    ],
    stops: [{ id: 'c1', sources: { uga: 'c1', infopoint: '1' } }],
    vehicles: [{ id: '122', sources: { uga: '122', infopoint: '122' } }],
  };
  const uga: SourceIdentity = { id: 'uga', label: 'UGA', priority: 0, aliasKey: 'uga', prefix: '' };
  const info: SourceIdentity = { id: 'info', label: 'Athens GA', priority: 1, aliasKey: 'infopoint', prefix: 'infopoint:' };
  const passio: SourceIdentity = { id: 'passio', label: 'UGA Passio', priority: 2, aliasKey: 'passio', prefix: 'passio:' };

  it('merges explicit route/stop/vehicle aliases and preserves reversible native IDs', () => {
    const merger = session(aliases);
    const merged = merger.routes([observe(uga, [route({ id: '1001' })]), observe(info, [route({ id: '1' })])]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: '1001', agreement: 'corroborated' });
    expect(merger.canonical('stops', '1', info)).toBe('c1');
    expect(merger.canonical('vehicles', '122', info)).toBe('122');
    expect(merger.native('routes', '1001', info)).toBe('1');
    expect(merger.native('routes', '5750', info)).toBeUndefined();
    expect(merger.direction('1001', 'O', info)).toBe('1');
    expect(merger.direction('5750', '44886', passio)).toBe('0');
    expect(merger.direction('5750', '74415', passio)).toBe('passio:74415');
  });
  it('does not infer identities from equal route names or nearby stop positions', () => {
    const merger = session(aliases);
    const merged = merger.routes([observe(uga, [route({ id: '6747', name: 'Riverbend' })]), observe(info, [route({ id: '12', name: 'Riverbend' })])]);
    expect(merged.map(item => item.id)).toEqual(['6747', 'infopoint:12']);
    const mergedStops = merger.stops([observe(uga, [a]), observe(info, [{ ...a, id: 'other' }])]);
    expect(mergedStops.map(item => item.id)).toEqual(['a', 'infopoint:other']);
  });
  it('keeps Ohio and Georgia identities separate even with identical raw IDs', () => {
    const ohio: SourceIdentity = { id: 'ohio', label: 'Athens Ohio', priority: 0, prefix: 'ohio:' };
    const merger = session(aliases);
    const result = merger.routes([observe(uga, [route({ id: '5750' })]), observe(ohio, [route({ id: '5750' })])]);
    expect(result.map(item => item.id)).toEqual(['5750', 'ohio:5750']);
    expect(result.every(item => item.agreement === 'single-source')).toBe(true);
  });
});

describe('arrival prediction identity and ambiguity', () => {
  it('corroborates uniquely matched predictions within90s without averaging their times', () => {
    const merger = session();
    const result = merger.departures([
      observe(A, [departure({ tripId: 'run', arrivalTime: NOW + 100_000 })]),
      observe(B, [departure({ tripId: 'run', arrivalTime: NOW + 170_000 })]),
      observe(C, [departure({ tripId: 'run', arrivalTime: NOW + 600_000 })]),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ arrivalTime: NOW + 100_000, agreement: 'corroborated' });
    expect(result[0].sources).toHaveLength(3);
    expect(merger.counts.conflicts).toBe(1);
  });
  it('keeps distant unidentified predictions separate because they may represent different buses', () => {
    const result = session().departures([
      observe(A, [departure({ arrivalTime: NOW + 100_000 })]),
      observe(B, [departure({ arrivalTime: NOW + 600_000 })]),
    ]);
    expect(result).toHaveLength(2);
    expect(result.every(item => item.agreement === 'single-source')).toBe(true);
  });
  it('does not equate separate passes of the same fleet vehicle without a proven trip identity', () => {
    const result = session().departures([
      observe(A, [departure({ vehicleId: 'v', arrivalTime: NOW + 100_000 })]),
      observe(B, [departure({ vehicleId: 'v', arrivalTime: NOW + 600_000 })]),
    ]);
    expect(result).toHaveLength(2);
    expect(result.every(item => item.agreement === 'single-source')).toBe(true);
  });
  it('reports a proven-run ETA disagreement as one conflicting departure when there is no majority', () => {
    const result = session().departures([
      observe(A, [departure({ tripId: 'run', arrivalTime: NOW + 100_000 })]),
      observe(B, [departure({ tripId: 'run', arrivalTime: NOW + 600_000 })]),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ arrivalTime: NOW + 100_000, agreement: 'conflict' });
  });
  it('does not merge different trips, directions, or stops', () => {
    for (const extra of [
      { tripId: 'different' }, { direction: 'return' }, { stopId: 'b' },
    ]) {
      const merger = session();
      const result = merger.departures([observe(A, [departure({ tripId: 'run' })]), observe(B, [departure({ tripId: 'run', ...extra })])]);
      expect(result).toHaveLength(2);
      expect(result.every(item => item.agreement === 'single-source')).toBe(true);
    }
  });
  it('does not corroborate a scheduled time against a predicted time for the same proven run', () => {
    const result = session().departures([
      observe(A, [departure({ tripId: 'run' })]),
      observe(B, [departure({ tripId: 'run', scheduled: true })]),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ tripId: 'run', agreement: 'conflict' });
  });
  it('leaves scheduled and predicted values separate when no identity proves they describe the same run', () => {
    const result = session().departures([
      observe(A, [departure()]), observe(B, [departure({ scheduled: true })]),
    ]);
    expect(result).toHaveLength(2);
    expect(result.every(item => item.agreement === 'single-source')).toBe(true);
  });
  it('leaves unidentified predictions separate when one could match two runs in the other source', () => {
    const merger = session();
    const result = merger.departures([
      observe(A, [departure({ arrivalTime: NOW + 100_000 }), departure({ arrivalTime: NOW + 160_000 })]),
      observe(B, [departure({ arrivalTime: NOW + 130_000 })]),
    ]);
    expect(result).toHaveLength(3);
    expect(result.every(item => item.agreement === 'single-source')).toBe(true);
  });
  it('checks ambiguity in both directions when only one side knows a run identity', () => {
    for (const reverse of [false, true]) {
      const known = [departure({ tripId: 'run1', arrivalTime: NOW + 100_000 }), departure({ tripId: 'run2', arrivalTime: NOW + 160_000 })];
      const unknown = [departure({ arrivalTime: NOW + 130_000 })];
      const result = session().departures(reverse ? [observe(A, unknown), observe(B, known)] : [observe(A, known), observe(B, unknown)]);
      expect(result).toHaveLength(3);
      expect(result.every(item => item.agreement === 'single-source')).toBe(true);
    }
  });
  it('can align a uniquely matchable unidentified report to a known run', () => {
    const result = session().departures([observe(A, [departure({ tripId: 'run' })]), observe(B, [departure({ arrivalTime: NOW + 110_000 })])]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ tripId: 'run', agreement: 'corroborated' });
  });
  it('does not use arrival agreement to corroborate conflicting departure-after-dwell times', () => {
    const result = session().departures([
      observe(A, [departure({ tripId: 'run', departureTime: NOW + 100_000 })]),
      observe(B, [departure({ tripId: 'run', departureTime: NOW + 900_000 })]),
    ]);
    expect(result.every(item => item.agreement !== 'corroborated')).toBe(true);
  });
  it('drops expired cached predictions and preserves arrival/departure when a bus is still dwelling', () => {
    const merger = session();
    expect(merger.departures([observe(B, [departure()], { cached: true, at: NOW - 120_001 })])).toEqual([]);
    expect(merger.departures([observe(B, [departure({ arrivalTime: NOW - 31_000 })])])).toEqual([]);
    const result = merger.departures([observe(B, [departure({ arrivalTime: NOW - 31_000, departureTime: NOW + 1000 })])]);
    expect(result[0]).toMatchObject({ arrivalTime: NOW - 31_000, departureTime: NOW + 1000, agreement: 'single-source' });
  });
  it('does not promote agreeing cached predictions into fresh quorum evidence', () => {
    const merger = session();
    const result = merger.departures([
      observe(A, [departure({ tripId: 'run' })]),
      observe(B, [departure({ tripId: 'run' })], { cached: true, at: NOW - 1000 }),
      observe(C, [departure({ tripId: 'run' })], { cached: true, at: NOW - 1000 }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].agreement).toBe('single-source');
    expect(result[0].sources?.filter(source => source.cached)).toHaveLength(2);
  });
});
