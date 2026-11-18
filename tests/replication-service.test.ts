import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../src/api/client';
import { createTransitService, GEORGIA_AGENCY } from '../src/replication';
import { ReplicatedTransitService, type TransitProvider } from '../src/replication/service';
import { SnapshotStore, type StorageLike } from '../src/replication/store';
import type { Network, Route, Stop } from '../src/types';

const now = 1800000000000;
const agency = { id: 'test', name: 'Test network', kind: 'uga' as const };
const route: Route = { id:'1', name:'One', shortName:'1', color:'#123456', active:true, agencyId:'test', availability:'current' };
const stop: Stop = { id:'a', name:'A', lat:33.94, lon:-83.37 };
const network: Network = { agencyId:'test', routes:[route], stops:[stop,{...stop,id:'b',lat:33.95}], patterns:[{id:'p',routeId:'1',direction:'0',stops:[stop,{...stop,id:'b',lat:33.95}],shape:[],loop:false}], vehicles:[{id:'bus',routeId:'1',lat:33.94,lon:-83.37,heading:0,updatedAt:now}],departures:[{stopId:'a',routeId:'1',direction:'0',arrivalTime:now+120000,updatedAt:now}],messages:['Service notice'],warnings:[],updatedAt:now };
const fail = () => Promise.reject(new Error('Provider returned503'));
function provider(): TransitProvider {
  return { client:new ApiClient(), listRoutes:vi.fn(async()=>structuredClone(network.routes)), getRoute:vi.fn(async()=>({route:structuredClone(route),...structuredClone(network)})), getStop:vi.fn(async()=>({stop:structuredClone(stop),departures:structuredClone(network.departures)})),getNetwork:vi.fn(async()=>structuredClone(network)),refreshVehicles:vi.fn(async()=>structuredClone(network.vehicles)),getMessages:vi.fn(async()=>['Service notice']) };
}
function memory(): StorageLike & { data:Map<string,string> } { const data=new Map<string,string>(); return {data,getItem:key=>data.get(key)??null,setItem:(key,value)=>{data.set(key,value);}}; }
function replicated(services: TransitProvider[], store=new SnapshotStore(), clock=()=>now) { return new ReplicatedTransitService(agency, services.map((service,i)=>({id:String(i),label:`Source${i+1}`,priority:i,service})),undefined,store,clock,'replicas'); }

