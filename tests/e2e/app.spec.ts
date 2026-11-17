import { test, expect, type Page } from '@playwright/test';
import fixture from '../fixtures/api-contracts.json' with { type: 'json' };
import ohioFixture from '../fixtures/passio-ohio.json' with { type: 'json' };
import ugaPassioFixture from '../fixtures/passio-uga.json' with { type: 'json' };
import passioExtras from '../fixtures/passio-extras.json' with { type: 'json' };

type MockOptions = { cityRoute?: boolean; transfer?: boolean; outsideVehicle?: boolean; failRoutes?: boolean; noVehicles?: boolean; staleVehicles?: boolean; failTracking?: boolean; passio?: boolean; failedMirrors?: string[]; freshPassioVehicles?: boolean; duplicatePassioVehicles?: boolean };
const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => { const errors: string[] = []; pageErrors.set(page, errors); page.on('pageerror', error => errors.push(error.message)); });
test.afterEach(({ page }) => { expect(pageErrors.get(page)).toEqual([]); });
async function mockTransit(page: Page, options: MockOptions = {}) {
  const calls: string[] = [];
  const data = structuredClone(fixture);
  data.ugaVehicles.forEach(bus => { bus.lastUpdate = options.staleVehicles ? Date.now() - 360000 : Date.now(); });
  if (options.outsideVehicle) data.ugaVehicles.push({ ...data.ugaVehicles[0], id:'999999', name:'Outside bus', latitude:39.33, longitude:-82.1 });
  if (options.cityRoute) data.ugaRoutes.push({...data.ugaRoutes[1],id:9001,new_id:'9001',long_name:'City Line 1',short_name:'1',isAthensBus:true});
  if (options.transfer) { data.ugaRoutes[0].active=true; data.ugaRoutes.push({...data.ugaRoutes[1],id:9009,new_id:'9009',long_name:'Unused Line',short_name:'X'}); }
  data.ugaTracking.forEach((stop, i) => { stop.times = [Date.now() + 300000 + i * 60000]; });
  data.ugaStop.forEach(stop => { stop.times = [Date.now() + 180000]; });
  await page.route('https://tile.openstreetmap.org/**', route => route.abort());
  await page.route('**/api/places', route => route.fulfill({ status: 503, json: { error: 'Address search unavailable in this fixture' } }));
  await page.route('**/api?url=*', async route => {
    const url = new URL(route.request().url()).searchParams.get('url')!;
    calls.push(url); const path = new URL(url).pathname;
    const target = new URL(url);
    if (target.hostname === 'bustracker.accgov.com') return route.fulfill({ status:503, json:{error:'Athens legacy feed unavailable in this fixture'} });
    if (['passiogo.com','replicated2of3.passiogo.com','replicated3of3.passiogo.com'].includes(target.hostname)) {
      if (!options.passio || options.failedMirrors?.includes(target.hostname)) return route.fulfill({status:503,json:{error:'Passio node unavailable'}});
      const body = route.request().postDataJSON() || {};
      const system = body.systemSelected0 || body.s0 || body.systems?.systemSelected0 || target.searchParams.get('userId') || '5842';
      const passio = structuredClone(system === '3994' ? ugaPassioFixture : ohioFixture);
      if (options.freshPassioVehicles) for (const buses of Object.values(passio.buses.buses)) for (const bus of buses) Object.assign(bus,{updatedUtc:new Date().toISOString()});
      if (options.duplicatePassioVehicles) {
        const current=Object.values(passio.buses.buses).flat().find(bus=>String(bus.routeId)==='44886');
        if (current) Object.assign(passio.buses.buses,{old:[{...current,outdated:1,latitude:'33.94',longitude:'-83.38'}]});
      }
      for (const rows of Object.values(passio.eta.ETAs)) for (const row of rows) {
        Object.assign(row, {arrivalTimestamp:Date.now()+300000,etaUtc:Date.now()+300000,updatedUtc:new Date().toISOString().slice(0,19).replace('T',' ')});
      }
      const query = target.searchParams;
      let response: unknown;
      if (query.get('getRoutes') === '1') response = passio.catalog;
      else if (query.get('getStops') === '2') response = passio.topology;
      else if (query.get('getBuses') === '1') response = passio.buses;
      else if (query.has('getAlertMessages')) response = passio.messages;
      else if (query.get('eta') === '3') { const ids = (query.get('stopIds') || '').split(','); response = {...passio.eta, ETAs:Object.fromEntries(Object.entries(passio.eta.ETAs).filter(([id])=>ids.includes(id)))}; }
      else if (query.get('getSystems') === '2') response = passioExtras.systems;
      else if (query.has('goWebVer')) response = passioExtras.version;
      else if (query.get('getRoutes') === '2') response = passioExtras.groups;
      else if (query.get('getBuses') === '2') response = passioExtras.search;
      else if (query.get('schedule') === '4') response = passioExtras.timetable;
      else if (query.get('walk') === '2') response = passioExtras.comparison;
      return response === undefined ? route.fulfill({status:404,json:{error:'Unknown Passio query'}}) : route.fulfill({json:response});
    }
    let result: unknown;
    if (path.endsWith('/cache/Routes')) {
      if (options.failRoutes) return route.fulfill({ status: 503, json: { error: 'Operator unavailable' } });
      result = data.ugaRoutes;
    } else if (path.endsWith('/cache/Buses')) result = options.noVehicles ? [] : data.ugaVehicles;
    else if (path.includes('/cache/routeTracking_')) {
      if (options.failTracking) return route.fulfill({ status: 503, json: { error: 'Tracking unavailable' } });
      if (options.transfer) {
        const id=Number(path.split('routeTracking_')[1]);
        const points=id===5750?[[90001,'Start Stop',33.95,-83.41],[90002,'Change Stop',33.95,-83.38]]:id===5741?[[90002,'Change Stop',33.95,-83.38],[90003,'End Stop',33.95,-83.35]]:[[90004,'Unused A',34,-83.41],[90005,'Unused B',34,-83.40]];
        result=points.map(([stopId,name,lat,lon],i)=>({id:`r_${id}__s_${stopId}`,routeId:id,direction:0,stopSequence:i+1,stop:{id:String(stopId),name,latitude:lat,longitude:lon},times:[Date.now()+300000+i*60000]}));
      } else result = data.ugaTracking;
    } else if (path.includes('/cache/stop_')) result = data.ugaStop;
    else if (path.endsWith('/version.json')) result = { version: 1086 };
    else if (path.endsWith('/busData.json')) result = data.ugaStatic;
    else if (path.includes('/TransitAuthorities')) result = [{ Id: 1, Name: 'CATA', RestUrl: 'https://realtime.catabus.com/InfoPoint/rest', Latitude: 40.79, Longitude: -77.87 }];
    else if (path.endsWith('/TransitAuthorityConfig/Get')) result = data.infoConfig;
    else if (/\/Routes\/Get/.test(path)) result = [data.infoDetail];
    else if (path.endsWith('/GetAllRouteDetails')) result = [data.infoDetail];
    else if (/\/RouteDetails\/Get\//.test(path)) result = data.infoDetail;
    else if (path.includes('GetDirectionsByRouteID')) result = data.infoDirections;
    else if (path.includes('GetStopsForRouteDirection')) result = data.infoDirectionStops;
    else if (path.includes('/Stops/GetAllStops')) result = data.infoDetail.Stops;
    else if (path.includes('/Stops/Get/')) result = data.infoStop;
    else if (path.includes('/StopDepartures/Get/')) result = data.infoDepartures;
    else if (path.endsWith('/PublicMessages/GetCurrentMessages')) result = data.infoMessages;
    else if (path.endsWith('.kml')) return route.fulfill({ contentType: 'application/xml', body: '<kml><LineString><coordinates>-77.87,40.79 -77.85,40.81</coordinates></LineString></kml>' });
    else return route.fulfill({ status: 404, json: { error: `Unmocked ${path}` } });
    return route.fulfill({ json: result });
  });
  return { calls, data };
}

async function unlockRoute(page: Page) {
  const button = page.getByRole('button', { name:/^Route lock/ });
  if (await button.getAttribute('aria-pressed') === 'true') await button.click();
}

test('first page lists every route, searches, filters and refreshes', async ({ page }) => {
  const { calls } = await mockTransit(page);
  await page.goto('/');
  await expect(page).toHaveURL(/\/routes$/);
  await expect(page.locator('.route-card')).toHaveCount(2);
  await expect(page.locator('#route-count')).toContainText('2 routes · 1 active');
  await expect(page.locator('.route-card').first()).toHaveClass(/route-active/);
  await expect(page.locator('.route-card').last()).toHaveClass(/route-inactive|route-unconfirmed/);
  expect(await page.locator('.route-card').first().evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(await page.locator('.route-card').last().evaluate(el => getComputedStyle(el).backgroundColor));
  await page.getByLabel('Search routes').fill('night');
  await expect(page.locator('.route-card')).toHaveCount(1);
  await page.getByLabel('Search routes').fill('');
  await page.getByLabel('Active only').check();
  await expect(page.locator('.route-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Refresh routes' }).click();
  await expect(page.locator('.route-card')).toHaveCount(2);
  expect(calls.some(url => url.endsWith('/Routes'))).toBe(true);
});

test('selected route shows geometry, current stops, bus heading, arrivals and direction selector', async ({ page }) => {
  const { calls } = await mockTransit(page);
  await page.goto('/'); await page.locator('[data-route="5750"]').click();
  await expect(page).toHaveURL(/\/routes\/5750$/);
  await expect(page.locator('.stop-list li')).toHaveCount(19);
  await expect(page.locator('.bus-marker')).toHaveCount(1);
  await expect(page.locator('.leaflet-overlay-pane path').first()).toBeVisible();
  await expect(page.locator('#vehicle-list')).toContainText('98°');
  await page.locator('.bus-marker').click();
  await expect(page.locator('.leaflet-popup')).toContainText('Heading E');
  await page.getByLabel('Route direction', { exact: true }).selectOption({ index: 1 });
  await page.locator('.stop-list button').first().click();
  await expect(page.locator('.stop-arrivals')).toContainText('Predicted');
  await expect(page.locator('.stop-arrivals')).toContainText('3 min');
  expect(calls.some(url => url.includes('/stop_'))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Start a trip here' }).click();
  await expect(page.locator('#trip-origin')).not.toHaveValue('');
});

test('positions update through the polling feature', async ({ page }) => {
  const { calls } = await mockTransit(page);
  await page.clock.install();
  await page.goto('/'); await page.locator('[data-route="5750"]').click();
  await expect(page.locator('.bus-marker')).toHaveCount(1);
  const before = calls.filter(url => url.endsWith('/Buses')).length;
  await page.clock.fastForward(16000);
  await expect.poll(() => calls.filter(url => url.endsWith('/Buses')).length).toBeGreaterThan(before);
});

test('opening a route immediately refreshes cached bus data before displaying its map',async({page})=>{
  const {calls,data}=await mockTransit(page);
  await page.clock.install(); await page.clock.pauseAt(new Date());
  await page.goto('/');await expect(page.locator('.route-card')).toHaveCount(2);
  const before=calls.filter(url=>url.endsWith('/Buses')).length;
  expect(before).toBe(1);
  data.ugaVehicles[0].heading=200;
  await page.locator('[data-route="5750"]').click();
  await expect(page.locator('.bus-marker')).toHaveCount(1);
  await expect(page.locator('.bus-marker')).toHaveAttribute('aria-label',/Bus 17997, S/);
  await expect(page.locator('.bus-pointer.stale')).toHaveCount(0);
  expect(calls.filter(url=>url.endsWith('/Buses')).length).toBeGreaterThan(before);
});

test('opening the planner immediately requests buses from every configured source',async({page})=>{
  const {calls}=await mockTransit(page,{passio:true});
  await page.clock.install();await page.clock.pauseAt(new Date());
  await page.goto('/plan');
  await expect(page.locator('#trip-map.leaflet-container')).toBeVisible();
  await expect.poll(()=>calls.filter(url=>new URL(url).searchParams.get('getBuses')==='1').length).toBe(3);
  expect(calls.some(url=>url.endsWith('/Buses'))).toBe(true);
  expect(calls.some(url=>url.includes('bustracker.accgov.com'))).toBe(true);
  await expect(page.locator('.trip-summary')).toHaveCount(0);
});

test('initial catalog includes live evidence and keeps updating after a background crawl',async({page})=>{
  const {data}=await mockTransit(page,{passio:true,failRoutes:true,freshPassioVehicles:true});
  await page.clock.install();await page.goto('/');
  const card=page.locator('.route-card').filter({has:page.locator('[data-route="5750"]')});
  await expect(card).toHaveClass(/route-active/);
  // A later crawl must update cards, not only the source-health bar.
  await page.route('**/api?url=*',route=>{
    const target=new URL(new URL(route.request().url()).searchParams.get('url')!);
    if (target.searchParams.get('getBuses')==='1') return route.fulfill({json:{buses:{}}});
    return route.fallback();
  });
  data.ugaVehicles.length=0;
  await page.clock.fastForward(61000);
  await expect(card).toHaveClass(/route-unconfirmed/);
});

test('a provider-current clock-only bus replaces its grey duplicate on the initial map',async({page})=>{
  await mockTransit(page,{passio:true,noVehicles:true,duplicatePassioVehicles:true});
  await page.goto('/routes/5750');
  const bus=page.locator('.bus-marker[aria-label^="Bus 15228,"]');
  await expect(bus).toHaveCount(1);
  await expect(page.locator('.bus-marker')).toHaveCount(1);
  await expect(bus.locator('.bus-pointer.stale')).toHaveCount(0);
  await expect(page.locator('.vehicle-card')).toHaveCount(1);
  await expect(page.locator('.vehicle-card')).toContainText('Update time unavailable');
  await expect(page.locator('.vehicle-card .stale-label')).toHaveCount(0);
});

test('stale and empty vehicle data are disclosed', async ({ page }) => {
  await mockTransit(page, { staleVehicles: true });
  await page.goto('/'); await page.locator('[data-route="5750"]').click();
  await expect(page.locator('.bus-pointer.stale')).toHaveCount(1);
  await expect(page.locator('#vehicle-list')).toContainText('Last known position');
});

test('no vehicles renders a clear service state', async ({ page }) => {
  await mockTransit(page, { noVehicles: true });
  await page.goto('/'); await page.locator('[data-route="5750"]').click();
  await expect(page.locator('#vehicle-list')).toContainText('No buses are currently reported');
  await expect(page.locator('.bus-marker')).toHaveCount(0);
});

test('plans a real directed bus connection between arbitrary coordinates', async ({ page }) => {
  const { data, calls } = await mockTransit(page);
  await page.goto('/'); await page.locator('nav [data-nav="plan"]').click();
  await expect(page).toHaveURL(/\/plan$/);
  const stops = data.ugaTracking;
  const from = stops[0].stop, to = stops[8].stop;
  await page.getByRole('combobox', { name: 'Start', exact: true }).fill(`${from.latitude}, ${from.longitude}`);
  await page.getByRole('combobox', { name: 'Destination', exact: true }).fill(`${to.latitude}, ${to.longitude}`);
  await page.getByRole('button', { name: 'Find quickest bus trip' }).click();
  await expect(page.locator('.trip-summary')).toContainText('QUICKEST ESTIMATED CONNECTION');
  await expect(page.locator('.journey-leg.ride')).not.toHaveCount(0);
  await expect(page.locator('.trip-lines li')).not.toHaveCount(0);
  await expect(page.locator('.bus-marker')).not.toHaveCount(0);
  await expect(page.locator('.assumptions')).toBeVisible();
  await expect(page.locator('.leaflet-overlay-pane path').first()).toBeVisible();
  expect(calls.some(url => url.includes('routeTracking_5750'))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('map picking and swapping preserve named points', async ({ page }) => {
  await mockTransit(page); await page.goto('/'); await page.locator('nav [data-nav="plan"]').click();
  await page.locator('#pick-origin').click();
  await page.locator('#trip-map').click({ position: { x: 110, y: 150 } });
  await expect(page.locator('#trip-origin')).not.toHaveValue('');
  const hint = await page.locator('#map-instruction').boundingBox(), mapBounds = await page.locator('#trip-map').boundingBox();
  expect(hint!.y).toBeGreaterThanOrEqual(mapBounds!.y); expect(hint!.y + hint!.height).toBeLessThanOrEqual(mapBounds!.y + mapBounds!.height);
  await page.locator('#pick-destination').click();
  await page.locator('#trip-map').click({ position: { x: 180, y: 240 } });
  const from = await page.locator('#trip-origin').inputValue();
  const to = await page.locator('#trip-destination').inputValue();
  expect(from).not.toBe(to);
  await page.getByRole('button', { name: 'Swap' }).click();
  await expect(page.locator('#trip-origin')).toHaveValue(to);
  await expect(page.locator('#trip-destination')).toHaveValue(from);
});

test('uses browser geolocation and reports denial with recovery', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']); await context.setGeolocation({ latitude: 33.948, longitude: -83.377 });
  await mockTransit(page); await page.goto('/'); await page.locator('nav [data-nav="plan"]').click();
  await page.getByRole('button', { name: 'My location', exact: true }).click();
  await expect(page.locator('#trip-origin')).toHaveValue('Current location');
  await page.evaluate(() => { navigator.geolocation.getCurrentPosition = (_ok, fail) => fail?.({ code: 1 } as GeolocationPositionError); });
  await page.getByRole('button', { name: 'My location', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('permission was denied');
});

async function expectLocationCentered(page: Page, selector: string) {
  await expect(page.locator(`${selector} .user-location-marker`)).toHaveCount(1);
  await expect.poll(()=>page.locator(selector).evaluate(element=>{
    const map=element.getBoundingClientRect(), marker=element.querySelector('.user-location-marker')!.getBoundingClientRect();
    return Math.hypot(marker.x+marker.width/2-map.x-map.width/2,marker.y+marker.height/2-map.y-map.height/2);
  })).toBeLessThan(2);
}

for(const [path,selector] of [['/routes/5750','#route-map'],['/plan','#trip-map']]) {
  test(`the map location button shows and recenters your position on ${path}`,async({page,context})=>{
    const stops=fixture.ugaTracking.map(row=>row.stop);
    const latitude=(Math.min(...stops.map(stop=>stop.latitude))+Math.max(...stops.map(stop=>stop.latitude)))/2;
    const longitude=(Math.min(...stops.map(stop=>stop.longitude))+Math.max(...stops.map(stop=>stop.longitude)))/2;
    await context.grantPermissions(['geolocation']);await context.setGeolocation({latitude,longitude,accuracy:25});
    await page.addInitScript(()=>{
      const browserLocate=navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
      const state=window as unknown as {locationRequests:number};state.locationRequests=0;
      navigator.geolocation.getCurrentPosition=(...args)=>{state.locationRequests++;browserLocate(...args);};
    });
    await mockTransit(page);await page.goto(path);
    const button=page.getByRole('button',{name:'Show my location',exact:true});
    await expect(button).toBeVisible();
    expect(await page.evaluate(()=>(window as unknown as {locationRequests:number}).locationRequests)).toBe(0);
    if(path==='/plan') {await page.locator('#pick-origin').click();await button.focus();await button.press('Enter');}
    else await button.click();
    await expectLocationCentered(page,selector);
    await expect(page.locator('.user-location-accuracy')).toHaveCount(1);
    await expect(page.locator('.map-location-status')).toContainText('Accuracy ±25 m');
    await expect(page.getByRole('button',{name:/^Route lock/})).toHaveAttribute('aria-pressed','true');
    if(path==='/plan') {await expect(page.locator('#trip-origin')).toHaveValue('');await expect(page.locator('#trip-destination')).toHaveValue('');}
    const bounds=(await page.locator(selector).boundingBox())!;
    await page.mouse.move(bounds.x+bounds.width/2+60,bounds.y+bounds.height/2);
    await page.mouse.down();await page.mouse.move(bounds.x+bounds.width/2+180,bounds.y+bounds.height/2,{steps:8});await page.mouse.up();
    await button.click();await expectLocationCentered(page,selector);
    await expect(page.locator('.user-location-accuracy')).toHaveCount(1);
    expect(await page.evaluate(()=>(window as unknown as {locationRequests:number}).locationRequests)).toBe(2);
  });
}

test('the map location button explains denial and can retry without changing the trip',async({page})=>{
  await mockTransit(page);await page.goto('/plan');await page.locator('#trip-origin').fill('33.95,-83.41');
  await page.evaluate(()=>{navigator.geolocation.getCurrentPosition=(_success,error)=>error?.({code:1} as GeolocationPositionError);});
  const button=page.getByRole('button',{name:'Show my location',exact:true});await button.click();
  await expect(page.locator('.map-location-status[role="alert"]')).toContainText('permission was denied');
  await expect(button).toBeEnabled();await expect(button).toHaveAttribute('aria-busy','false');
  await expect(page.locator('.user-location-marker')).toHaveCount(0);
  await page.evaluate(()=>{navigator.geolocation.getCurrentPosition=success=>success({coords:{latitude:33.948,longitude:-83.377,accuracy:12}} as GeolocationPosition);});
  await button.click();await expectLocationCentered(page,'#trip-map');
  await expect(page.locator('.map-location-status')).toHaveAttribute('role','status');
  await expect(page.locator('#trip-origin')).toHaveValue('33.95,-83.41');
});

test('centering a location outside route bounds releases the lock and preserves the calculated trip',async({page,context})=>{
  await context.grantPermissions(['geolocation']);await context.setGeolocation({latitude:39.33,longitude:-82.1,accuracy:30});
  await transferTrip(page);
  await page.getByRole('button',{name:'Show my location',exact:true}).click();
  await expectLocationCentered(page,'#trip-map');
  await expect(page.getByRole('button',{name:/^Route lock/})).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('.map-location-status')).toContainText('Route lock turned off');
  await expect(page.locator('.trip-summary')).toBeVisible();await expect(page.locator('.journey-ride')).toHaveCount(2);
  await expect(page.locator('#trip-origin')).toHaveValue('33.95,-83.41');await expect(page.locator('#trip-destination')).toHaveValue('33.95,-83.35');
  expect(await page.evaluate(()=>localStorage.getItem('tranuga.route-lock.v1'))).toBe('false');
  const stored=await page.evaluate(()=>localStorage.getItem('tranuga.transit-replicas.v1')||'');
  expect(stored).not.toContain('39.33');expect(stored).not.toContain('-82.1');
});

test('a pending map location request stays busy and cannot update a map after navigation',async({page})=>{
  await mockTransit(page);await page.goto('/plan');
  await page.evaluate(()=>{
    navigator.geolocation.getCurrentPosition=success=>{(window as unknown as {finishLocation:PositionCallback}).finishLocation=success;};
  });
  const button=page.getByRole('button',{name:'Show my location',exact:true});await button.click();
  await expect(button).toBeDisabled();await expect(button).toHaveAttribute('aria-busy','true');
  await expect(page.locator('.map-location-status')).toContainText('Finding your location');
  await page.locator('nav [data-nav="routes"]').click();await expect(page.locator('.route-card')).not.toHaveCount(0);
  await page.evaluate(()=>{(window as unknown as {finishLocation:PositionCallback}).finishLocation({coords:{latitude:33.948,longitude:-83.377,accuracy:15}} as GeolocationPosition);});
  await page.locator('nav [data-nav="plan"]').click();
  await expect(page.locator('.user-location-marker')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Show my location',exact:true})).toBeEnabled();
});

test('validates coordinates and reports unreachable destinations', async ({ page }) => {
  await mockTransit(page); await page.goto('/'); await page.locator('nav [data-nav="plan"]').click();
  await page.getByRole('combobox', { name: 'Start', exact: true }).fill('bad'); await page.getByRole('combobox', { name: 'Destination', exact: true }).fill('0,0');
  await page.getByRole('button', { name: 'Find quickest bus trip' }).click();
  await expect(page.getByRole('alert')).toContainText('Choose a start and destination');
  await page.getByRole('combobox', { name: 'Start', exact: true }).fill('0,0');
  await page.getByRole('button', { name: 'Find quickest bus trip' }).click();
  await expect(page.locator('#trip-result')).toContainText('No bus connection found');
});

test('failed live topology retains verified static stop order for planning', async ({ page }) => {
  await mockTransit(page, { failTracking: true });
  await page.goto('/'); await page.locator('[data-route="5750"]').click();
  await expect(page.locator('#route-warnings')).toContainText('Showing static stops');
  await page.locator('nav [data-nav="plan"]').click();
  await page.getByRole('combobox', { name: 'Start', exact: true }).fill('33.948,-83.377'); await page.getByRole('combobox', { name: 'Destination', exact: true }).fill('33.95,-83.38');
  await page.getByRole('button', { name: 'Find quickest bus trip' }).click();
  await expect(page.locator('#trip-notes')).toContainText('verified static stop order');
  await expect(page.locator('.trip-summary')).toBeVisible();
});

test('plan and route views support direct URLs and browser history', async ({ page }) => {
  await mockTransit(page);
  await page.goto('/plan');
  await expect(page.locator('#trip-map')).toBeVisible();
  await expect(page.locator('nav [data-nav="plan"]')).toHaveAttribute('aria-current', 'page');
  await page.locator('nav [data-nav="routes"]').click();
  await page.locator('[data-route="5750"]').click();
  await expect(page).toHaveURL(/\/routes\/5750$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/routes$/);
  await expect(page.locator('.route-card')).toHaveCount(2);
});

test('authority discovery, nearby and code lookup lead to InfoPoint maps and service alerts', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']); await context.setGeolocation({ latitude: 40.79, longitude: -77.87 });
  const { calls } = await mockTransit(page); await page.goto('/'); await page.getByRole('button', { name: 'Networks', exact: true }).click();
  await expect(page.locator('.agency-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Find nearby' }).click();
  await expect.poll(() => calls.some(url => url.includes('/Locate?Lat='))).toBe(true);
  await page.getByLabel('Authority code', { exact: true }).fill('CATA'); await page.getByRole('button', { name: 'Find by code' }).click();
  await expect.poll(() => calls.some(url => url.includes('includeHiddenPropertyCode='))).toBe(true);
  await page.locator('.agency-card').click(); await expect(page.locator('.route-card')).toHaveCount(1);
  await page.locator('.route-card').click(); await expect(page.locator('.stop-list li')).not.toHaveCount(0);
  await expect(page.locator('#service-messages')).toContainText('Service notice');
  expect(calls.some(url => url.endsWith('Route51.kml'))).toBe(true);
});

test('catalog failure is visible and retryable, and narrow screens do not overflow', async ({ page }) => {
  await mockTransit(page, { failRoutes: true }); await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('503');
  await expect(page.getByRole('button', { name: 'Refresh routes' })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('trip endpoints stay consistent while a slow search is running', async ({ page }) => {
  const { data } = await mockTransit(page);
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api?url=*', async route => {
    if (new URL(route.request().url()).searchParams.get('url')?.includes('routeTracking_')) await waiting;
    await route.fallback();
  });
  await page.goto('/'); await page.locator('nav [data-nav="plan"]').click();
  const from = data.ugaTracking[0].stop, to = data.ugaTracking[8].stop;
  await page.getByRole('combobox', { name: 'Start', exact: true }).fill(`${from.latitude}, ${from.longitude}`);
  await page.getByRole('combobox', { name: 'Destination', exact: true }).fill(`${to.latitude}, ${to.longitude}`);
  await page.getByRole('button', { name: 'Find quickest bus trip' }).click();
  await expect(page.getByRole('progressbar', {name:'Route calculation'})).toBeVisible();
  await expect(page.locator('#find-trip #trip-progress')).toBeVisible();
  await expect(page.locator('#find-trip')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#trip-origin')).toBeDisabled();
  await expect(page.locator('#swap')).toBeDisabled();
  release();
  await expect(page.locator('.trip-summary')).toBeVisible();
  await expect(page.locator('#trip-origin')).toBeEnabled();
  await expect(page.getByRole('progressbar', {name:'Route calculation'})).toBeHidden();
  await expect(page.locator('#find-trip #trip-progress')).toBeHidden();
  await expect(page.locator('#find-trip')).toHaveAttribute('aria-busy', 'false');
});

test('late agency directory responses cannot overwrite a newer code lookup', async ({ page }) => {
  await mockTransit(page);
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api?url=*', async route => {
    const target = new URL(new URL(route.request().url()).searchParams.get('url')!);
    if (target.pathname.endsWith('/TransitAuthorities') && !target.search) {
      await waiting;
      await route.fulfill({ json: [{ Id: 2, Name: 'Old directory result', RestUrl: 'https://realtime.catabus.com/InfoPoint/rest' }] });
    } else await route.fallback();
  });
  await page.goto('/'); await page.getByRole('button', { name: 'Networks', exact: true }).click();
  await page.getByLabel('Authority code', { exact: true }).fill('CATA');
  await page.getByRole('button', { name: 'Find by code' }).click();
  await expect(page.locator('.agency-card')).toContainText('CATA');
  release();
  await expect(page.locator('#agency-status')).toHaveText('1 agencies found');
  await expect(page.locator('.agency-card')).toContainText('CATA');
});

test('rapid navigation during map focus does not leave a callback on a removed map', async ({ page }) => {
  await mockTransit(page); await page.goto('/');
  await page.locator('[data-route="5750"]').click();
  await page.locator('.stop-list button').first().waitFor();
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('.stop-list button')!.click();
    document.querySelector<HTMLButtonElement>('nav [data-nav="plan"]')!.click();
  });
  // Observe both the next frame and Leaflet's former 250 ms zoom completion timer.
  await page.waitForTimeout(350);
  await expect(page.locator('#trip-map')).toBeVisible();
});

test('the supplied Passio network stays in Ohio and uses all three replicas', async ({ page }) => {
  const {calls}=await mockTransit(page,{passio:true});
  await page.goto('/');await page.getByRole('button',{name:'Networks',exact:true}).click();await page.locator('#select-ohio').click();
  await expect(page.locator('#agency-name')).toContainText('Ohio');
  await expect(page.locator('.route-card')).toHaveCount(3);
  await expect(page.locator('#source-summary')).toContainText('3/3 backend replicas');
  await page.locator('[data-route="66949"]').click();
  await expect(page.locator('.stop-list li')).not.toHaveCount(0);
  await expect(page.locator('.bus-marker')).not.toHaveCount(0);
  expect(calls.filter(url=>url.includes('getRoutes=1')).some(url=>url.startsWith('https://passiogo.com'))).toBe(true);
  expect(calls.some(url=>url.startsWith('https://replicated2of3.passiogo.com'))).toBe(true);
  expect(calls.some(url=>url.startsWith('https://replicated3of3.passiogo.com'))).toBe(true);
  await expect(page.locator('#route-detail h1')).toContainText('APT Line 3');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('Passio keeps maps and predictions available with only one healthy replica', async ({ page }) => {
  await mockTransit(page,{passio:true,failedMirrors:['passiogo.com','replicated2of3.passiogo.com']});
  await page.goto('/');await page.getByRole('button',{name:'Networks',exact:true}).click();await page.locator('#select-ohio').click();
  await expect(page.locator('.route-card')).toHaveCount(3);
  await expect(page.locator('#source-summary')).toContainText('1/3 backend replicas');
  await page.locator('[data-route="66949"]').click();
  await expect(page.locator('#route-warnings')).toContainText('Backup data');
  await page.locator('.stop-list button').first().click();
  await expect(page.locator('.stop-arrivals')).toContainText('Predicted');
});

test('Passio data supports Georgia trips when the UGA catalog is unavailable', async ({ page }) => {
  await mockTransit(page,{passio:true,failRoutes:true});await page.goto('/');
  await expect(page.locator('[data-route="5750"]')).toBeVisible();
  await page.locator('nav [data-nav="plan"]').click();
  await page.getByRole('combobox',{name:'Start',exact:true}).fill('33.932505,-83.371494');
  await page.getByRole('combobox',{name:'Destination',exact:true}).fill('33.95458,-83.376482');
  await page.getByRole('button',{name:'Find quickest bus trip'}).click();
  await expect(page.locator('.trip-summary')).toBeVisible();
  await expect(page.locator('.journey-leg.ride')).not.toHaveCount(0);
  await expect(page.locator('#trip-notes')).toContainText('Backup data');
});

test('provider metadata, fleet search, timetable and explicit trip comparison use the extracted reads',async({page})=>{
  const {calls}=await mockTransit(page,{passio:true});await page.goto('/');
  await page.getByRole('button',{name:'Networks',exact:true}).click();await page.locator('#select-ohio').click();
  await page.locator('#source-summary').click();await page.getByRole('button',{name:'Provider information',exact:true}).click();
  await expect(page.locator('#provider-details')).toContainText('Web API version');
  await expect(page.locator('#provider-details')).toContainText('Athens');
  await page.locator('[data-route="66949"]').click();
  await page.getByLabel('Find a bus by fleet number').fill('2100');await page.getByRole('button',{name:'Find bus',exact:true}).click();
  await expect(page.locator('#bus-search-result')).toContainText('Bus');
  await page.locator('.stop-list button').first().click();await page.getByRole('button',{name:'Provider timetable',exact:true}).click();
  await expect(page.locator('#stop-timetable')).toContainText('Provider clock times');
  await page.locator('nav [data-nav="plan"]').click();
  await page.getByRole('combobox',{name:'Start',exact:true}).fill('39.29566789,-82.11205432');
  await page.getByRole('combobox',{name:'Destination',exact:true}).fill('39.325428,-82.101967');
  expect(calls.some(url=>url.includes('walk=2'))).toBe(false);
  await page.locator('.operator-comparison summary').click();await page.getByRole('button',{name:'Request provider comparison'}).click();
  await expect(page.locator('#operator-result article')).not.toHaveCount(0);
  for(const query of ['getSystems=2','goWebVer=1','getRoutes=2','getBuses=2','schedule=4','walk=2'])expect(calls.some(url=>url.includes(query)),query).toBe(true);
  const saved=await page.evaluate(()=>localStorage.getItem('tranuga.transit-replicas.v1')||'');
  expect(saved).not.toContain('39.29566789');
});

test('a delayed provider suggestion cannot replace results after endpoints change',async({page})=>{
  await mockTransit(page,{passio:true});let release!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api?url=*',async route=>{if(new URL(route.request().url()).searchParams.get('url')?.includes('walk=2'))await waiting;await route.fallback();});
  await page.goto('/');await page.locator('nav [data-nav="plan"]').click();
  await page.getByRole('combobox',{name:'Start',exact:true}).fill('33.94,-83.37');await page.getByRole('combobox',{name:'Destination',exact:true}).fill('33.95,-83.38');
  await page.locator('.operator-comparison summary').click();await page.getByRole('button',{name:'Request provider comparison'}).click();
  await expect(page.getByRole('button',{name:'Request provider comparison'})).toBeDisabled();
  await page.getByRole('combobox',{name:'Destination',exact:true}).fill('33.96,-83.39');release();
  await expect(page.getByRole('button',{name:'Request provider comparison'})).toBeEnabled();
  await expect(page.locator('#operator-result')).toBeEmpty();
});

test('footer identifies the student development project and Codex across views', async ({ page }) => {
  await mockTransit(page); await page.goto('/');
  await expect(page.locator('footer')).toContainText('A student-based open source project, for development purposes only.');
  await expect(page.locator('footer')).toContainText('Vibe coded with ❤️ by Codex');
  await page.locator('nav [data-nav="plan"]').click();
  await expect(page.locator('footer')).toContainText('Vibe coded with ❤️ by Codex');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('stop-name suggestions support the keyboard and produce a bus trip without geocoding', async ({ page }) => {
  const { data } = await mockTransit(page);
  const queries: string[] = [];
  await page.route('**/api/places', async route => { queries.push(route.request().postDataJSON().query); await route.fulfill({ json: { type: 'FeatureCollection', features: [] } }); });
  await page.goto('/'); await page.locator('nav [data-nav="plan"]').click();
  const from = data.ugaTracking[0].stop, to = data.ugaTracking[8].stop;
  const start = page.getByRole('combobox', { name: 'Start', exact: true });
  const end = page.getByRole('combobox', { name: 'Destination', exact: true });
  await start.fill(from.name);
  await page.locator('#trip-origin-hints').getByRole('option').filter({ hasText: from.name }).first().click();
  await end.fill(to.name);
  await expect(page.locator('#trip-destination-hints').getByRole('option').first()).toContainText(to.name);
  await end.press('ArrowDown'); await expect(end).toHaveAttribute('aria-activedescendant', /option-0$/);
  await end.press('Enter'); await expect(end).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: 'Find quickest bus trip' }).click();
  await expect(page.locator('.trip-summary')).toBeVisible();
  expect(queries).toEqual([]);
});

test('address suggestions use POST, selection preserves coordinates through swaps and edits clear stale points', async ({ page }) => {
  const { data } = await mockTransit(page); const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/places', async route => {
    const body = route.request().postDataJSON(); bodies.push(body);
    expect(route.request().method()).toBe('POST'); expect(new URL(route.request().url()).search).toBe('');
    const stop = data.ugaTracking[body.query === 'Alpha address' ? 0 : 8].stop;
    await route.fulfill({ json: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [stop.longitude, stop.latitude] }, properties: { name: body.query, city: 'Athens', state: 'Georgia' } }] } });
  });
  await page.goto('/'); await page.locator('nav [data-nav="plan"]').click();
  const start = page.getByRole('combobox', { name: 'Start', exact: true }), end = page.getByRole('combobox', { name: 'Destination', exact: true });
  await start.fill('Zz'); await expect(start).toHaveAttribute('aria-expanded', 'false'); expect(bodies).toEqual([]);
  await start.fill('Alpha address'); await expect(page.locator('#trip-origin-hints')).toContainText('Alpha address');
  await start.press('ArrowDown'); await start.press('Enter');
  await end.fill('Beta address'); await page.locator('#trip-destination-hints').getByRole('option').click();
  await page.getByRole('button', { name: 'Swap' }).click(); await expect(start).toHaveValue('Beta address'); await expect(end).toHaveValue('Alpha address');
  await page.getByRole('button', { name: 'Swap' }).click();
  await page.getByRole('button', { name: 'Find quickest bus trip' }).click(); await expect(page.locator('.trip-summary')).toBeVisible();
  await start.fill('Unselected text'); await page.getByRole('button', { name: 'Find quickest bus trip' }).click();
  await expect(page.locator('#trip-status')).toContainText('Choose a start and destination');
  await expect(page.locator('.trip-summary')).toHaveCount(0);
  expect(bodies.length).toBe(2); expect(bodies[0]).toMatchObject({ query: 'Alpha address', lat: 33.948, lon: -83.377 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('late address responses cannot overwrite new hints or a removed planner', async ({ page }) => {
  await mockTransit(page);
  let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; }); const calls: string[] = [];
  await page.route('**/api/places', async route => {
    const query = route.request().postDataJSON().query; calls.push(query);
    if (query === 'Older address') await waiting;
    await route.fulfill({ json: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-83.377, 33.948] }, properties: { name: query } }] } });
  });
  await page.goto('/'); await page.locator('nav [data-nav="plan"]').click();
  const start = page.getByRole('combobox', { name: 'Start', exact: true });
  await start.fill('Older address'); await expect.poll(() => calls.includes('Older address')).toBe(true);
  await start.fill('Newer address'); await expect(page.locator('#trip-origin-hints')).toContainText('Newer address');
  release(); await expect(page.locator('#trip-origin-hints')).not.toContainText('Older address');
  await start.press('Escape'); await expect(start).toHaveAttribute('aria-expanded', 'false');
  await start.fill('Another address'); await page.locator('nav [data-nav="routes"]').click();
  await expect(page.locator('.route-card')).toHaveCount(2);
});

