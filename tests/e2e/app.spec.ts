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

const routeName = 'A | Central East';
const start = 'Intramural Fields Deck';
const input = (page: Page, label: string) => page.getByRole('textbox', { name: label, exact: true });
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const map = (page: Page) => page.getByRole('region', { name: 'Transit map' });

async function tripPoints(page: Page, from = fixture.ugaTracking[0].stop, to = fixture.ugaTracking[8].stop) {
  await input(page, 'Start').fill(`${from.latitude}, ${from.longitude}`);
  await input(page, 'Destination').fill(`${to.latitude}, ${to.longitude}`);
}

test('the shared catalog searches, filters active routes and opens a route', async ({ page }) => {
  const { calls } = await mockTransit(page);
  await page.goto('/');
  await expect(page).toHaveURL(/\/routes$/);
  await expect(page.getByRole('heading', { name: 'TranUGA' })).toBeVisible();
  await expect(page.getByText('2 of 2 routes')).toBeVisible();
  await input(page, 'Search routes').fill('Milledge');
  await expect(page.getByText('1 of 2 routes')).toBeVisible();
  await button(page, 'Active routes only').click();
  await expect(page.getByText('No routes match your filters.')).toBeVisible();
  const catalogReads = () => calls.filter(url => url.endsWith('/Routes')).length;
  const readsBeforeRefresh = catalogReads();
  await button(page, 'Refresh routes').click();
  await expect.poll(catalogReads).toBeGreaterThan(readsBeforeRefresh);
  await expect(page.getByText('No routes match your filters.')).toBeVisible();
  await input(page, 'Search routes').fill('Central');
  await page.getByRole('button', { name: /Central East, Active service/ }).click();
  await expect(page).toHaveURL(/\/routes\/5750$/);
  await expect(page.getByRole('heading', { name: routeName })).toBeVisible();
});

test('favorites are remembered when returning to the catalog', async ({ page }) => {
  await mockTransit(page);
  await page.goto('/routes');
  await button(page, 'Add A|CE to favorites').click();
  await expect(button(page, 'Remove A|CE from favorites')).toBeVisible();
  await page.reload();
  await expect(button(page, 'Remove A|CE from favorites')).toBeVisible();
});

test('the route map shows the shared inside-arrow marker and opens stop arrivals', async ({ page }) => {
  await mockTransit(page);
  await page.goto('/routes/5750');
  await expect(page.getByRole('heading', { name: routeName })).toBeVisible();
  const bus = map(page).getByLabel(/Bus 17997, heading/);
  await expect(bus).toHaveCount(1);
  await expect(bus.getByTestId('heading-arrow')).toBeVisible();
  await expect(map(page).locator('path[stroke-width="5"]')).not.toHaveCount(0);
  await expect(page.getByText(/UGA portal · Refreshes/)).toBeVisible();
  await page.getByRole('button', { name: new RegExp(start) }).first().click();
  await expect(page.getByRole('heading', { name: start })).toBeVisible();
  await expect(page.getByText(/3 min/).first()).toBeVisible();
  await button(page, 'Start a trip here').click();
  await expect(page).toHaveURL(/\/plan$/);
  await expect(input(page, 'Start')).toHaveValue(start);
});

test('a stale marker and the full feed warning are visible', async ({ page }) => {
  await mockTransit(page, { staleVehicles: true });
  await page.goto('/routes/5750');
  await expect(map(page).getByLabel(/Bus 17997.*last known position/)).toHaveCount(1);
  await button(page, 'Travel notes').click();
  await expect(page.getByText('GPS >2 min / time unknown')).toBeVisible();
  await button(page, 'Show full text').click();
  await expect(page.getByText(/positions are older than two minutes/)).toBeVisible();
});

