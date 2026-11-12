import { describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/api-contracts.json';
import routeKml from './fixtures/route51.kml?raw';
import { ApiClient, findAgenciesByCode, locateAgencies, TransitService, UGA_AGENCY, ugaEndpoints, infoEndpoints, discoverAgencies, discoveryEndpoints, kmlEndpoint } from '../src/api';
import { color, decodePolyline, infoDepartures, normalizeAgencies, normalizeRoutes, normalizeStops, normalizeVehicles, parseKml, timestamp, ugaDepartures } from '../src/api/normalize';
import { infoPatterns, ugaTopology, ugaTrackingPatterns } from '../src/api/topology';
import type { Agency } from '../src/types';

const agency: Agency = { id: '1', name: 'CATA', kind: 'infopoint', restUrl: 'https://realtime.catabus.com/InfoPoint/rest' };
const authority = { Id: 1, Name: 'CATA', RestUrl: agency.restUrl, Latitude: 40.76, Longitude: -77.87 };
function mockClient(responses: Record<string, unknown>) {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'https://tranuga.test').searchParams.get('url')!;
    if (!(url in responses)) return new Response('Unavailable', { status: 503 });
    const data = responses[url]; return new Response(typeof data === 'string' ? data : JSON.stringify(data), { status: 200, headers: { 'Content-Type': typeof data === 'string' ? 'application/xml' : 'application/json' } });
  });
  return { client: new ApiClient(fetcher as typeof fetch), fetcher };
}

describe('actual transit response contracts', () => {
  it('normalizes all listed routes, active state, colors and malicious color fallback', () => {
    const routes = normalizeRoutes(fixture.ugaRoutes, 'uga', 'uga');
    expect(routes).toHaveLength(2); expect(routes.find(r => r.id === '5750')).toMatchObject({ active: true, color: '#075cff' });
    expect(routes.find(r => r.id === '5741')?.active).toBe(false); expect(color('red;display:none')).toBe('#315b5c');
    expect(() => normalizeRoutes({ routes: [] }, 'uga', 'uga')).toThrow('unsupported format');
  });
  it('rejects invalid stop coordinates and retains stale vehicle timestamps for honest labeling', () => {
    expect(normalizeStops([{ id: 'bad', latitude: 200, longitude: 40 }, { id: 'missing' }])).toEqual([]);
    const vehicles = normalizeVehicles(fixture.ugaVehicles, 'uga', 1794523000000);
    expect(vehicles[0]).toMatchObject({ id: '17997', routeId: '5750', heading: 98, updatedAt: 1794522557003 });
    expect(normalizeVehicles([{ id: 'x', routeId: '1', latitude: 0, longitude: 0 }], 'uga')).toEqual([]);
    expect(normalizeVehicles([{ id: 'x', routeId: '1', latitude: 33, longitude: -83, heading: -10 }], 'uga')[0].heading).toBe(350);
  });
  it('uses epoch milliseconds and .NET offsets without shifting timezone twice', () => {
    expect(timestamp('/Date(1794522780000-0500)/')).toBe(1794522780000);
    expect(timestamp('2026-11-12T17:33:00')).toBeUndefined();
    expect(timestamp(1794522780)).toBe(1794522780000);
    expect(ugaDepartures(fixture.ugaStop)[0]).toMatchObject({ stopId: '155104', routeId: '5750', direction: '0', arrivalTime: 1794522625003 });
    expect(infoDepartures(fixture.infoDepartures)[0]).toMatchObject({ stopId: '1', routeId: '71', direction: 'NB', tripId: '1722', arrivalTime: 1794522684000, scheduled: false });
    expect(infoDepartures(fixture.infoDepartures)[0].departureTime).toBe(1794522780000);
  });
  it('preserves current UGA ordered stops and confirms loop from static sequence', () => {
    const topology = ugaTopology(fixture.ugaStatic);
    const patterns = ugaTrackingPatterns(fixture.ugaTracking, '5750', topology);
    expect(patterns[0].stops).toHaveLength(19); expect(patterns[0].stops[0].id).toBe('155093'); expect(patterns[0].stops.at(-1)?.id).toBe('155133'); expect(patterns[0].loop).toBe(true);
    expect(patterns[0].shape.length).toBeGreaterThan(100);
  });
  it('sorts InfoPoint RouteStops per direction rather than raw Stops order', () => {
    const patterns = infoPatterns(fixture.infoDetail);
    expect(patterns.map(p => p.direction)).toEqual(['EB', 'WB']);
    expect(patterns[0].stops.map(s => s.id)).toEqual(['873','874','4','51','148','149','287','569']);
    expect(patterns[1].stops.map(s => s.id)).toEqual(['569','355','154','155','356','357','572','873']);
    expect(patterns.every(p => p.loop === false)).toBe(true);
  });
  it('decodes polyline and KML LineString without point placemarks', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([{lat:38.5,lon:-120.2},{lat:40.7,lon:-120.95},{lat:43.252,lon:-126.453}]);
    expect(() => decodePolyline('~')).toThrow();
    expect(parseKml(routeKml)).toHaveLength(78);
    expect(parseKml('<kml><Point><coordinates>0,0</coordinates></Point><LineString><coordinates>-83,33,0 -84,34,0</coordinates></LineString></kml>')).toEqual([{lat:33,lon:-83},{lat:34,lon:-84}]);
    expect(() => kmlEndpoint(fixture.infoConfig, '../secret')).toThrow();
  });
  it('normalizes single locate responses and filters broken agencies', () => {
    expect(normalizeAgencies(authority)[0]).toMatchObject({ id: '1', name: 'CATA', restUrl: agency.restUrl });
    expect(normalizeAgencies([{ Id: 2, RestUrl: 'javascript:alert(1)' }])).toEqual([]);
  });
});