test('travel notes expose useful categories and preserve original warnings in source details', async ({ page }) => {
  await mockTransit(page, { staleVehicles: true }); await page.goto('/'); await page.locator('[data-route="5750"]').click();
  const freshness = page.locator('#route-warnings [data-note-kind="freshness"]');
  await page.locator('#route-warnings > details > summary').click();
  await expect(freshness.getByRole('heading')).toHaveText('GPS age');
  await expect(freshness.locator('svg')).toHaveAttribute('aria-hidden', 'true');
  await freshness.getByText('Full text', { exact: true }).click();
  await expect(freshness.locator('details')).toContainText('older than two minutes');
});

test('dark mode updates every view, keeps trip points, and restores the saved palette', async ({ page }) => {
  await mockTransit(page); await page.goto('/');
  const theme = page.getByRole('button', { name:/^Dark mode/ });
  await expect(theme).toHaveAttribute('aria-pressed', 'false');
  const light = await page.locator('html').evaluate(el => getComputedStyle(el).backgroundColor);
  await theme.click(); await expect(theme).toHaveAttribute('aria-pressed', 'true');
  const dark = await page.locator('html').evaluate(el => getComputedStyle(el).backgroundColor); expect(dark).not.toBe(light);
  await page.locator('nav [data-nav="plan"]').click();
  await page.locator('#trip-origin').fill('33.948,-83.377');
  await expect(page.locator('.leaflet-tile-pane')).toHaveCSS('filter', /invert\(1\)/);
  await theme.click(); await expect(page.locator('#trip-origin')).toHaveValue('33.948,-83.377');
  await theme.click(); await page.reload();
  await expect(theme).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('nav [data-nav="routes"]').click(); await page.locator('[data-route="5750"]').click();
  await expect(page.locator('.bus-marker')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('system dark preference and blocked storage both leave the menu usable', async ({ page }) => {
  await page.emulateMedia({ colorScheme:'dark' });
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error('Storage blocked'); };
    Storage.prototype.setItem = () => { throw new Error('Storage blocked'); };
  });
  await mockTransit(page); await page.goto('/');
  await expect(page.getByRole('button', { name:/^Dark mode/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name:/^Route lock/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name:/^Dark mode/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await unlockRoute(page); await expect(page.getByRole('button', { name:/^Route lock/ })).toHaveAttribute('aria-pressed', 'false');
});

test('route lock defaults on, remembers its setting and keeps network choices available', async ({ page }) => {
  const { calls } = await mockTransit(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name:/^Route lock/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name:/^Athens lock/ })).toHaveCount(0);
  await page.locator('nav [data-nav="agencies"]').click();
  await expect(page.locator('#select-ohio')).toBeVisible(); await expect(page.locator('.network-tools')).toBeVisible();
  await expect(page.locator('.agency-card')).toContainText('CATA');
  expect(calls.some(url => url.includes('TransitAuthorities'))).toBe(true);
  await unlockRoute(page);
  await page.reload(); await expect(page.getByRole('button', { name:/^Route lock/ })).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(()=>localStorage.getItem('tranuga.route-lock.v1'))).toBe('false');
});