test('the route picks a better source before the next map update', async ({ page }) => {
  const { data } = await mockTransit(page, { passio: true });
  const passioBus = Object.values(ugaPassioFixture.buses.buses).flat().find(bus => String(bus.routeId) === '44886')!;
  let current = false;
  let probes = 0;
  await page.route('**/api?url=*', route => {
    const target = new URL(new URL(route.request().url()).searchParams.get('url')!);
    if (target.searchParams.get('getBuses') !== '1') return route.fallback();
    probes++;
    return route.fulfill({ json: { buses: { central: [{ ...passioBus, busId: 78901, outdated: current ? 0 : 1 }] } } });
  });
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.goto('/routes/5750');
  await expect(map(page).getByLabel(/Bus 17997, heading/)).toHaveCount(1);
  await expect.poll(() => probes).toBe(3);
  data.ugaVehicles[0].lastUpdate -= 121_000;
  current = true;
  await page.clock.runFor(10_100);
  await expect.poll(() => probes).toBe(6);
  await expect(map(page).getByLabel(/Bus 17997, heading/)).toHaveCount(1);
  await page.clock.runFor(5000);
  await expect(map(page).getByLabel(/Bus passio:78901, heading/)).toHaveCount(1);
  await expect(map(page).getByLabel(/Bus 17997, heading/)).toHaveCount(0);
});

test('the shared planner uses route data and draws the itinerary', async ({ page }) => {
  const { calls } = await mockTransit(page);
  await page.goto('/plan');
  await tripPoints(page);
  await button(page, 'Find quickest bus trip').click();
  await expect(page.getByText('QUICKEST ESTIMATED CONNECTION')).toBeVisible();
  await expect(page.getByText(/transfers? · .*walking/)).toBeVisible();
  await expect(map(page).getByLabel(/^Start:/)).toHaveCount(1);
  await expect(map(page).getByTestId('heading-arrow')).not.toHaveCount(0);
  expect(calls.some(url => url.includes('routeTracking_5750'))).toBe(true);
  await button(page, 'How this estimate works').click();
  await expect(button(page, 'Hide notes')).toBeVisible();
  await input(page, 'Start').fill('33.93, -83.37');
  await expect(page.getByText('QUICKEST ESTIMATED CONNECTION')).toHaveCount(0);
});

test('a transfer trip keeps its transfer visible and clips its route traces', async ({ page }) => {
  await mockTransit(page, { transfer: true, noVehicles: true });
  await page.goto('/plan');
  await input(page, 'Start').fill('33.95, -83.41');
  await input(page, 'Destination').fill('33.95, -83.35');
  await button(page, '800 m').click();
  await button(page, 'Find quickest bus trip').click();
  await expect(page.getByText(/1 transfers? ·/)).toBeVisible();
  await expect(map(page).getByLabel('Transfer at Change Stop')).toHaveCount(1);
  await expect(map(page).locator('path[stroke-width="5"], path[stroke-width="4"]')).toHaveCount(2);
});

test('in-flight calculation disables the fields and announces progress', async ({ page }) => {
  await mockTransit(page);
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api?url=*', async route => {
    if (new URL(route.request().url()).searchParams.get('url')?.includes('routeTracking_')) await waiting;
    return route.fallback();
  });
  await page.goto('/plan');
  await tripPoints(page);
  await button(page, 'Find quickest bus trip').click();
  await expect(button(page, 'Calculating route…')).toHaveAttribute('aria-busy', 'true');
  await expect(input(page, 'Start')).toBeDisabled();
  release();
  await expect(page.getByText('QUICKEST ESTIMATED CONNECTION')).toBeVisible();
  await expect(input(page, 'Start')).toBeEnabled();
});

test('coordinates can be selected on the map and swapped', async ({ page }) => {
  await mockTransit(page);
  await page.goto('/plan');
  await button(page, 'Pick start').click();
  await map(page).click({ position: { x: 100, y: 100 } });
  await expect(input(page, 'Start')).not.toHaveValue('');
  await button(page, 'Pick destination').click();
  await map(page).click({ position: { x: 145, y: 155 } });
  await expect(input(page, 'Destination')).not.toHaveValue('');
  const start = await input(page, 'Start').inputValue();
  const end = await input(page, 'Destination').inputValue();
  expect(start).not.toBe(end);
  await button(page, 'Swap points').click();
  await expect(input(page, 'Start')).toHaveValue(end);
  await expect(input(page, 'Destination')).toHaveValue(start);
});

