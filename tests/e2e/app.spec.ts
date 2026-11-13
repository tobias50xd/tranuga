import { test, expect, type Page } from '@playwright/test';
import fixture from '../fixtures/api-contracts.json' with { type: 'json' };
import ohioFixture from '../fixtures/passio-ohio.json' with { type: 'json' };
import ugaPassioFixture from '../fixtures/passio-uga.json' with { type: 'json' };
import passioExtras from '../fixtures/passio-extras.json' with { type: 'json' };

type MockOptions = { outsideVehicle?: boolean; failRoutes?: boolean; noVehicles?: boolean; staleVehicles?: boolean; failTracking?: boolean; passio?: boolean; failedMirrors?: string[] };
const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => { const errors: string[] = []; pageErrors.set(page, errors); page.on('pageerror', error => errors.push(error.message)); });
test.afterEach(({ page }) => { expect(pageErrors.get(page)).toEqual([]); });
async function mockTransit(page: Page, options: MockOptions = {}) {
  const calls: string[] = [];
  const data = structuredClone(fixture);
  data.ugaVehicles.forEach(bus => { bus.lastUpdate = options.staleVehicles ? Date.now() - 360000 : Date.now(); });
  if (options.outsideVehicle) data.ugaVehicles.push({ ...data.ugaVehicles[0], id:'999999', name:'Outside bus', latitude:39.33, longitude:-82.1 });
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
      result = data.ugaTracking;
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

async function unlockAthens(page: Page) {
  const button = page.getByRole('button', { name:/^Athens lock/ });
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
  await page.getByRole('button', { name: 'My location' }).click();
  await expect(page.locator('#trip-origin')).toHaveValue('Current location');
  await page.evaluate(() => { navigator.geolocation.getCurrentPosition = (_ok, fail) => fail?.({ code: 1 } as GeolocationPositionError); });
  await page.getByRole('button', { name: 'My location' }).click();
  await expect(page.getByRole('alert')).toContainText('permission was denied');
});

test('validates coordinates and reports unreachable destinations', async ({ page }) => {
  await mockTransit(page); await page.goto('/'); await unlockAthens(page); await page.locator('nav [data-nav="plan"]').click();
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
  await expect(page.locator('#trip-status')).toContainText('verified static stop order');
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
  const { calls } = await mockTransit(page); await page.goto('/'); await unlockAthens(page); await page.getByRole('button', { name: 'Networks', exact: true }).click();
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
  await expect(page.locator('#trip-origin')).toBeDisabled();
  await expect(page.locator('#swap')).toBeDisabled();
  release();
  await expect(page.locator('.trip-summary')).toBeVisible();
  await expect(page.locator('#trip-origin')).toBeEnabled();
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
  await page.goto('/'); await unlockAthens(page); await page.getByRole('button', { name: 'Networks', exact: true }).click();
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
  await page.goto('/'); await unlockAthens(page);await page.getByRole('button',{name:'Networks',exact:true}).click();await page.locator('#select-ohio').click();
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
  await page.goto('/'); await unlockAthens(page);await page.getByRole('button',{name:'Networks',exact:true}).click();await page.locator('#select-ohio').click();
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
  await expect(page.locator('#trip-status')).toContainText('Backup data');
});