test('route lock changes the existing map without refetching or filtering bus data', async ({ page }) => {
  const {calls}=await mockTransit(page, { outsideVehicle:true }); await page.clock.install();
  await page.goto('/routes/5750');
  await expect(page.locator('.bus-marker')).toHaveCount(2); await expect(page.locator('.vehicle-card')).toHaveCount(2);
  await expect(page.locator('#detail-stats strong')).toHaveText('2');
  await page.locator('#route-map').evaluate(element=>element.dataset.instance='retained');
  const before=calls.length;
  await unlockRoute(page); await page.getByRole('button',{name:/^Route lock/}).click();
  await expect(page.locator('#route-map')).toHaveAttribute('data-instance','retained');
  expect(calls.length).toBe(before);
  await page.clock.fastForward(16000);
  await expect(page.locator('.vehicle-card')).toHaveCount(2); await expect(page.locator('.bus-marker')).toHaveCount(2);
});

test('toggling route lock preserves the Ohio network and selected trip points', async ({ page }) => {
  await mockTransit(page, { passio:true }); await page.goto('/');
  await page.locator('nav [data-nav="agencies"]').click(); await page.locator('#select-ohio').click();
  await expect(page.locator('[data-route="66949"]')).toBeVisible();
  await page.locator('nav [data-nav="plan"]').click(); await page.locator('#trip-origin').fill('39.33,-82.1'); await page.locator('#trip-destination').fill('39.32,-82.11');
  await unlockRoute(page); await page.getByRole('button', { name:/^Route lock/ }).click();
  await expect(page.locator('#agency-name')).toContainText('Ohio');
  await expect(page.locator('#trip-origin')).toHaveValue('39.33,-82.1'); await expect(page.locator('#trip-destination')).toHaveValue('39.32,-82.11');
  // Before a route exists, the planner stays free for choosing points.
  await expect(page.locator('.leaflet-control-zoom-out')).toHaveAttribute('aria-disabled','false');
});