describe('replicated crawling and public last-good snapshots',()=>{
  it('shows an Athens bus only on its current InfoPoint route when the portal lists another assignment', async () => {
    const fix = { latitude: 33.95, longitude: -83.37 };
    const vehicleId = '756';
    let infoAvailable = true;
    const requestedAt = Date.now();
    const fetcher = vi.fn<typeof fetch>(async input => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/Buses')) {
        return Response.json([
          { ...fix, id: vehicleId, name: vehicleId, routeId: 1022, isAthensBus: true, lastUpdate: requestedAt },
          { ...fix, id: '755', name: '755', routeId: 1022, isAthensBus: true, lastUpdate: requestedAt },
        ]);
      }
      if (url.pathname.endsWith('/GetVisibleRoutes') && infoAvailable) {
        return Response.json([{
          RouteId: 26,
          Vehicles: [{ ...fix, VehicleId: Number(vehicleId), Name: vehicleId, LastUpdated: requestedAt - 5000 }],
        }]);
      }
      return new Response(null, { status: 503 });
    });
    const service = createTransitService(GEORGIA_AGENCY, new ApiClient(fetcher, ''));
    const oldRoute = service.routeVehicleTracker('1022'), currentRoute = service.routeVehicleTracker('1026');
    await Promise.all([oldRoute.probe(), currentRoute.probe()]);
    expect(oldRoute.snapshot()).toMatchObject({ source: 'UGA portal', vehicles: [{ id: '755' }] });
    expect(currentRoute.snapshot()).toMatchObject({ source: 'Athens GA · InfoPoint', vehicles: [{ id: 'infopoint:756' }] });
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/Buses'))).toHaveLength(1);

    infoAvailable = false;
    await Promise.all([oldRoute.probe(), currentRoute.probe()]);
    expect(oldRoute.snapshot().vehicles.map(bus => bus.id)).toEqual(['756', '755']);
    expect(currentRoute.snapshot().vehicles).toEqual([]);
  });
  it('chooses different single endpoints on different routes, including an individual Passio mirror',async()=>{
    const portal=provider(), unavailable=provider(), mirror=provider();
    const bus=network.vehicles[0];
    portal.refreshVehicles=vi.fn(async()=>[bus,{...bus,id:'old-2',routeId:'2',active:false}]);
    unavailable.refreshVehicles=fail;
    mirror.refreshVehicles=vi.fn(async()=>[
      {...bus,id:'old-x',routeId:'x',active:false},
      {...bus,id:'fresh-y',routeId:'y'},
    ]);
    const replicas=replicated([unavailable,mirror]);
    const service=new ReplicatedTransitService(agency,[
      {id:'portal',label:'Portal',aliasKey:'portal',priority:0,service:portal},
      {id:'passio',label:'Passio',aliasKey:'passio',prefix:'passio:',priority:1,service:replicas},
    ],{routes:[{id:'1',sources:{portal:'1',passio:'x'}},{id:'2',sources:{portal:'2',passio:'y'}}],stops:[],vehicles:[]},new SnapshotStore(),()=>now);
    const routeOne=service.routeVehicleTracker('1'),routeTwo=service.routeVehicleTracker('2');
    await Promise.all([routeOne.probe(),routeTwo.probe()]);
    expect(routeOne.snapshot()).toMatchObject({source:'Portal',vehicles:[{id:'bus',routeId:'1'}]});
    expect(routeTwo.snapshot()).toMatchObject({source:'Source2',vehicles:[{id:'passio:fresh-y',routeId:'2',sources:[{source:'Source2',id:'fresh-y'}]}]});
    expect(mirror.refreshVehicles).toHaveBeenCalledWith(true);
  });
  it('crawls every configured source, reconciles data, and exposes responding source health',async()=>{
    const providers=[provider(),provider(),provider()], service=replicated(providers);
    const result=await service.sync();
    providers.forEach(source=>expect(source.getNetwork).toHaveBeenCalledTimes(1));
    expect(result.routes).toHaveLength(1);expect(result.routes[0].agreement).toBe('corroborated');
    expect(result.vehicles).toHaveLength(1);expect(service.report.healthy).toBe(3);
  });
  it('continues with one healthy provider when two fail without inventing quorum',async()=>{
    const providers=[provider(),provider(),provider()];providers[0].getNetwork=fail;providers[2].getNetwork=fail;
    const service=replicated(providers),result=await service.getNetwork();
    expect(result.patterns).toHaveLength(1);expect(result.routes[0].agreement).toBe('single-source');expect(result.vehicles).toEqual([]);
    expect(service.report.healthy).toBe(1);expect(result.warnings.join(' ')).toContain('Backup data');
  });
  it('selects the concrete 2-of-3 vehicle location and omits the primary outlier',async()=>{
    const providers=[provider(),provider(),provider()];
    const locations=[33.97,33.9401,33.9402];
    providers.forEach((source,index)=>{ source.getNetwork=vi.fn(async()=>({ ...structuredClone(network), vehicles:[{...structuredClone(network.vehicles[0]),lat:locations[index]}] })); });
    const result=await replicated(providers).getNetwork();
    expect(result.vehicles).toHaveLength(1);expect(result.vehicles[0]).toMatchObject({lat:33.9401,agreement:'corroborated'});
  });
  it('coalesces simultaneous full crawls instead of fanning out duplicate requests',async()=>{
    const providers=[provider(),provider()],service=replicated(providers);
    const [a,b]=await Promise.all([service.getNetwork(),service.getNetwork()]);
    expect(a).toBe(b);providers.forEach(source=>expect(source.getNetwork).toHaveBeenCalledTimes(1));
  });
  it('bounds a stalled provider and reuses its live crawl rather than restarting it',async()=>{
    const slow=provider(),healthy=provider();let release!:(value:Network)=>void;
    slow.getNetwork=vi.fn(()=>new Promise<Network>(resolve=>{release=resolve;}));
    const service=new ReplicatedTransitService(agency,[{id:'slow',label:'Slow',priority:0,service:slow},{id:'healthy',label:'Healthy',priority:1,service:healthy}],undefined,new SnapshotStore(undefined,()=>now),()=>now,'replicas',5);
    expect((await service.getNetwork()).routes).toHaveLength(1);
    expect((await service.getNetwork()).routes).toHaveLength(1);
    expect(slow.getNetwork).toHaveBeenCalledTimes(1);expect(service.report.sources[0].error).toContain('timed out');
    release(structuredClone(network));
  });
  it('persists original snapshot times across a reload and expires current service and predictions',async()=>{
    const storage=memory();let clock=now;
    const first=replicated([provider()],new SnapshotStore(storage,()=>clock),()=>clock);await first.getNetwork();
    clock+=240000;
    const offline=provider();offline.getNetwork=fail;
    const restored=replicated([offline],new SnapshotStore(storage,()=>clock),()=>clock), result=await restored.getNetwork();
    expect(result.routes[0].active).toBe(false);expect(result.routes[0].agreement).toBe('stale-backup');
    expect(result.departures).toEqual([]);expect(result.updatedAt).toBe(now);
    expect(result.vehicles[0].updatedAt).toBe(now);expect(result.vehicles[0].snapshotAt).toBe(now);
  });
  it('does not freshen last-good data through a nested replica coordinator',async()=>{
    let clock=now;const store=new SnapshotStore(undefined,()=>clock),source=provider();
    const child=replicated([source],store,()=>clock);
    const outer=new ReplicatedTransitService({...agency,id:'parent'},[{id:'child',label:'Nested replicas',priority:0,service:child}],undefined,store,()=>clock);
    await outer.getNetwork();clock+=240000;source.getNetwork=fail;
    const result=await outer.getNetwork();
    expect(result.routes[0].active).toBe(false);expect(result.routes[0].snapshotAt).toBe(now);
    expect(outer.getResultMeta('network')).toEqual({cached:true,at:now});expect(result.departures).toEqual([]);
  });
  it('restores catalog, route and stop views from a full last-good network snapshot',async()=>{
    const store=new SnapshotStore(undefined,()=>now),source=provider(),service=replicated([source],store);
    await service.getNetwork();source.listRoutes=fail;source.getRoute=fail;source.getStop=fail;
    expect(await service.listRoutes()).toHaveLength(1);
    expect((await service.getRoute('1')).patterns).toHaveLength(1);
    expect((await service.getStop('a')).stop.id).toBe('a');
  });
  it('rejects malformed persisted topology instead of creating cycles from string booleans',async()=>{
    const store=new SnapshotStore(undefined,()=>now),value=structuredClone(network) as unknown as {patterns:{loop:unknown}[]};value.patterns[0].loop='false';
    store.put('test:0:network',value,now);const source=provider();source.getNetwork=fail;
    await expect(replicated([source],store).getNetwork()).rejects.toThrow('All available transit sources failed');
  });
  it('rejects malformed optional observation times in saved responses',async()=>{
    const store=new SnapshotStore(undefined,()=>now),value=structuredClone(network) as unknown as {departures:{departureTime:unknown}[]};value.departures[0].departureTime='later';
    store.put('test:0:network',value,now);const source=provider();source.getNetwork=fail;
    await expect(replicated([source],store).getNetwork()).rejects.toThrow('All available transit sources failed');
  });
  it('survives corrupt or full browser storage and still serves memory backups',async()=>{
    const broken:StorageLike={getItem:()=>'{',setItem:()=>{throw new Error('quota');}},store=new SnapshotStore(broken,()=>now),source=provider(),service=replicated([source],store);
    await service.getNetwork();source.getNetwork=fail;expect((await service.getNetwork()).routes).toHaveLength(1);
  });
  it('does not treat a successful alerts read as proof that failed route data recovered',async()=>{
    const source=provider(),service=replicated([source]);source.listRoutes=fail;
    await expect(service.listRoutes()).rejects.toThrow('503');await service.getMessages();
    expect(service.report.sources[0].state).toBe('degraded');expect(service.report.sources[0].error).toContain('503');
  });
  it('keeps user trip coordinates out of persistent snapshots during operator comparison',async()=>{
    const storage=memory(),source=provider();source.getSystemInfo=vi.fn();source.compareJourney=vi.fn(async()=>({routes:[],warnings:[]}));
    const service=replicated([source],new SnapshotStore(storage,()=>now));
    await service.compareJourney({lat:39.123456,lon:-82.123456},{lat:39.789012,lon:-82.789012});
    expect(storage.data.size).toBe(0);expect(source.compareJourney).toHaveBeenCalledTimes(1);
  });
  it('executes lightweight catalog, vehicle and alert crawls on every source',async()=>{
    const providers=[provider(),provider(),provider()];await replicated(providers).crawlLive();
    providers.forEach(source=>{expect(source.listRoutes).toHaveBeenCalled();expect(source.refreshVehicles).toHaveBeenCalled();expect(source.getMessages).toHaveBeenCalled();expect(source.getNetwork).not.toHaveBeenCalled();});
  });
  it('uses initial vehicle evidence for publication-only cards without loading topology or arrivals',async()=>{
    const source=provider(); source.listRoutes=vi.fn(async()=>[{...route,availability:'published'}]);
    const service=replicated([source]);
    expect(await service.getLiveRoutes()).toEqual([expect.objectContaining({active:true,availability:'current'})]);
    source.refreshVehicles=fail;
    const offline=replicated([source]);
    expect(await offline.getLiveRoutes()).toEqual([expect.objectContaining({active:false,availability:'unknown'})]);
    expect(source.getNetwork).not.toHaveBeenCalled();
  });
  it('requests fresh vehicle data through nested coordinators when a map opens',async()=>{
    const source=provider(), child=replicated([source]);
    await replicated([child]).refreshVehicles(true);
    expect(source.refreshVehicles).toHaveBeenCalledWith(true);
  });
  it('expires snapshots beyond one day rather than claiming indefinite offline availability',()=>{
    const storage=memory();new SnapshotStore(storage,()=>now).put('key',[route]);
    const old=new SnapshotStore(storage,()=>now+86400001);expect(old.get('key',(v):v is Route[]=>Array.isArray(v))).toBeUndefined();
  });
  it('bounds snapshot slots and evicts older public resources',()=>{
    const storage=memory(),store=new SnapshotStore(storage,()=>now);
    for(let index=0;index<70;index++)store.put(`resource-${index}`,index);
    const entries=JSON.parse([...storage.data.values()][0]).entries;
    expect(entries).toHaveLength(64);expect(store.get('resource-0',(v):v is number=>typeof v==='number')).toBeUndefined();
    expect(store.get('resource-69',(v):v is number=>typeof v==='number')?.value).toBe(69);
  });
  it('keeps serialized storage bounded while retaining an oversized single value only in memory',()=>{
    const storage=memory(),store=new SnapshotStore(storage,()=>now);
    store.put('first','x'.repeat(1200000));store.put('second','y'.repeat(1200000));
    expect([...storage.data.values()][0].length).toBeLessThanOrEqual(2000000);
    expect(store.get('first',(v):v is string=>typeof v==='string')).toBeUndefined();
    const other=memory(),large=new SnapshotStore(other,()=>now);large.put('large','z'.repeat(2100000));
    expect(other.data.size).toBe(0);expect(large.get('large',(v):v is string=>typeof v==='string')?.value.length).toBe(2100000);
  });
});