test('provider metadata, fleet search, timetable and explicit trip comparison use the extracted reads',async({page})=>{
  const {calls}=await mockTransit(page,{passio:true});await page.goto('/'); await unlockAthens(page);
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
  await expect(freshness.getByRole('heading')).toHaveText('Check the update time');
  await expect(freshness.locator('svg')).toHaveAttribute('aria-hidden', 'true');
  await freshness.getByText('Source details', { exact: true }).click();
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
  await expect(page.getByRole('button', { name:/^Athens lock/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name:/^Dark mode/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await unlockAthens(page); await expect(page.getByRole('button', { name:/^Athens lock/ })).toHaveAttribute('aria-pressed', 'false');
});

test('Athens lock starts on, limits networks and avoids the global authority directory', async ({ page }) => {
  const { calls } = await mockTransit(page);
  await page.goto('/'); await expect(page.getByRole('button', { name:/^Athens lock/ })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('nav [data-nav="agencies"]').click();
  await expect(page.locator('#select-ohio')).toBeHidden(); await expect(page.locator('.network-tools')).toBeHidden();
  await expect(page.locator('.agency-card')).toHaveCount(1); await expect(page.locator('.agency-card')).toContainText('Athens-Clarke County');
  expect(calls.some(url => url.includes('TransitAuthorities'))).toBe(false);
  await unlockAthens(page); await expect(page.locator('#select-ohio')).toBeVisible();
  await expect(page.locator('.agency-card')).toContainText('CATA');
  await page.reload(); await expect(page.getByRole('button', { name:/^Athens lock/ })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#select-ohio')).toBeVisible();
});

test('out-of-Athens buses stay out of counts and markers during loading and polling', async ({ page }) => {
  await mockTransit(page, { outsideVehicle:true }); await page.clock.install();
  await page.goto('/routes/5750');
  await expect(page.locator('.bus-marker')).toHaveCount(1); await expect(page.locator('.vehicle-card')).toHaveCount(1);
  await expect(page.locator('#detail-stats strong')).toHaveText('1');
  await page.clock.fastForward(16000); await expect(page.locator('.bus-marker')).toHaveCount(1);
  await unlockAthens(page); await expect(page.locator('.vehicle-card')).toHaveCount(2); await expect(page.locator('.bus-marker')).toHaveCount(2);
  await page.getByRole('button', { name:/^Athens lock/ }).click();
  await expect(page.locator('.bus-marker')).toHaveCount(1); await expect(page.locator('.vehicle-card')).toHaveCount(1);
});

test('turning Athens lock on from Ohio returns to Georgia and clears foreign trip points', async ({ page }) => {
  await mockTransit(page, { passio:true }); await page.goto('/'); await unlockAthens(page);
  await page.locator('nav [data-nav="agencies"]').click(); await page.locator('#select-ohio').click();
  await expect(page.locator('[data-route="66949"]')).toBeVisible();
  await page.locator('nav [data-nav="plan"]').click(); await page.locator('#trip-origin').fill('39.33,-82.1'); await page.locator('#trip-destination').fill('39.32,-82.11');
  await page.getByRole('button', { name:/^Athens lock/ }).click();
  await expect(page.locator('#agency-name')).toContainText('Georgia'); await expect(page.locator('[data-route="66949"]')).toHaveCount(0);
  await page.locator('nav [data-nav="plan"]').click(); await expect(page.locator('#trip-origin')).toHaveValue(''); await expect(page.locator('#trip-destination')).toHaveValue('');
});

test('Athens lock filters address hints and blocks foreign typed or current-location endpoints', async ({ page, context }) => {
  const { calls } = await mockTransit(page);
  await context.grantPermissions(['geolocation']); await context.setGeolocation({ latitude:39.33, longitude:-82.1 });
  await page.route('**/api/places', route => route.fulfill({ json:{ type:'FeatureCollection', features:[
    { type:'Feature', geometry:{ type:'Point', coordinates:[-82.1,39.33] }, properties:{ name:'Ohio landmark' } },
    { type:'Feature', geometry:{ type:'Point', coordinates:[-83.377,33.948] }, properties:{ name:'Local landmark' } },
  ] } }));
  await page.goto('/plan'); await page.locator('#trip-origin').fill('Remote address');
  await expect(page.locator('#trip-origin-hints [role="option"]')).toHaveCount(1);
  await expect(page.locator('#trip-origin-hints')).toContainText('Local landmark');
  await page.locator('#trip-origin-hints [role="option"]').click();
  await page.locator('#trip-destination').fill('39.33,-82.1'); await page.getByRole('button', { name:'Find quickest bus trip' }).click();
  await expect(page.locator('#trip-status')).toContainText('Athens lock is on');
  expect(calls.some(url => url.includes('routeTracking_'))).toBe(false);
  await page.getByRole('button', { name:'My location' }).click(); await expect(page.locator('#trip-status')).toContainText('outside Athens, Georgia');
  await expect(page.locator('#trip-origin')).toHaveValue('Local landmark');
  await unlockAthens(page); await page.getByRole('button', { name:'My location' }).click(); await expect(page.locator('#trip-origin')).toHaveValue('Current location');
});

test('locked maps stop at the whole-Athens overview, stay bounded on resize, and unlock zoom', async ({ page }) => {
  await mockTransit(page); await page.goto('/plan');
  await page.locator('#trip-origin').fill('33.86,-83.54'); await page.locator('#trip-destination').fill('34.1,-83.24');
  async function overview() {
    const out = page.locator('.leaflet-control-zoom-out');
    for (let i=0;i<20 && await out.getAttribute('aria-disabled') !== 'true';i++) await out.click();
    await expect(out).toHaveAttribute('aria-disabled', 'true');
    const map = (await page.locator('#trip-map').boundingBox())!;
    const a = (await page.locator('.point-marker').nth(0).boundingBox())!, b = (await page.locator('.point-marker').nth(1).boundingBox())!;
    for (const marker of [a,b]) { const x = marker.x + 15, y = marker.y + 36; expect(x).toBeGreaterThanOrEqual(map.x-1); expect(x).toBeLessThanOrEqual(map.x+map.width+1); expect(y).toBeGreaterThanOrEqual(map.y-1); expect(y).toBeLessThanOrEqual(map.y+map.height+1); }
    // At least one city dimension fills most of the viewport, preventing a world-scale minimum.
    expect(Math.max(Math.abs(a.x-b.x)/map.width, Math.abs(a.y-b.y)/map.height)).toBeGreaterThan(.75);
  }
  await overview();
  await page.locator('#trip-map').focus(); await page.locator('#trip-map').press('-'); await expect(page.locator('.leaflet-control-zoom-out')).toHaveAttribute('aria-disabled', 'true');
  await page.setViewportSize({ width:520, height:900 }); await overview();
  await unlockAthens(page);
  for (let i=0;i<10;i++) await page.locator('.leaflet-control-zoom-out').click();
  await expect(page.locator('.leaflet-control-zoom-out')).toHaveAttribute('aria-disabled', 'false');
});