describe('transport reliability', () => {
  it('uses credential-free same-origin requests, coalesces and caches reads', async () => {
    const {client,fetcher} = mockClient({ [ugaEndpoints.routes]: fixture.ugaRoutes });
    await Promise.all([client.get(ugaEndpoints.routes), client.get(ugaEndpoints.routes)]); await client.get(ugaEndpoints.routes);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][0]).toBe(`/api?url=${encodeURIComponent(ugaEndpoints.routes)}`);
    expect(client.calls[0].status).toBe('ok'); client.clear(); await client.get(ugaEndpoints.routes); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('reports HTTP, invalid JSON and timeout errors instead of returning fake buses', async () => {
    const http = new ApiClient(vi.fn(async () => new Response('', {status:503})) as typeof fetch); await expect(http.get('https://x.test')).rejects.toThrow('503');
    const json = new ApiClient(vi.fn(async () => new Response('{')) as typeof fetch); await expect(json.get('https://x.test')).rejects.toThrow('invalid JSON');
    const abort = new ApiClient((async (_url:unknown, init:RequestInit) => new Promise((_resolve,reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch, '/api', 1);
    await expect(abort.get('https://x.test')).rejects.toThrow('timed out'); expect(abort.calls[0].status).toBe('error');
  });
});

describe('complete API workflows', () => {
  it('uses all six UGA APIs for catalog, current route map, stop ETA and planning', async () => {
    const {client} = mockClient({[ugaEndpoints.routes]:fixture.ugaRoutes,[ugaEndpoints.buses]:fixture.ugaVehicles,[ugaEndpoints.version]:{version:1086},[ugaEndpoints.data]:fixture.ugaStatic,[ugaEndpoints.tracking('5750')]:fixture.ugaTracking,[ugaEndpoints.stop('155104')]:fixture.ugaStop});
    const service = new TransitService(UGA_AGENCY,client); const routes = await service.listRoutes(); const route = await service.getRoute('5750'); const stop = await service.getStop('155104'); const network = await service.getNetwork();
    expect(routes).toHaveLength(2); expect(route.stops).toHaveLength(19); expect(route.vehicles).toHaveLength(1); expect(stop.departures.length).toBeGreaterThan(1); expect(network.patterns).toHaveLength(1);
    expect(new Set(client.calls.map(c => c.url)).size).toBe(6);
  });
  it('excludes route from planning when current stops fail while route map labels static fallback', async () => {
    const {client} = mockClient({[ugaEndpoints.routes]:fixture.ugaRoutes,[ugaEndpoints.buses]:fixture.ugaVehicles,[ugaEndpoints.version]:{version:1086},[ugaEndpoints.data]:fixture.ugaStatic});
    const service = new TransitService(UGA_AGENCY,client), detail = await service.getRoute('5750'), network = await service.getNetwork();
    expect(detail.stops.length).toBeGreaterThan(1); expect(detail.warnings.join(' ')).toContain('Showing static stops');
    expect(network.patterns).toEqual([]); expect(network.warnings.join(' ')).toContain('excluded from planning');
  });
  it('continues to show live stops when static dataset is unavailable and warns about missing trace', async () => {
    const {client} = mockClient({[ugaEndpoints.routes]:fixture.ugaRoutes,[ugaEndpoints.buses]:fixture.ugaVehicles,[ugaEndpoints.tracking('5750')]:fixture.ugaTracking});
    const detail = await new TransitService(UGA_AGENCY,client).getRoute('5750');
    expect(detail.stops).toHaveLength(19); expect(detail.patterns[0].shape).toEqual([]); expect(detail.warnings.join(' ')).toContain('Static topology unavailable');
    expect(detail.warnings.join(' ')).toContain('connectors are approximate');
  });
  it('uses all discovery selectors, twelve InfoPoint endpoints and KML in real workflows', async () => {
    const e=infoEndpoints(agency.restUrl!), stop=fixture.infoStop;
    const responses: Record<string,unknown> = {
      [discoveryEndpoints.all]:[authority],[discoveryEndpoints.locate({lat:40,lon:-77})]:authority,[discoveryEndpoints.code('CATA')]:[authority],
      [e.config]:fixture.infoConfig,[e.routes]:[fixture.infoDetail],[e.visibleRoutes]:[fixture.infoDetail],[e.route('51')]:fixture.infoDetail,[e.allDetails]:[fixture.infoDetail],[e.directions('51')]:fixture.infoDirections,
      [e.directionStops('51','EB')]:fixture.infoDirectionStops,[e.directionStops('51','WB')]:fixture.infoDetail.Stops,[e.stops]:fixture.infoDetail.Stops,[e.routeStops(['51'])]:fixture.infoDetail.Stops,[e.stop('1')]:stop,[e.departures('1')]:fixture.infoDepartures,[e.messages]:fixture.infoMessages,
      [kmlEndpoint(fixture.infoConfig,'Route51.kml')]:'<kml><LineString><coordinates>-77.87,40.79 -77.85,40.81</coordinates></LineString></kml>',
    };
    fixture.infoDetail.Stops.forEach(s => {responses[e.departures(String(s.StopId))]=[];});
    const {client}=mockClient(responses);
    expect(await discoverAgencies(client)).toHaveLength(1); expect(await locateAgencies({lat:40,lon:-77},client)).toHaveLength(1); expect(await findAgenciesByCode('CATA',client)).toHaveLength(1);
    const service=new TransitService(agency,client); await service.listRoutes(); const detail=await service.getRoute('51'); const single=await service.getStop('1'); const network=await service.getNetwork();
    expect(detail.patterns).toHaveLength(2); expect(detail.patterns[0].shape).toHaveLength(2); expect(single.stop.id).toBe('1'); expect(network.patterns).toHaveLength(2); expect(network.messages).toEqual(['Service notice']);
    Object.keys(responses).forEach(url=>expect(client.calls.some(c=>c.url===url),url).toBe(true));
  });
});