describe('read-only POST transport',()=>{
  it('uses same-origin POST and separates agency payload cache entries without forwarding credentials',async()=>{
    const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>Response.json({body:JSON.parse(String(init?.body))}));
    const client=new ApiClient(fetcher as typeof fetch);
    await client.post('https://passiogo.com/mapGetData.php?getRoutes=1',{systemSelected0:'3994',amount:1});
    await client.post('https://passiogo.com/mapGetData.php?getRoutes=1',{systemSelected0:'5842',amount:1});
    await client.post('https://passiogo.com/mapGetData.php?getRoutes=1',{systemSelected0:'3994',amount:1});
    expect(fetcher).toHaveBeenCalledTimes(2);expect(fetcher.mock.calls[0][0]).toContain('/api?url=');
    expect(fetcher.mock.calls[0][1]).toMatchObject({method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'}});
  });
});

describe('stop search directories', () => {
  it('merges comparable stop directories without a prediction crawl and recovers a saved network directory', async () => {
    const sources = [provider(), provider(), provider()];
    sources.forEach(source => { source.getStops = vi.fn(async () => structuredClone(network.stops)); });
    const storage = memory(), store = new SnapshotStore(storage, () => now), service = replicated(sources, store);
    const stops = await service.getStops();
    expect(stops).toHaveLength(2); expect(stops[0].agreement).toBe('corroborated');
    sources.forEach(source => { expect(source.getStops).toHaveBeenCalledTimes(1); expect(source.getNetwork).not.toHaveBeenCalled(); });
    await service.getNetwork();
    const offline = provider(); offline.getStops = fail;
    const restored = replicated([offline], new SnapshotStore(storage, () => now));
    expect(await restored.getStops()).toHaveLength(2); expect(restored.report.sources[0].state).toBe('cached');
  });
});
