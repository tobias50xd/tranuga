import { describe, expect, it } from 'vitest';
import { ApiClient, discoverAgencies, findAgenciesByCode, infoEndpoints, locateAgencies, TransitService, UGA_AGENCY } from '../src/api';

/** Explicit opt-in only; deterministic CI never depends on external providers. */
describe.skipIf(process.env.LIVE_TRANSIT !== '1')('read-only provider smoke', () => {
  it('loads live UGA catalog, route, bus headings, stop ETAs and complete planning topology', async () => {
    const service = new TransitService(UGA_AGENCY, new ApiClient(fetch, '', 20000));
    const routes = await service.listRoutes(), active = routes.find(r => r.active);
    expect(active).toBeDefined();
    const route = await service.getRoute(active!.id);
    expect(route.stops.length).toBeGreaterThan(1);
    expect(route.patterns.every(p => p.stops.every(s => Number.isFinite(s.lat) && Number.isFinite(s.lon)))).toBe(true);
    expect(route.vehicles.every(v => v.heading >= 0 && v.heading < 360)).toBe(true);
    const stop = await service.getStop(route.stops[0].id);
    expect(stop.stop.id).toBe(route.stops[0].id);
    const network = await service.getNetwork();
    expect(network.patterns.length).toBeGreaterThan(1);
    expect(network.departures.length).toBeGreaterThan(1);
    expect(new Set(network.patterns.map(p => p.routeId)).size).toBe(routes.filter(r => r.active).length);
  }, 120000);
  it('discovers InfoPoint authorities and validates every InfoPoint call including geometry', async () => {
    const client = new ApiClient(fetch, '', 20000), authorities = await discoverAgencies(client);
    const cata = authorities.find(a => a.name === 'CATA'); expect(cata).toBeDefined();
    expect((await locateAgencies({lat:33.95,lon:-83.37},client)).length).toBeGreaterThan(0);
    expect((await findAgenciesByCode('CATA',client)).length).toBeGreaterThan(0);
    const service = new TransitService(cata!,client), routes = await service.listRoutes(), active = routes.find(r => r.active)!;
    const route = await service.getRoute(active.id); expect(route.stops.length).toBeGreaterThan(1); expect(route.patterns.some(p => p.shape.length > 1)).toBe(true);
    const stop = await service.getStop(route.stops[0].id); expect(stop.stop.id).toBe(route.stops[0].id);
    await service.getMessages();
    const e = infoEndpoints(cata!.restUrl!);
    const allDetails = await client.get(e.allDetails), allStops = await client.get(e.stops);
    expect(Array.isArray(allDetails)).toBe(true); expect(Array.isArray(allStops)).toBe(true);
    expect(client.calls.every(c => c.status === 'ok')).toBe(true);
  }, 120000);
});