test('route lock allows address hints and current locations outside Athens Georgia', async ({ page, context }) => {
  await mockTransit(page);
  await context.grantPermissions(['geolocation']); await context.setGeolocation({ latitude:39.33, longitude:-82.1 });
  await page.route('**/api/places', route => route.fulfill({ json:{ type:'FeatureCollection', features:[
    { type:'Feature', geometry:{ type:'Point', coordinates:[-82.1,39.33] }, properties:{ name:'Ohio landmark' } },
    { type:'Feature', geometry:{ type:'Point', coordinates:[-83.377,33.948] }, properties:{ name:'Local landmark' } },
  ] } }));
  await page.goto('/plan'); await page.locator('#trip-origin').fill('Remote address');
  await expect(page.locator('#trip-origin-hints [role="option"]')).toHaveCount(2);
  await page.getByRole('option').filter({hasText:'Ohio landmark'}).click();
  await expect(page.locator('#trip-origin')).toHaveValue('Ohio landmark');
  await page.getByRole('button', { name:'My location', exact:true }).click();
  await expect(page.locator('#trip-origin')).toHaveValue('Current location');
});

async function transferTrip(page: Page) {
  await mockTransit(page,{transfer:true,noVehicles:true}); await page.goto('/plan');
  await page.locator('#trip-origin').fill('33.95,-83.41'); await page.locator('#trip-destination').fill('33.95,-83.35');
  await page.getByRole('button',{name:'Find quickest bus trip'}).click();
  await expect(page.locator('.trip-summary')).toBeVisible();
}

