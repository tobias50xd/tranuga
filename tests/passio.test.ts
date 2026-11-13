import { describe, expect, it, vi } from 'vitest';
import ohio from './fixtures/passio-ohio.json';
import uga from './fixtures/passio-uga.json';
import extras from './fixtures/passio-extras.json';
import { ApiClient } from '../src/api/client';
import { normalizePassioComparison, normalizePassioDepartures, normalizePassioMessages, normalizePassioRoutes, normalizePassioTopology, normalizePassioVehicles, passioLocalTimestamp, PASSIO_ATHENS_AGENCY, PASSIO_UGA_AGENCY, PassioService } from '../src/api/passio';
import { passioEndpoints, PASSIO_ORIGINS } from '../src/api/passio-endpoints';

const source = (agencyId: string) => agencyId === '3994' ? uga : ohio;
function mockClient(origin = PASSIO_ORIGINS[0] as string, agencyId = '5842', fail: string[] = []) {
  const fixture = source(agencyId), endpoints = passioEndpoints(origin, agencyId);
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const target = new URL(String(input), 'https://tranuga.test').searchParams.get('url')!;
    if (fail.some(part => target.includes(part))) return new Response('Unavailable', { status: 503 });
    let data: unknown;
    if (target === endpoints.routes) data = fixture.catalog;
    if (target === endpoints.topology) data = fixture.topology;
    if (target === endpoints.buses) data = fixture.buses;
    if (target === endpoints.messages) data = fixture.messages;
    if (target === endpoints.systems) data = extras.systems;
    if (target === endpoints.version) data = extras.version;
    if (target === endpoints.routeGroups) data = extras.groups;
    if (target.includes('getBuses=2&search=')) data = extras.search;
    if (target.includes('schedule=4&')) data = extras.timetable;
    if (target === endpoints.compare) data = extras.comparison;
    if (target.startsWith(`${origin}/mapGetData.php?eta=3&`)) {
      const ids = new URL(target).searchParams.get('stopIds')!.split(',');
      data = { ...fixture.eta, ETAs: Object.fromEntries(Object.entries(fixture.eta.ETAs).filter(([id]) => ids.includes(id))) };
    }
    if (data === undefined) return new Response('Unavailable', { status: 404 });
    if ([endpoints.routes,endpoints.topology,endpoints.buses,endpoints.messages,endpoints.routeGroups,endpoints.compare].includes(target) || target.includes('getBuses=2&search=')) expect(init?.method).toBe('POST');
    return Response.json(data);
  });
  return { client: new ApiClient(fetcher as typeof fetch), fetcher, endpoints };
}