test('offers address suggestions and only searches through the gateway', async ({ page }) => {
  await mockTransit(page);
  let query: string | undefined;
  await page.route('**/api/places', async route => {
    query = route.request().postDataJSON().query;
    expect(route.request().method()).toBe('POST');
    return route.fulfill({ json: { type: 'FeatureCollection', features: [{
      type: 'Feature', geometry: { type: 'Point', coordinates: [-83.37, 33.94] }, properties: { name: 'Test address' },
    }] } });
  });
  await page.goto('/plan');
  await input(page, 'Start').fill('Example street');
  await page.getByRole('button', { name: /Test address/ }).click();
  await expect(input(page, 'Start')).toHaveValue('Test address');
  expect(query).toBe('Example street');
});

test('stop suggestions support keyboard selection', async ({ page }) => {
  await mockTransit(page);
  await page.goto('/plan');
  await input(page, 'Destination').fill('Wray St');
  await expect(page.getByRole('button', { name: /Wray St.*Bus stop/ }).first()).toBeVisible();
  await input(page, 'Destination').press('ArrowDown');
  await input(page, 'Destination').press('Enter');
  await expect(input(page, 'Destination')).not.toHaveValue('Wray St');
});

test('map location uses explicit permission and preserves the trip inputs', async ({ page, context }) => {
  await mockTransit(page);
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 33.945, longitude: -83.385, accuracy: 20 });
  await page.goto('/plan');
  await tripPoints(page);
  const from = await input(page, 'Start').inputValue();
  await button(page, 'Show my location').click();
  await expect(map(page).getByLabel('Your location')).toHaveCount(1);
  await expect(input(page, 'Start')).toHaveValue(from);
  await button(page, 'My location').click();
  await expect(input(page, 'Start')).toHaveValue('Current location');
});

test('route lock starts on and persists across a reload', async ({ page }) => {
  await mockTransit(page);
  await page.goto('/routes/5750');
  await expect(button(page, 'Route lock on')).toBeVisible();
  await button(page, 'Route lock on').click();
  await expect(button(page, 'Route lock off')).toBeVisible();
  await page.reload();
  await expect(button(page, 'Route lock off')).toBeVisible();
});

test('the shared zoom control respects route lock and resumes wider zoom when unlocked', async ({ page }) => {
  await mockTransit(page);
  await page.goto('/routes/5750');
  const trace = map(page).locator('path[stroke-width="5"]').first();
  await expect(trace).toBeVisible();
  const overview = await trace.getAttribute('d');
  await button(page, 'Zoom out').click();
  await expect(trace).toHaveAttribute('d', overview!);
  await button(page, 'Route lock on').click();
  await button(page, 'Zoom out').click();
  await expect(trace).not.toHaveAttribute('d', overview!);
});

test('network discovery and authority code selection keep the chosen network', async ({ page }) => {
  const { calls } = await mockTransit(page);
  await page.goto('/networks');
  await expect(page.getByRole('radio', { name: /CATA/ })).toBeVisible();
  await input(page, 'Authority code').fill('CATA');
  await button(page, 'Look up code').click();
  await expect.poll(() => calls.some(url => url.includes('includeHiddenPropertyCode'))).toBe(true);
  await page.getByRole('radio', { name: /CATA/ }).click();
  await expect(page).toHaveURL(/\/routes$/);
  await expect(page.getByRole('button', { name: /Red Link/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /Red Link/ })).toBeVisible();
});

test('saved dark mode applies to the same catalog and map', async ({ page }) => {
  await mockTransit(page);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/networks');
  await button(page, 'Dark mode off').click();
  await expect(button(page, 'Dark mode on')).toBeVisible();
  await page.goto('/routes/5750');
  await expect(map(page)).toBeVisible();
  await expect(map(page).locator('.leaflet-layer').first()).toHaveCSS('filter', 'brightness(0.48) saturate(0.35)');
});