async function zoomToRouteOverview(page: Page) {
  const out=page.locator('.leaflet-control-zoom-out');
  for(let i=0;i<20 && await out.getAttribute('aria-disabled')!=='true';i++) await out.click();
  await expect(out).toHaveAttribute('aria-disabled','true');
}

async function routeExtent(page: Page) {
  return page.locator('#trip-map').evaluate(element=>{
    const map=element.getBoundingClientRect();
    const points=[...element.querySelectorAll('.point-marker')].map(marker=>{const p=marker.getBoundingClientRect();return {x:p.left+15,y:p.top+36};});
    const left=Math.min(...points.map(p=>p.x)),right=Math.max(...points.map(p=>p.x));
    const top=Math.min(...points.map(p=>p.y)),bottom=Math.max(...points.map(p=>p.y));
    const overlap=(low:number,high:number,start:number,size:number)=>high-low<1 ? Number(low>=start-2 && high<=start+size+2) : Math.max(0,Math.min(high,start+size)-Math.max(low,start))/Math.min(high-low,size);
    return {x:overlap(left,right,map.left,map.width),y:overlap(top,bottom,map.top,map.height),width:(right-left)/map.width,height:(bottom-top)/map.height,centerX:(left+right)/2-map.left,centerY:(top+bottom)/2-map.top};
  });
}

