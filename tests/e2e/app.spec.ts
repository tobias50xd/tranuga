import { test, expect, type Page } from '@playwright/test';
import fixture from '../fixtures/api-contracts.json' with { type: 'json' };

type MockOptions = { failRoutes?: boolean; noVehicles?: boolean; staleVehicles?: boolean; failTracking?: boolean };
const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => { const errors: string[] = []; pageErrors.set(page, errors); page.on('pageerror', error => errors.push(error.message)); });
test.afterEach(({ page }) => { expect(pageErrors.get(page)).toEqual([]); });
async function mockTransit(page: Page, options: MockOptions = {}) {
  const calls: string[] = [];
  const data = structuredClone(fixture);
  data.ugaVehicles.forEach(bus => { bus.lastUpdate = options.staleVehicles ? Date.now() - 360000 : Date.now(); });
  data.ugaTracking.forEach((stop, i) => { stop.times = [Date.now() + 300000 + i * 60000]; });
  data.ugaStop.forEach(stop => { stop.times = [Date.now() + 180000]; });
  await page.route('https://tile.openstreetmap.org/**', route => route.abort());
  await page.route('**/api?url=*', async route => {
    const url = new URL(route.request().url()).searchParams.get('url')!;
    calls.push(url); const path = new URL(url).pathname;
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

test('first page lists every route, searches, filters and refreshes', async ({ page }) => {
  const { calls } = await mockTransit(page);
  await page.goto('/');
  await expect(page.locator('.route-card')).toHaveCount(2);
  await expect(page.locator('#route-count')).toContainText('2 routes · 1 active');
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
  const stops = data.ugaTracking;
  const from = stops[0].stop, to = stops[8].stop;
  await page.getByRole('textbox', { name: 'Start', exact: true }).fill(`${from.latitude}, ${from.longitude}`);
  await page.getByRole('textbox', { name: 'Destination', exact: true }).fill(`${to.latitude}, ${to.longitude}`);
  await page.getByRole('button', { name: 'Find quickest bus trip' }).click();
  await expect(page.locator('.trip-summary')).toContainText('QUICKEST ESTIMATED CONNECTION');
  await expect(page.locator('.journey-leg.ride')).not.toHaveCount(0);
  await expect(page.locator('.assumptions')).toBeVisible();
  await expect(page.locator('.leaflet-overlay-pane path').first()).toBeVisible();
  expect(calls.some(url => url.includes('routeTracking_5750'))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('map picking and swapping fill both coordinate fields', async ({ page }) => {
  await mockTransit(page); await page.goto('/'); await page.locator('nav [data-nav="plan"]').click();
  await page.locator('#pick-origin').click();
  await page.locator('#trip-map').click({ position: { x: 110, y: 150 } });
  await expect(page.locator('#trip-origin')).not.toHaveValue('');
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
  await expect(page.locator('#trip-origin')).toHaveValue('33.94800, -83.37700');
  await page.evaluate(() => { navigator.geolocation.getCurrentPosition = (_ok, fail) => fail?.({ code: 1 } as GeolocationPositionError); });
  await page.getByRole('button', { name: 'My location' }).click();
  await expect(page.getByRole('alert')).toContainText('permission was denied');
});

test('validates coordinates and reports unreachable destinations', async ({ page }) => {
  await mockTransit(page); await page.goto('/'); await page.locator('nav [data-nav="plan"]').click();
  await page.getByRole('textbox', { name: 'Start', exact: true }).fill('bad'); await page.getByRole('textbox', { name: 'Destination', exact: true }).fill('0,0');
  await page.getByRole('button', { name: 'Find quickest bus trip' }).click();
  await expect(page.getByRole('alert')).toContainText('valid latitude');
  await page.getByRole('textbox', { name: 'Start', exact: true }).fill('0,0');
  await page.getByRole('button', { name: 'Find quickest bus trip' }).click();
  await expect(page.locator('#trip-result')).toContainText('No bus connection found');
});

test('failed live topology is excluded from planning and static map fallback is labeled', async ({ page }) => {
  await mockTransit(page, { failTracking: true });
  await page.goto('/'); await page.locator('[data-route="5750"]').click();
  await expect(page.locator('#route-warnings')).toContainText('Showing static stops');
  await page.locator('nav [data-nav="plan"]').click();
  await page.getByRole('textbox', { name: 'Start', exact: true }).fill('33.948,-83.377'); await page.getByRole('textbox', { name: 'Destination', exact: true }).fill('33.95,-83.38');
  await page.getByRole('button', { name: 'Find quickest bus trip' }).click();
  await expect(page.locator('#trip-status')).toContainText('excluded from planning');
  await expect(page.locator('#trip-result')).toContainText('No bus connection found');
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
  await page.getByRole('textbox', { name: 'Start', exact: true }).fill(`${from.latitude}, ${from.longitude}`);
  await page.getByRole('textbox', { name: 'Destination', exact: true }).fill(`${to.latitude}, ${to.longitude}`);
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
