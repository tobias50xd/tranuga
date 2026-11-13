import { describe, expect, it } from 'vitest';
import crosswalk from '../src/data/athens-crosswalk.json';
import { ugaDepartures } from '../src/api/normalize';
import { ugaTrackingPatterns } from '../src/api/topology';

interface Alias { id: string; operator: string; sources: Partial<Record<'uga' | 'infopoint' | 'passio', string>> }
interface Direction extends Pick<Alias, 'id' | 'sources'> { topologyAgreement: string; ugaStopIds: string[]; infoPointStopIds?: string[]; passioStopIds?: string[] }
const routes = crosswalk.routes as (Alias & { name: string; passioVariants?: string[]; directions: Direction[] })[];
const stops = crosswalk.stops as (Alias & { name: string; lat: number; lon: number })[];
const vehicles = crosswalk.vehicles as (Alias & { fleetName: string })[];

describe('reviewed Georgia identity crosswalk', () => {
  it('keeps UGA campus, Athens Georgia and Athens Ohio distinct', () => {
    expect(crosswalk.independentSources).toBe(false);
    expect(routes).toHaveLength(35);
    expect(routes.filter(route => route.operator === 'uga-campus')).toHaveLength(17);
    expect(routes.filter(route => route.operator === 'athens-ga')).toHaveLength(18);
    expect(routes.every(route => route.sources.uga === route.id)).toBe(true);
    expect(routes.every(route => route.sources.passio ? !route.sources.infopoint : !!route.sources.infopoint)).toBe(true);
    // Equal names do not equate operators: these Riverbend routes serve different networks.
    expect(routes.find(route => route.id === '6747')?.sources).toEqual({ uga: '6747', passio: '6747' });
    expect(routes.find(route => route.id === '1012')?.sources).toEqual({ uga: '1012', infopoint: '12' });
    expect(stops.every(stop => stop.lat > 33.8 && stop.lat < 34.2 && stop.lon > -83.6 && stop.lon < -83.1)).toBe(true);
    expect(routes.some(route => route.sources.passio === '5842')).toBe(false);
  });
  it('uses one-to-one reviewed source identities rather than numeric/name heuristics', () => {
    for (const aliases of [routes, stops, vehicles]) {
      expect(new Set(aliases.map(alias => alias.id)).size).toBe(aliases.length);
      for (const source of ['uga', 'infopoint', 'passio'] as const) {
        const ids = aliases.flatMap(alias => alias.sources[source] ? [alias.sources[source]] : []);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
    expect(routes.find(route => route.sources.infopoint === '999')).toBeUndefined();
    expect(routes.find(route => route.sources.uga === '1999')).toBeUndefined();
    expect(stops.find(stop => stop.sources.infopoint === '999999')).toBeUndefined();
    expect(vehicles.find(vehicle => vehicle.sources.passio === '999999')).toBeUndefined();
  });
  it('preserves only the current observed stop identities and explicit source coordinate agreement', () => {
    expect(stops).toHaveLength(608);
    expect(stops.filter(stop => stop.operator === 'athens-ga')).toHaveLength(494);
    expect(stops.filter(stop => stop.operator === 'uga-campus')).toHaveLength(114);
    for (const stop of stops) {
      expect(stop.name).not.toBe('');
      expect(stop.sources.uga).toBe(stop.id);
      if (stop.operator === 'athens-ga') {
        expect(stop.id).toBe(`c${stop.sources.infopoint}`);
        expect(stop.sources.passio).toBeUndefined();
      } else {
        expect(stop.sources.passio).toBe(stop.id);
        expect(stop.sources.infopoint).toBeUndefined();
      }
    }
    // The static dataset has a longitude typo for c243; the live shared coordinate is retained.
    expect(stops.find(stop => stop.id === 'c243')).toMatchObject({ lat: 33.945346, lon: -83.371062 });
  });
  it('maps city direction by actual ordered topology rather than the misleading direction name', () => {
    for (const route of routes.filter(route => route.operator === 'athens-ga')) {
      expect(route.directions.map(direction => direction.id).sort()).toEqual(['0', '1']);
      expect(route.directions.find(direction => direction.id === '1')?.sources.infopoint).toBe('O');
      expect(route.directions.find(direction => direction.id === '0')?.sources.infopoint).toBe('I');
    }
    const directions = routes.flatMap(route => route.directions);
    expect(directions.filter(direction => direction.topologyAgreement === 'exact')).toHaveLength(49);
    expect(directions.filter(direction => direction.topologyAgreement === 'conflict')).toHaveLength(4);
    for (const direction of directions) {
      const peer = direction.infoPointStopIds ?? direction.passioStopIds;
      if (direction.topologyAgreement === 'exact') {
        expect(direction.ugaStopIds).toEqual(peer);
        expect(direction.ugaStopIds.length).toBeGreaterThan(1);
        expect(direction.ugaStopIds.every(id => stops.some(stop => stop.id === id))).toBe(true);
      } else expect(direction.ugaStopIds).not.toEqual(peer);
    }
  });
  it('preserves additional campus variants without falsely corroborating their stop order', () => {
    expect(routes.find(route => route.id === '5739')?.passioVariants).toEqual(['64252', '74415']);
    expect(routes.find(route => route.id === '5746')?.passioVariants).toEqual(['73969', '73970']);
    expect(routes.find(route => route.id === '5750')?.directions[0]).toMatchObject({ id: '0', sources: { uga: '0', passio: '44886' } });
    expect(routes.find(route => route.id === '5739')?.directions.some(direction => direction.sources.passio === '74415')).toBe(false);
    expect(routes.find(route => route.id === '5746')?.directions.some(direction => direction.sources.passio === '73970')).toBe(false);
  });
  it('records fleet identities separately from route assignments and device IDs', () => {
    expect(vehicles).toHaveLength(19);
    expect(vehicles.find(vehicle => vehicle.id === '14247')).toEqual({ id: '14247', operator: 'uga-campus', sources: { uga: '14247', passio: '14247' }, fleetName: '95129' });
    expect(vehicles.find(vehicle => vehicle.id === '122')).toEqual({ id: '122', operator: 'athens-ga', sources: { uga: '122', infopoint: '122' }, fleetName: '122' });
    expect(vehicles.find(vehicle => vehicle.id === '430126')).toBeUndefined();
    expect(vehicles.find(vehicle => vehicle.id === '95129')).toBeUndefined();
  });
  it('retains primary-source hashes and a bounded, dated evidence snapshot', () => {
    expect(Date.parse(crosswalk.observedAt)).not.toBeNaN();
    expect(crosswalk.evidence.length).toBe(44);
    expect(crosswalk.evidence.every(source => /^[a-f0-9]{64}$/.test(source.sha256))).toBe(true);
    expect(crosswalk.evidence.filter(source => source.id.startsWith('uga-tracking-'))).toHaveLength(35);
  });
});

describe('UGA Athens directionId schema regression', () => {
  const a = { id: 'c1', name: 'Multimodal Transportation Center', latitude: 33.959988, longitude: -83.370437 };
  const b = { id: 'c9', name: 'North Avenue Terminus', latitude: 33.99, longitude: -83.34 };
  const input = [
    { stop: a, stopId: 'c1', routeId: 1001, directionId: '1', directionName: 'Inbound', stopSequence: 0, times: [1_800_000_100_000] },
    { stop: b, stopId: 'c9', routeId: 1001, directionId: '1', directionName: 'Inbound', stopSequence: 1, times: [1_800_000_200_000] },
    { stop: b, stopId: 'c9', routeId: 1001, directionId: '0', directionName: 'Outbound', stopSequence: 0, times: [1_800_000_300_000] },
    { stop: a, stopId: 'c1', routeId: 1001, directionId: '0', directionName: 'Outbound', stopSequence: 1, times: [1_800_000_400_000] },
  ];
  it('keeps both current direction stop orders separate instead of interleaving them', () => {
    const patterns = ugaTrackingPatterns(input, '1001', { stops: [], patterns: [], shapes: new Map() });
    expect(patterns).toHaveLength(2);
    expect(patterns.find(pattern => pattern.direction === '1')?.stops.map(stop => stop.id)).toEqual(['c1', 'c9']);
    expect(patterns.find(pattern => pattern.direction === '0')?.stops.map(stop => stop.id)).toEqual(['c9', 'c1']);
    expect(patterns.every(pattern => !pattern.loop)).toBe(true);
  });
  it('keeps prediction direction in the same raw namespace as the route topology', () => {
    expect(ugaDepartures(input).map(departure => departure.direction)).toEqual(['1', '1', '0', '0']);
    // stop_{id} still supplies numeric direction, including the valid numeric zero.
    expect(ugaDepartures([{ ...input[0], direction: 0 }])[0].direction).toBe('0');
  });
});