describe('Passio endpoints and real contracts', () => {
  it('limits mirrors/agencies and encodes bounded stop batches', () => {
    expect(PASSIO_ORIGINS).toHaveLength(3);
    for (const origin of PASSIO_ORIGINS) expect(passioEndpoints(origin, '3994').routePayload).toEqual({ systemSelected0: '3994', amount: 1 });
    expect(() => passioEndpoints('https://untrusted.example')).toThrow('Unapproved');
    expect(() => passioEndpoints(PASSIO_ORIGINS[0], '12')).toThrow('Unapproved');
    expect(passioEndpoints().eta(['190923','190985'])).toContain('stopIds=190923%2C190985&userId=5842');
    expect(() => passioEndpoints().eta([])).toThrow(); expect(() => passioEndpoints().eta(Array(41).fill('1'))).toThrow(); expect(() => passioEndpoints().eta(['1&userId=5'])).toThrow();
  });
  it('keeps Ohio separate and uses myid rather than representative stop id', () => {
    const routes = normalizePassioRoutes(ohio.catalog, '5842');
    expect(routes.map(route => route.id)).toEqual(['66949','66950','63701']);
    expect(routes[0]).toMatchObject({ shortName:'3', color:'#bd9e39', active:true, agencyId:'5842', availability:'published' });
    expect(PASSIO_ATHENS_AGENCY.center!.lat).toBeGreaterThan(39); expect(PASSIO_UGA_AGENCY.center!.lat).toBeLessThan(34);
  });
  it('uses proven UGA group route identities while preserving variants', () => {
    const routes = normalizePassioRoutes(uga.catalog, '3994'), topology = normalizePassioTopology(uga.topology, '3994');
    expect(routes.map(route => route.id).sort()).toEqual(['5746','5750']);
    const variants = topology.patterns.filter(pattern => pattern.routeId === '5746');
    expect(variants.map(pattern => pattern.direction).sort()).toEqual(['73969','73970']);
    expect(variants[0].stops.map(stop => stop.id)).not.toEqual(variants[1].stops.map(stop => stop.id));
    expect(topology.patterns.find(pattern => pattern.routeId === '5750')?.direction).toBe('44886');
    expect(normalizePassioRoutes([{myid:'999',groupId:'0',userId:'3994',name:'Ungrouped'}],'3994')[0].id).toBe('999');
    expect(normalizePassioRoutes([{myid:'999',groupId:'',userId:'3994',name:'Ungrouped'}],'3994')[0].id).toBe('999');
  });
  it('retains ordered return visits and closes only explicitly repeated terminal', () => {
    const topology = normalizePassioTopology(ohio.topology, '5842'), loop = topology.patterns.find(p => p.routeId === '66949')!;
    expect(loop.loop).toBe(true); expect(loop.stops).toHaveLength(44); expect(loop.stops[0].id).toBe('190923');
    expect(loop.stops.filter(stop => stop.id === '190994').length).toBeGreaterThan(1);
    expect(topology.patterns.find(p => p.routeId === '66950')?.loop).toBeUndefined();
    expect(loop.shape).toHaveLength(997);
  });
  it('preserves separate road segments without connecting gaps', () => {
    const raw = structuredClone(ohio.topology) as Record<string, any>;
    raw.routePoints['66949'] = [[{lat:39, lng:-82},{lat:39.01,lng:-82.01}],[{lat:39.1,lng:-82.1},{lat:39.11,lng:-82.11}]];
    const pattern = normalizePassioTopology(raw, '5842').patterns.find(p => p.routeId === '66949')!;
    expect(pattern.shape).toEqual([]); expect(pattern.shapeSegments).toHaveLength(2); expect(pattern.shapeSegments?.map(p => p.length)).toEqual([2,2]);
  });
  it('excludes malformed topology instead of joining across a missing stop', () => {
    const raw = structuredClone(ohio.topology) as Record<string, any>; delete raw.stops.ID190923;
    expect(normalizePassioTopology(raw, '5842').patterns.some(p => p.routeId === '66949')).toBe(false);
    expect(() => normalizePassioTopology({ routes: [], stops: [] }, '5842')).toThrow('unsupported');
    expect(() => normalizePassioRoutes({ error:'unavailable' }, '5842')).toThrow();
  });
  it('normalizes headings and bus IDs but does not invent absolute GPS update times', () => {
    const vehicles = normalizePassioVehicles(ohio.buses, '5842');
    expect(vehicles).toHaveLength(3); expect(vehicles[0]).toMatchObject({ id:'19156', routeId:'66949', tripId:'989397', active:true });
    expect(vehicles.every(vehicle => vehicle.heading >= 0 && vehicle.heading < 360)).toBe(true);
    expect(vehicles.every(vehicle => vehicle.updatedAt === undefined)).toBe(true);
    const raw = structuredClone(ohio.buses) as Record<string, any>; raw.buses['449441'][0].outOfService = 1;
    expect(normalizePassioVehicles(raw, '5842')).toHaveLength(2);
    expect(normalizePassioVehicles(ohio.buses, '3994')).toEqual([]);
  });
  it('keeps one point per bus and prefers a current point over an outdated duplicate', () => {
    const source = structuredClone(ohio.buses.buses['449441'][0]);
    const raw = { buses: {
      stale: [{ ...source, deviceId:1, latitude:'39.1', longitude:'-82.1', outdated:1 }],
      current: [{ ...source, deviceId:2, latitude:'39.2', longitude:'-82.2', outdated:0 }],
    } };
    expect(normalizePassioVehicles(raw, '5842')).toEqual([
      expect.objectContaining({ id:'19156', lat:39.2, lon:-82.2, active:true }),
    ]);
    delete raw.buses.current;
    expect(normalizePassioVehicles(raw, '5842')).toEqual([
      expect.objectContaining({ id:'19156', lat:39.1, lon:-82.1, active:false }),
    ]);
  });
  it('converts ETA epoch seconds, keeps run identity and maps UGA group/direction explicitly', () => {
    const raw = normalizePassioDepartures(ohio.eta), group = normalizePassioDepartures(uga.eta, '3994');
    expect(raw[0]).toMatchObject({ stopId:'190923', routeId:'66949', direction:'66949', vehicleId:'19156', tripId:'989397', arrivalTime:1794534304000 });
    expect(group[0]).toMatchObject({ stopId:'155093', routeId:'5750', direction:'44886', vehicleId:'15228', tripId:'611290', arrivalTime:1794533883000 });
    expect(raw.every(departure => departure.arrivalTime > 1e12)).toBe(true);
  });
  it('preserves UTC prediction update time and does not treat a scheduled departure as live dwell', () => {
    const solid = { ETAs:{'190923':[{solid:1,solidEta:{stopId:'190923',routeId:'66949',busId:'19156',tripId:'989398',arrivalUtc:'2026-11-13 01:47:00',updatedUtc:'2026-11-13 01:32:00',scheduledDepartureUtc:'2026-11-13 01:48:00'}}]} };
    const departure = normalizePassioDepartures(solid)[0];
    expect(departure.arrivalTime).toBe(Date.parse('2026-11-13T01:47:00Z')); expect(departure.departureTime).toBeUndefined();
    expect(departure.updatedAt).toBe(Date.parse('2026-11-13T01:32:00Z'));
    expect(normalizePassioDepartures({ETAs:{'1':[{routeId:'2',arrivalTimestamp:1794534304,updatedUtc:'2026-11-13 01:30:00'}]}})[0].updatedAt).toBe(Date.parse('2026-11-13T01:30:00Z'));
    expect(normalizePassioDepartures(ohio.eta)[0].updatedAt).toBeUndefined();
    expect(normalizePassioDepartures({ ETAs:{'1':[{routeId:'2',eta:'5min',secondsSpent:300,created:'2026-11-12 20:00:00'}]} })).toEqual([]);
  });
  it('converts complete created dates only with explicit catalog timezone and round-trip proof', () => {
    const zones=new Map(uga.catalog.map(row=>[row.myid,row.timezone]));
    const departure=normalizePassioDepartures(uga.eta,'3994',new Map(),zones)[0];
    expect(departure.updatedAt).toBe(Date.parse('2026-11-13T01:38:00Z'));
    for (const proof of extras.timestampEvidence) {
      expect(proof.portalTripId).toBe(proof.passioTripId);
      expect(passioLocalTimestamp(proof.passioCreated,proof.timezone)).toBe(proof.passioCreatedEpoch);
      expect(Math.abs(proof.passioCreatedEpoch-proof.portalLastUpdate)).toBeLessThan(3000);
    }
    const explicit={ETAs:{'1':[{routeId:'44886',arrivalTimestamp:1794534304,created:'2026-11-12 20:00:00',updatedUtc:'2026-11-13 01:30:00'}]}};
    expect(normalizePassioDepartures(explicit,'3994',new Map(),zones)[0].updatedAt).toBe(Date.parse('2026-11-13T01:30:00Z'));
    expect(passioLocalTimestamp('2026-11-12 20:00:00',undefined)).toBeUndefined();
    expect(passioLocalTimestamp('08:32 PM','America/New_York')).toBeUndefined();
  });
  it('rejects ambiguous fall-back times, missing spring-forward times and invalid local dates', () => {
    expect(passioLocalTimestamp('2026-11-01 01:30:00','America/New_York')).toBeUndefined();
    expect(passioLocalTimestamp('2026-03-08 02:30:00','America/New_York')).toBeUndefined();
    expect(passioLocalTimestamp('2026-06-12 12:00:00','America/New_York')).toBe(Date.parse('2026-06-12T16:00:00Z'));
    expect(passioLocalTimestamp('2026-11-12 12:00:00','America/New_York')).toBe(Date.parse('2026-11-12T17:00:00Z'));
    expect(passioLocalTimestamp('2026-02-30 12:00:00','America/New_York')).toBeUndefined();
    expect(passioLocalTimestamp('2026-11-12 24:00:00','America/New_York')).toBeUndefined();
    expect(passioLocalTimestamp('2026-11-12 12:00:00','Invalid/Zone')).toBeUndefined();
  });
  it('ignores unavailable predictions and archived/out-of-range messages', () => {
    expect(normalizePassioDepartures({ETAs:{'1':[{routeId:'2',arrivalTimestamp:1794534304,OOS:1}]}})).toEqual([]);
    expect(normalizePassioMessages(ohio.messages,'5842')[0]).toContain('Carpenter');
    expect(normalizePassioMessages({msgs:[{userId:'5842',archive:'1',name:'old'},{userId:'5842',toOk:'0',name:'expired'},{userId:'3994',name:'other'}]},'5842')).toEqual([]);
    expect(() => normalizePassioMessages({error:'No access'},'5842')).toThrow('No access');
  });
});