test('route lock stops at the used-trip overview and allows close-up zoom',async({page})=>{
  await transferTrip(page); await zoomToRouteOverview(page);
  const extent=await routeExtent(page);
  expect(extent.x).toBeGreaterThan(.99);expect(extent.y).toBe(1);
  expect(extent.width).toBeGreaterThan(.6);expect(extent.width).toBeLessThan(1);
  await page.locator('#trip-map').focus(); await page.locator('#trip-map').press('-');
  await expect(page.locator('.leaflet-control-zoom-out')).toHaveAttribute('aria-disabled','true');
  await page.locator('.leaflet-control-zoom-in').click();
  await expect(page.locator('.leaflet-control-zoom-out')).toHaveAttribute('aria-disabled','false');
  expect((await routeExtent(page)).width).toBeGreaterThan(extent.width*1.5);
  await unlockRoute(page);
  for(let i=0;i<8;i++) await page.locator('.leaflet-control-zoom-out').click();
  await expect(page.locator('.leaflet-control-zoom-out')).toHaveAttribute('aria-disabled','false');
});

test('route lock permits panning in every direction while preserving half the route extent after resize',async({page})=>{
  await transferTrip(page); await zoomToRouteOverview(page);
  await page.locator('#trip-map').scrollIntoViewIfNeeded();
  for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1]]) {
    const before=await routeExtent(page);
    const bounds=(await page.locator('#trip-map').boundingBox())!;
    const x=bounds.x+bounds.width/2,y=bounds.y+Math.min(bounds.height/2,200);
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx*1600,y+dy*1600,{steps:15});await page.mouse.up();
    await expect.poll(async()=>Math.min((await routeExtent(page)).x,(await routeExtent(page)).y)).toBeGreaterThanOrEqual(.49);
    await expect.poll(async()=>{const after=await routeExtent(page);return Math.hypot(after.centerX-before.centerX,after.centerY-before.centerY);}).toBeGreaterThan(10);
  }
  await page.setViewportSize({width:520,height:900});await zoomToRouteOverview(page);
  await expect.poll(async()=>Math.min((await routeExtent(page)).x,(await routeExtent(page)).y)).toBeGreaterThanOrEqual(.49);
});