test('providers and opt-in trip comparison remain available', async ({ page }) => {
  const { calls } = await mockTransit(page, { passio: true });
  await page.goto('/networks');
  await button(page, 'Show data sources').click();
  await button(page, 'Provider information').click();
  await expect(page.getByText(/System 3994/)).toBeVisible();
  await page.goto('/plan');
  await tripPoints(page);
  expect(calls.some(url => new URL(url).searchParams.get('walk') === '2')).toBe(false);
  await button(page, 'Request provider comparison').click();
  await expect.poll(() => calls.some(url => new URL(url).searchParams.get('walk') === '2')).toBe(true);
  await expect(page.getByText(/Operator suggestions are a separate comparison/)).toBeVisible();
});

test('preserves favorites from the previous browser app', async ({ page }) => {
  await mockTransit(page);
  await page.addInitScript(() => {
    localStorage.setItem('tranuga.favorites.v1', JSON.stringify([JSON.stringify(['uga', 'uga', '5750'])]));
  });
  await page.goto('/routes');
  await expect(button(page, 'Remove A|CE from favorites')).toBeVisible();
});

test('catalog errors have a working retry', async ({ page }) => {
  const options = { failRoutes: true };
  await mockTransit(page, options);
  await page.goto('/routes');
  await expect(page.getByText(/All available transit sources failed/)).toBeVisible();
  options.failRoutes = false;
  await button(page, 'Refresh routes').click();
  await expect(page.getByText('2 of 2 routes')).toBeVisible();
});

test('verified static stops support a trip when live tracking fails', async ({ page }) => {
  await mockTransit(page, { failTracking: true });
  await page.goto('/routes/5750');
  await button(page, 'Travel notes').click();
  await expect(page.getByText(/Static stops · service unconfirmed/)).toBeVisible();
  await page.goto('/plan');
  await input(page, 'Start').fill('33.948,-83.377');
  await input(page, 'Destination').fill('33.95,-83.38');
  await button(page, 'Find quickest bus trip').click();
  await expect(page.getByText('QUICKEST ESTIMATED CONNECTION')).toBeVisible();
});

test('the Ohio network exposes fleet search and stop timetables', async ({ page }) => {
  const { calls } = await mockTransit(page, { passio: true });
  await page.goto('/networks');
  await page.getByRole('radio', { name: /Athens Public Transit · Ohio/ }).click();
  await expect(page.getByText('3 of 3 routes')).toBeVisible();
  await page.goto('/routes/66949');
  await input(page, 'Bus fleet number').fill('2100');
  await button(page, 'Find bus').click();
  await expect.poll(() => calls.some(url => url.includes('getBuses=2'))).toBe(true);
  await expect(page.getByText(/Bus .* · Route .* · /).first()).toBeVisible();
  await page.getByRole('button', { name: /Berkley Turnaround/ }).click();
  await button(page, 'Provider timetable').click();
  await expect(page.getByText(/Provider clock times/)).toBeVisible();
  expect(calls.some(url => url.includes('schedule=4'))).toBe(true);
});

test('invalid and unreachable trips show how to recover', async ({ page }) => {
  await mockTransit(page);
  await page.goto('/plan');
  await button(page, 'Find quickest bus trip').click();
  await expect(page.getByText(/Choose a start and destination/)).toBeVisible();
  await input(page, 'Start').fill('35, -84');
  await input(page, 'Destination').fill('33.95, -83.38');
  await button(page, 'Find quickest bus trip').click();
  await expect(page.getByText(/origin is outside walking range/)).toBeVisible();
  await expect(button(page, 'Find quickest bus trip')).toBeEnabled();
});

test('browser history restores the same screens as direct links', async ({ page }) => {
  await mockTransit(page);
  await page.goto('/plan');
  await page.getByRole('tab', { name: 'Routes' }).click();
  await page.getByRole('button', { name: /Central East, Active service/ }).click();
  await expect(page).toHaveURL(/\/routes\/5750$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/routes$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/plan$/);
  await expect(input(page, 'Start')).toBeVisible();
});