describe('Passio service workflows', () => {
  it.each(PASSIO_ORIGINS)('uses all five read queries on %s for catalog/map/stop/planning', async origin => {
    const {client,fetcher,endpoints}=mockClient(origin), service=new PassioService(PASSIO_ATHENS_AGENCY,client,origin);
    await service.listRoutes(); const detail=await service.getRoute('66949'), stop=await service.getStop('190923'), network=await service.getNetwork();
    expect(detail.stops.length).toBeGreaterThan(20); expect(detail.vehicles).toHaveLength(1); expect(stop.departures.length).toBeGreaterThan(0); expect(network.patterns).toHaveLength(3);
    expect(detail.warnings.join(' ')).toContain('freshness is unknown');
    for (const url of [endpoints.routes,endpoints.topology,endpoints.buses,endpoints.messages]) expect(client.calls.some(call=>call.url===url)).toBe(true);
    expect(client.calls.some(call=>call.url.includes('eta=3'))).toBe(true);
    const firstPost=fetcher.mock.calls.find(([,init])=>init?.method==='POST')!;
    expect(JSON.parse(String(firstPost[1]?.body))).toEqual(endpoints.routePayload); expect(firstPost[1]?.credentials).toBe('omit');
    expect(fetcher.mock.calls.every(([url])=>String(url).startsWith('/api?url='))).toBe(true);
  });
  it('maps UGA vehicles and predictions to group catalog without collapsing variant patterns', async () => {
    const {client}=mockClient(PASSIO_ORIGINS[0],'3994'), service=new PassioService(PASSIO_UGA_AGENCY,client);
    const detail=await service.getRoute('5750'); expect(detail.patterns[0].direction).toBe('44886'); expect(detail.departures.some(d=>d.routeId==='5750')).toBe(true);
    const variants=await service.getRoute('5746'); expect(variants.patterns).toHaveLength(2);
    const stop=await service.getStop('155093'); expect(stop.departures[0]).toMatchObject({routeId:'5750',direction:'44886'});
  });
  it('keeps route geometry/stops visible with explicit warnings when vehicles/ETA/messages fail', async () => {
    const {client}=mockClient(PASSIO_ORIGINS[0],'5842',['getBuses','eta=3','getAlertMessages']);
    const detail=await new PassioService(PASSIO_ATHENS_AGENCY,client).getRoute('66949');
    expect(detail.stops).toHaveLength(36); expect(detail.patterns[0].stops).toHaveLength(44); expect(detail.vehicles).toEqual([]); expect(detail.departures).toEqual([]); expect(detail.warnings.join(' ')).toContain('predictions unavailable');
  });
  it('labels missing road trace and rejects unknown stops/routes', async () => {
    const {client}=mockClient(),service=new PassioService(PASSIO_ATHENS_AGENCY,client);
    expect((await service.getRoute('63701')).warnings.join(' ')).toContain('connectors are approximate');
    await expect(service.getRoute('999')).rejects.toThrow('absent'); await expect(service.getStop('999')).rejects.toThrow('absent');
  });
});