test('route details use a route-sized overview and refresh their bounds after a direction selection',async({page})=>{
  await mockTransit(page);await page.goto('/routes/5750');
  await expect(page.locator('.leaflet-control-zoom-out')).toHaveAttribute('aria-disabled','true');
  const map=(await page.locator('#route-map').boundingBox())!;
  const line=(await page.locator('#route-map .leaflet-overlay-pane path').first().boundingBox())!;
  expect(Math.max(line.width/map.width,line.height/map.height)).toBeGreaterThan(.6);
  expect(line.width).toBeLessThanOrEqual(map.width);expect(line.height).toBeLessThanOrEqual(map.height);
  await page.locator('#route-direction').selectOption({index:1});
  await expect(page.locator('.leaflet-control-zoom-out')).toHaveAttribute('aria-disabled','true');
});

test('a tiny route uses the closest available overview instead of a fixed city-scale zoom',async({page})=>{
  const {data}=await mockTransit(page);
  data.ugaTracking.forEach((row,index)=>{row.stop.latitude=33.95+index*.000001;row.stop.longitude=-83.37;});
  await page.route('**/api?url=*',route=>{
    const target=new URL(new URL(route.request().url()).searchParams.get('url')!);
    if(target.pathname.endsWith('/busData.json')) return route.fulfill({status:503,json:{error:'No road trace in this fixture'}});
    return route.fallback();
  });
  await page.goto('/routes/5750');
  // This route fits inside the closest tile zoom: both ends of the zoom range coincide.
  await expect(page.locator('.leaflet-control-zoom-in')).toHaveAttribute('aria-disabled','true');
  await expect(page.locator('.leaflet-control-zoom-out')).toHaveAttribute('aria-disabled','true');
});

test('editing a completed trip removes the previous route lock so new map points can be chosen',async({page})=>{
  await transferTrip(page);await zoomToRouteOverview(page);
  await page.locator('#trip-origin').fill('33.96,-83.42');
  await expect(page.locator('.journey-ride')).toHaveCount(0);
  await expect(page.locator('.leaflet-control-zoom-out')).toHaveAttribute('aria-disabled','false');
  await expect(page.getByRole('button',{name:/^Route lock/})).toHaveAttribute('aria-pressed','true');
});