describe('additional Passio read features', () => {
  it('loads selected agency metadata, website version and actual grouped routes through three queries', async () => {
    const {client,endpoints}=mockClient(), info=await new PassioService(PASSIO_ATHENS_AGENCY,client).getSystemInfo();
    expect(info).toMatchObject({id:'5842',name:'Athens Public Transit',version:'110'}); expect(info.routeGroups.length).toBeGreaterThan(0); expect(info.routeGroups.find(group=>group.id==='7493')).toMatchObject({variantId:'66949',stopCount:45});
    expect(client.calls.map(call=>call.url).sort()).toEqual([endpoints.systems,endpoints.version,endpoints.routeGroups].sort());
    expect(JSON.stringify(info)).not.toMatch(/@|IPcoords|author/);
  });
  it('returns only the explicitly found bus rather than every reported vehicle', async () => {
    const {client}=mockClient(), vehicles=await new PassioService(PASSIO_ATHENS_AGENCY,client).searchBuses(' 2100 ');
    expect(vehicles.map(vehicle=>vehicle.id)).toEqual(['19156']);
    expect(client.calls[0].url).toContain('getBuses=2&search=2100');
    await expect(new PassioService(PASSIO_ATHENS_AGENCY,client).searchBuses("' OR 1=1")).rejects.toThrow('Enter a bus');
    await expect(new PassioService(PASSIO_ATHENS_AGENCY,client).searchBuses(' ')).rejects.toThrow('Enter a bus');
  });
  it('returns an empty bus search when the provider has no explicit found vehicle', async () => {
    const client=new ApiClient(vi.fn(async()=>Response.json({search:{foundLocation:false},buses:{}})) as typeof fetch);
    expect(await new PassioService(PASSIO_ATHENS_AGENCY,client).searchBuses('999999')).toEqual([]);
  });
  it('selects the actual route variant serving the stop and preserves timetable clock labels/timezone', async () => {
    const {client}=mockClient(), timetable=await new PassioService(PASSIO_ATHENS_AGENCY,client).getTimetable('190923','66949');
    expect(timetable).toEqual({routeId:'66949',variantId:'66949',stopId:'190923',times:['8:48 PM','9:48 PM'],timezone:'America/New_York'});
    expect(client.calls.some(call=>call.url.includes('schedule=4&routeId=66949&stopId=190923'))).toBe(true);
    await expect(new PassioService(PASSIO_ATHENS_AGENCY,client).getTimetable('99999')).rejects.toThrow('No ordered');
  });
  it('compares only bus-and-walk alternatives, preserving source durations and missing route identity', () => {
    const compared=normalizePassioComparison(extras.comparison,'5842'); expect(compared.routes).toHaveLength(1);
    expect(compared.routes[0]).toMatchObject({durationSeconds:360,transfers:0,legs:[{mode:'ride',fromStopId:'190923',toStopId:'190985',durationSeconds:360}]});
    expect(compared.routes[0].legs[0].routeId).toBeUndefined();
    expect(normalizePassioComparison({bestPath:{routes:[{legs:[{steps:[{travel_mode:'TRANSIT',duration:{text:'5min'}}]}]}]}},'5842').routes[0].durationSeconds).toBeUndefined();
    expect(normalizePassioComparison({bestPath:{routes:[{legs:[{steps:[{travel_mode:'DRIVING',duration:{value:10}}]}]}]}},'5842').routes).toEqual([]);
  });
  it('sends operator comparison only on explicit invocation and does not cache or log coordinates', async () => {
    const {client,fetcher}=mockClient(), service=new PassioService(PASSIO_ATHENS_AGENCY,client), from={lat:39.295665,lon:-82.11205},to={lat:39.325428,lon:-82.101967};
    const first=await service.compareJourney(from,to); await service.compareJourney(from,to);
    expect(first.routes).toHaveLength(1); expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({systems:{systemSelected0:'5842',amount:1},routes:{amount:0},points:[{lat:from.lat,lng:from.lon},{lat:to.lat,lng:to.lon}],mode:'transit'});
    expect(JSON.stringify(client.calls)).not.toContain(String(from.lat));
    await expect(service.compareJourney({lat:91,lon:0},to)).rejects.toThrow('valid coordinates');
  });
});

describe.skipIf(process.env.LIVE_PASSIO !== '1')('read-only Passio mirror smoke (explicit opt-in)', () => {
  for (const origin of PASSIO_ORIGINS) {
    it.each([PASSIO_ATHENS_AGENCY, PASSIO_UGA_AGENCY])(`${origin} agency $id normalizes complete live workflows`, async agency => {
      const client = new ApiClient(fetch, '', 20000), service = new PassioService(agency,client,origin);
      const routes = await service.listRoutes(), active = routes.find(route=>route.active)!;
      expect(active).toBeDefined();
      const detail = await service.getRoute(active.id); expect(detail.patterns.length).toBeGreaterThan(0); expect(detail.stops.length).toBeGreaterThan(1);
      const stop = await service.getStop(detail.stops[0].id); expect(stop.stop.id).toBe(detail.stops[0].id);
      const network = await service.getNetwork(); expect(network.patterns.length).toBeGreaterThan(0);
      expect(network.patterns.every(pattern => routes.some(route=>route.id===pattern.routeId && route.active))).toBe(true);
      expect(network.vehicles.every(vehicle=>Number.isFinite(vehicle.heading))).toBe(true);
      const info=await service.getSystemInfo(); expect(info.name.length).toBeGreaterThan(0); expect(info.version).toBeDefined(); expect(info.routeGroups.length).toBeGreaterThan(0);
      expect(Array.isArray(await service.searchBuses(agency.id==='5842'?'2100':'95129'))).toBe(true);
      expect((await service.getTimetable(detail.stops[0].id,active.id)).stopId).toBe(detail.stops[0].id);
      const comparison=await service.compareJourney(detail.stops[0],detail.stops.at(-1)!); expect(Array.isArray(comparison.routes)).toBe(true);
      expect(client.calls.every(call=>call.status==='ok')).toBe(true);
    }, 120000);
  }
});