test('only active favorites stay on top across reloads, with UGA priority within each group', async ({ page }) => {
  await mockTransit(page, {cityRoute:true}); await page.goto('/');
  await expect(page.locator('.route-card')).toHaveCount(3);
  await expect(page.locator('.route-card').nth(0).locator('[data-route]')).toHaveAttribute('data-route','5750');
  await expect(page.locator('.route-card').nth(1).locator('[data-route]')).toHaveAttribute('data-route','9001');
  await expect(page.locator('.route-card').nth(2).locator('[data-route]')).toHaveAttribute('data-route','5741');
  await page.locator('[data-favorite="9001"]').click(); await expect(page).toHaveURL(/\/routes$/);
  await expect(page.locator('.route-card').first().locator('[data-route]')).toHaveAttribute('data-route','9001');
  await expect(page.locator('[data-favorite="9001"]')).toHaveAttribute('aria-pressed','true');
  await page.reload(); await expect(page.locator('.route-card').first().locator('[data-route]')).toHaveAttribute('data-route','9001');
  await page.locator('[data-favorite="9001"]').click(); await expect(page.locator('.route-card').first().locator('[data-route]')).toHaveAttribute('data-route','5750');
  await page.locator('[data-favorite="5741"]').click(); await expect(page.locator('.route-card').last().locator('[data-route]')).toHaveAttribute('data-route','5741');
  await expect(page.locator('[data-favorite="5741"]')).toHaveAttribute('aria-pressed','true');
  await page.reload(); await expect(page.locator('.route-card').last().locator('[data-route]')).toHaveAttribute('data-route','5741');
  await expect(page.locator('[data-favorite="5741"]')).toHaveAttribute('aria-pressed','true');
  await page.getByLabel('Active only').check(); await expect(page.locator('[data-route="5741"]')).toHaveCount(0);
});

test('a favorite moves between active and inactive groups as live service changes',async({page})=>{
  const {data}=await mockTransit(page,{cityRoute:true});await page.clock.install();await page.goto('/');
  const favorite=data.ugaRoutes.find(route=>route.id===5741)!;
  await page.locator('[data-favorite="5741"]').click();
  await expect(page.locator('.route-card').last().locator('[data-route]')).toHaveAttribute('data-route','5741');
  favorite.active=true;await page.clock.fastForward(61000);
  await expect(page.locator('.route-card').first().locator('[data-route]')).toHaveAttribute('data-route','5741');
  favorite.active=false;await page.clock.fastForward(61000);
  await expect(page.locator('.route-card').last().locator('[data-route]')).toHaveAttribute('data-route','5741');
  await expect(page.locator('[data-favorite="5741"]')).toHaveAttribute('aria-pressed','true');
});

test('notes collapse below the map with compact fragments and optional original text', async ({ page }) => {
  await mockTransit(page,{staleVehicles:true}); await page.goto('/routes/5750');
  const notes=page.locator('#route-warnings > details'); await expect(notes).toBeVisible(); await expect(notes).not.toHaveAttribute('open','');
  const map=(await page.locator('#route-map').boundingBox())!,box=(await notes.boundingBox())!; expect(box.y).toBeGreaterThan(map.y+map.height);
  const fragment=notes.locator('[data-note-kind="freshness"] p'); await expect(fragment).toBeHidden();
  await notes.locator(':scope > summary').click(); await expect(fragment).toHaveText('GPS >2 min / time unknown');
  await notes.locator('[data-note-kind="freshness"] .note-details > summary').click(); await expect(notes).toContainText('older than two minutes');
  await page.locator('nav [data-nav="plan"]').click(); await expect(page.locator('.planning-note > details')).not.toHaveAttribute('open','');
});

test('the journey draws only used bus lines and marks the actual transfer stop', async ({ page }) => {
  const {calls}=await mockTransit(page,{transfer:true,noVehicles:true}); await page.goto('/plan');
  await page.locator('#trip-origin').fill('33.95,-83.41'); await page.locator('#trip-destination').fill('33.95,-83.35');
  await page.locator('#max-walk').selectOption('800'); await page.getByRole('button',{name:'Find quickest bus trip'}).click();
  await expect(page.locator('.journey-leg.ride')).toHaveCount(2); await expect(page.locator('.transfer-marker')).toHaveCount(1);
  await expect(page.locator('.transfer-marker')).toHaveAttribute('title',/Change Stop/);
  await expect(page.locator('.transfer-hint')).toContainText('Change Stop');
  const drawn=await page.locator('path.journey-ride').evaluateAll(paths=>paths.map(path=>path.getAttribute('data-route-id')));
  expect(new Set(drawn)).toEqual(new Set(['5750','5741'])); expect(drawn).not.toContain('9009');
  expect(calls.some(url=>url.includes('routeTracking_9009'))).toBe(true);
  await expect(page.locator('#trip-notes > details').first()).not.toHaveAttribute('open','');
  await page.locator('#trip-origin').fill('33.951,-83.41'); await expect(page.locator('path.journey-ride')).toHaveCount(0); await expect(page.locator('.transfer-marker')).toHaveCount(0);
});

for (const reduced of [false,true]) test(`bus updates ${reduced?'respect reduced motion':'interpolate in the journey map'} without extrapolating`, async ({ page }) => {
  await page.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'}); await page.clock.install();
  const {data}=await mockTransit(page); await page.goto('/plan');
  const from=data.ugaTracking[0].stop,to=data.ugaTracking[8].stop;
  await page.locator('#trip-origin').fill(`${from.latitude},${from.longitude}`); await page.locator('#trip-destination').fill(`${to.latitude},${to.longitude}`);
  await page.getByRole('button',{name:'Find quickest bus trip'}).click(); await expect(page.locator('.bus-marker')).toHaveCount(1);
  await page.route('**/api?url=*', async route=>{
    if (!new URL(route.request().url()).searchParams.get('url')?.endsWith('/Buses')) { await route.fallback(); return; }
    const at=await page.evaluate(()=>Date.now());
    await route.fulfill({json:[{...data.ugaVehicles[0],longitude:data.ugaVehicles[0].longitude+.0003,heading:200,lastUpdate:at,proxyTimestamp:at}]});
  });
  await page.clock.fastForward(16000); await expect(page.locator('.bus-marker')).toHaveAttribute('aria-label',/, S/);
  const initial=await page.locator('.bus-marker').getAttribute('style');
  await page.clock.runFor(600); const middle=await page.locator('.bus-marker').getAttribute('style');
  await page.clock.runFor(1000); const final=await page.locator('.bus-marker').getAttribute('style');
  if (reduced) {expect(initial).toBe(final);expect(middle).toBe(final);} else {expect(initial).not.toBe(middle);expect(middle).not.toBe(final);}
  await page.clock.runFor(2000); await expect(page.locator('.bus-marker')).toHaveAttribute('style',final!);
  await page.locator('nav [data-nav="routes"]').click(); await page.clock.runFor(1500); await expect(page.locator('.route-card')).toHaveCount(2);
});

test('calculation progress ends on failure and returns the form to a usable state', async ({ page }) => {
  await mockTransit(page); await page.clock.install(); await page.goto('/plan');
  await page.locator('#trip-origin').fill('33.94,-83.38'); await page.locator('#trip-destination').fill('33.95,-83.37');
  await page.clock.fastForward(16000);
  await page.route('**/api?url=*', async route=>{
    if (new URL(route.request().url()).searchParams.get('url')?.endsWith('/cache/Routes')) await route.fulfill({status:503,json:{error:'Offline'}}); else await route.fallback();
  });
  await page.getByRole('button',{name:'Find quickest bus trip'}).click(); await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('#trip-progress')).toBeHidden(); await expect(page.locator('#find-trip')).toBeEnabled(); await expect(page.locator('#find-trip')).toHaveAttribute('aria-busy','false');
});
