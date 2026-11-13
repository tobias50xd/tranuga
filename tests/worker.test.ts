import { describe, expect, it, vi } from 'vitest';
import { APPROVED_REST_BASES, createGateway, validateUpstream, type Env, type GatewayCache } from '../worker/index';

const BASE = 'https://realtime.catabus.com/InfoPoint/rest';
const env: Env = { ASSETS: { fetch: async () => new Response('<html>static app</html>', { headers: { 'Content-Type': 'text/html' } }) } };
const request = (url: string, init?: RequestInit) => new Request('https://tranuga.example/api?url=' + encodeURIComponent(url), init);
const jsonFetch = () => vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }, { headers: { 'Set-Cookie': 'ignored=secret', Date: 'Thu, 12 Nov 2026 23:00:00 GMT' } }));
const PASSIO = 'https://passiogo.com';
const passioRequest = (path: string, body: unknown, origin = PASSIO) => request(origin + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

describe('approved upstream endpoint policy', () => {
  it.each([
    'https://my.uga.edu/v4_19/cache/Routes',
    'https://my.uga.edu/v4_19/cache/Buses',
    'https://my.uga.edu/v4_19/cache/routeTracking_5750',
    'https://my.uga.edu/v4_19/cache/stop_155104',
    'https://my.uga.edu/v4_19/cache/stop_c1',
    'https://my.uga.edu/v4_19/cache/stop_c243',
    'https://d1dhvjc4b8xlgl.cloudfront.net/mobile-bus-data/version.json',
    'https://d1dhvjc4b8xlgl.cloudfront.net/mobile-bus-data/busData.json',
    'http://mobilegateway.rideralerts.com/gateway/TransitAuthorities',
    'http://mobilegateway.rideralerts.com/gateway/TransitAuthorities/Locate?Lat=33.95&long=-83.37',
    'http://mobilegateway.rideralerts.com/gateway/TransitAuthorities/?includeHiddenPropertyCode=%40CATA',
    BASE + '/TransitAuthorityConfig/Get',
    BASE + '/Routes/GetAllRoutes',
    BASE + '/Routes/GetVisibleRoutes',
    BASE + '/RouteDetails/Get/51',
    BASE + '/RouteDetails/GetAllRouteDetails',
    BASE + '/RouteDetails/GetDirectionsByRouteID/51',
    BASE + '/RouteDetails/GetStopsForRouteDirection/?routeid=51&direction=0&timepointsOnly=false',
    BASE + '/Stops/GetAllStops',
    BASE + '/Stops/GetAllStopsForRoutes?routeIDs=51,52',
    BASE + '/Stops/Get/1',
    BASE + '/StopDepartures/Get/1',
    BASE + '/PublicMessages/GetCurrentMessages',
    'https://realtime.catabus.com:443/InfoPoint/Resources/Traces/Route51.kml',
  ])('allows documented endpoint %s', (url) => { expect(validateUpstream(url)).toBeDefined(); });

  it('uses a committed registry covering the observed authorities including Athens', () => {
    expect(APPROVED_REST_BASES.length).toBeGreaterThan(60);
    expect(APPROVED_REST_BASES).toContain('https://bustracker.accgov.com/InfoPoint/rest');
  });

  it.each([
    'https://127.0.0.1/InfoPoint/rest/Routes/GetAllRoutes',
    'https://169.254.169.254/latest/meta-data',
    'http://localhost/InfoPoint/rest/Routes/GetAllRoutes',
    'https://evil.example/InfoPoint/rest/Routes/GetAllRoutes',
    'https://my.uga.edu.evil.example/v4_19/cache/Routes',
    'https://user:password@my.uga.edu/v4_19/cache/Routes',
    'https://my.uga.edu:444/v4_19/cache/Routes',
    'https://my.uga.edu/v4_19/cache/Routes?secret=1',
    'https://my.uga.edu/v4_19/cache/routeTracking_c1',
    'https://my.uga.edu/v4_19/cache/stop_cc1',
    'https://my.uga.edu/v4_19/cache/stop_c',
    'https://my.uga.edu/v4_19/cache/stop_C1',
    'https://my.uga.edu/v4_19/cache/stop_c1/extra',
    'https://my.uga.edu/v4_19/cache/stop_c1?extra=true',
    'https://my.uga.edu.evil.example/v4_19/cache/stop_c1',
    'https://my.uga.edu/v4_19/cache/Routes#fragment',
    'http://my.uga.edu/v4_19/cache/Routes',
    'file:///etc/passwd',
    'https://realtime.catabus.com/InfoPoint/rest/OtherEndpoint',
    'https://realtime.catabus.com/InfoPoint/rest/Routes/GetAllRoutes?anything=true',
    BASE + '/RouteDetails/GetStopsForRouteDirection/?routeid=51&direction=0&timepointsOnly=true',
    BASE + '/Stops/GetAllStopsForRoutes?routeIDs=51&routeIDs=52',
    BASE + '/Stops/GetAllStopsForRoutes?routeIDs=invalid',
    'http://mobilegateway.rideralerts.com/gateway/TransitAuthorities/Locate?Lat=91&long=0',
    'http://mobilegateway.rideralerts.com/gateway/TransitAuthorities/Locate?Lat=&long=0',
    'http://mobilegateway.rideralerts.com/gateway/TransitAuthorities/Locate?Lat=0&Long=0',
    'http://mobilegateway.rideralerts.com/gateway/TransitAuthorities/?includeHiddenPropertyCode=missing-at',
    'https://realtime.catabus.com/InfoPoint/Resources/Traces/secret.json',
    'https://realtime.catabus.com/InfoPoint/Resources/Traces/nested/route.kml',
    'https://realtime.catabus.com/InfoPoint/Resources/Traces/%2e%2e%2froute.kml',
    'https://realtime.catabus.com/InfoPoint/rest%2fRoutes/GetAllRoutes',
  ])('rejects non-approved destination %s', (url) => { expect(validateUpstream(url)).toBeUndefined(); });
});

describe('Passio read-only query policy', () => {
  const origins = [PASSIO, 'https://replicated2of3.passiogo.com', 'https://replicated3of3.passiogo.com'];
  const posts = [
    ['/mapGetData.php?getRoutes=1', { systemSelected0: '5842', amount: 1 }],
    ['/mapGetData.php?getStops=2&withOutdated=1&wBounds=1&showBusInOos=0', { s0: '5842', sA: 1 }],
    ['/mapGetData.php?getBuses=1&speed=1', { s0: '5842', sA: 1 }],
    ['/mapGetData.php?getBuses=2', { s0: '5842', sA: 1 }],
    ['/goServices.php?getAlertMessages=1&alertCRC=na&noOptions=1', { systemSelected0: '5842', amount: 1, routesAmount: 0 }],
  ] as const;

  for (const origin of origins) {
    it.each(posts)('forwards only the confirmed read query %s on ' + origin, async (path, body) => {
      const fetcher = jsonFetch();
      const result = await createGateway({ fetcher })(passioRequest(path, body, origin), env);
      expect(result.status).toBe(200);
      const options = fetcher.mock.calls[0]![1]!;
      expect(options.method).toBe('POST');
      expect(options.headers).toEqual({ Accept: 'application/json', 'Content-Type': 'application/json' });
      expect(JSON.parse(options.body as string)).toEqual(body);
      expect(options.redirect).toBe('manual');
    });

    it('allows single and batch stop ETAs for the two verified agencies on ' + origin, () => {
      for (const agencyId of ['5842', '3994']) {
        expect(validateUpstream(origin + `/mapGetData.php?eta=3&stopIds=190923&routeId=66949&position=1&userId=${agencyId}`)).toBeDefined();
        expect(validateUpstream(origin + `/mapGetData.php?eta=3&stopIds=190923,190985&userId=${agencyId}`)).toBeDefined();
      }
    });
  }

  it.each([
    '/mapGetData.php?getRoutes=2',
    '/mapGetData.php?getRoutes=1&deviceId=tracking-id',
    '/mapGetData.php?getRoutes=1&debug=1',
    '/mapGetData.php?getRoutes=1&credentials=1',
    '/mapGetData.php?getRoutes=1&getRoutes=1',
    '/mapGetData.php?getStops=2&withOutdated=1&wBounds=1&showBusInOos=1',
    '/mapGetData.php?getBuses=1&speed=2',
    '/mapGetData.php?getBuses=3',
    '/goServices.php?getAlertMessages=1&alertCRC=secret&noOptions=1',
    '/goServices.php?requestRide=1',
    '/mapGetData.php?update=1',
    '/replicated2of3/mapGetData.php?getRoutes=1',
  ])('rejects non-approved Passio actions and parameters %s', (path) => {
    expect(validateUpstream(PASSIO + path, 'POST')).toBeUndefined();
  });

  it.each([
    'https://replicated4of4.passiogo.com/mapGetData.php?getRoutes=1',
    'https://athenstransit.passiogo.com/mapGetData.php?getRoutes=1',
    'http://passiogo.com/mapGetData.php?getRoutes=1',
    'https://passiogo.com.evil.example/mapGetData.php?getRoutes=1',
    'https://user@replicated2of3.passiogo.com/mapGetData.php?getRoutes=1',
  ])('does not expand the allowlist to %s', (url) => {
    expect(validateUpstream(url, 'POST')).toBeUndefined();
  });

  it.each([
    '?eta=3&stopIds=190923&userId=9999',
    '?eta=3&stopIds=190923&userId=5842&deviceId=tracking-id',
    '?eta=3&stopIds=not-a-number&userId=5842',
    '?eta=3&stopIds=190923&routeId=writeAction&userId=5842',
    '?eta=3&stopIds=190923&position=-1&userId=5842',
    '?eta=3&stopIds=190923&position=0&userId=5842',
    '?eta=4&stopIds=190923&userId=5842',
    '?eta=3&stopIds=190923&userId=5842&userId=3994',
    '?eta=3&stopIds=' + Array(41).fill('190923').join(',') + '&userId=5842',
  ])('rejects invalid or excessive ETA parameters %s', (search) => {
    expect(validateUpstream(PASSIO + '/mapGetData.php' + search)).toBeUndefined();
  });

  it('enforces the upstream method independently of the endpoint action', async () => {
    const fetcher = jsonFetch(); const gateway = createGateway({ fetcher });
    const getPostQuery = await gateway(request(PASSIO + '/mapGetData.php?getRoutes=1'), env);
    expect(getPostQuery.status).toBe(405); expect(getPostQuery.headers.get('Allow')).toBe('POST');
    const postGetQuery = await gateway(passioRequest('/mapGetData.php?eta=3&stopIds=190923&userId=5842', {}), env);
    expect(postGetQuery.status).toBe(405); expect(postGetQuery.headers.get('Allow')).toBe('GET');
    expect((await gateway(request(PASSIO + '/mapGetData.php?getRoutes=1', { method: 'DELETE' }), env)).status).toBe(405);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    {}, [], null, 'read',
    { systemSelected0: '9999', amount: 1 },
    { systemSelected0: 5842, amount: 1 },
    { systemSelected0: '5842', amount: '1' },
    { systemSelected0: '5842', amount: 2 },
    { systemSelected0: '5842', systemSelected1: '3994', amount: 1 },
    { systemSelected0: '5842', amount: 1, action: 'write' },
    { systemSelected0: '5842', amount: 1, deviceId: 'tracking-id' },
    { systemSelected0: '5842', amount: 1, routesAmount: 0 },
  ])('rejects body types, agencies, or fields outside the route-read schema: %j', async (body) => {
    const fetcher = jsonFetch();
    const result = await createGateway({ fetcher })(passioRequest('/mapGetData.php?getRoutes=1', body), env);
    expect(result.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('requires JSON, handles malformed bodies, and caps announced and streamed uploads', async () => {
    const fetcher = jsonFetch(); const gateway = createGateway({ fetcher });
    const url = PASSIO + '/mapGetData.php?getRoutes=1';
    expect((await gateway(request(url, { method: 'POST', body: 'amount=1&systemSelected0=5842' }), env)).status).toBe(415);
    expect((await gateway(request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' }), env)).status).toBe(400);
    expect((await gateway(request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': '99999' }, body: '{}' }), env)).status).toBe(413);
    expect((await gateway(request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filler: 'x'.repeat(8192) }) }), env)).status).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('separates cached POST bodies by agency while canonicalizing field and query order', async () => {
    const values = new Map<string, Response>();
    const cache: GatewayCache = {
      match: async key => values.get(key.url)?.clone(),
      put: async (key, response) => { expect(key.method).toBe('GET'); values.set(key.url, response); },
    };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => Response.json({ agency: JSON.parse(options!.body as string).s0 }));
    const gateway = createGateway({ fetcher, cache });
    const first = await gateway(passioRequest('/mapGetData.php?getBuses=1&speed=1', { s0: '5842', sA: 1 }), env);
    expect((await first.json()).agency).toBe('5842');
    const uga = await gateway(passioRequest('/mapGetData.php?getBuses=1&speed=1', { s0: '3994', sA: 1 }), env);
    expect((await uga.json()).agency).toBe('3994');
    expect(uga.headers.get('X-Transit-Cache')).toBe('MISS');
    const reordered = await gateway(passioRequest('/mapGetData.php?speed=1&getBuses=1', { sA: 1, s0: '5842' }), env);
    expect(reordered.headers.get('X-Transit-Cache')).toBe('HIT');
    expect((await reordered.json()).agency).toBe('5842');
    const mirrored = await gateway(passioRequest('/mapGetData.php?getBuses=1&speed=1', { s0: '5842', sA: 1 }, origins[1]), env);
    expect(mirrored.headers.get('X-Transit-Cache')).toBe('MISS');
    expect(fetcher).toHaveBeenCalledTimes(3);
    const keys = [...values.keys()];
    expect(new Set(keys).size).toBe(3);
    expect(keys.every(key => key.includes('method=POST') && /body=[a-f0-9]{64}$/.test(key))).toBe(true);
  });

  it('strips caller credentials and refuses redirects for read-only POST too', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 307, headers: { Location: 'https://evil.example/' } }));
    const result = await createGateway({ fetcher })(request(PASSIO + '/mapGetData.php?getRoutes=1', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer private', Cookie: 'private=1' },
      body: JSON.stringify({ systemSelected0: '3994', amount: 1 }),
    }), env);
    expect(result.status).toBe(502);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![1]!.headers).toEqual({ Accept: 'application/json', 'Content-Type': 'application/json' });
  });
});

describe('additional Passio public reads', () => {
  const walkBody = () => ({
    systems: { systemSelected0: '5842', amount: 1 }, routes: { amount: 0 },
    points: [{ lat: 39.295665, lng: -82.11205 }, { lat: 39.325428, lng: -82.101967 }], mode: 'transit',
  });
  const extras: readonly [string, unknown | undefined][] = [
    ['/mapGetData.php?getSystems=2&sortMode=1&credentials=1&acronymId=5842', undefined],
    ['/goServices.php?goWebVer=1', undefined],
    ['/mapGetData.php?getRoutes=2&sortMode=1&credentials=1', { systemSelected0: '5842', amount: 1 }],
    ['/mapGetData.php?schedule=4&routeId=66949&stopId=190923', undefined],
    ['/mapGetData.php?getBuses=2&search=2100', { s0: '5842', sA: 1 }],
    ['/mapGetData.php?walk=2', walkBody()],
  ];

  for (const origin of [PASSIO, 'https://replicated2of3.passiogo.com', 'https://replicated3of3.passiogo.com']) {
    it.each(extras)('supports the observed read %s on ' + origin, async (path, body) => {
      const fetcher = jsonFetch();
      const response = await createGateway({ fetcher })(body ? passioRequest(path, body, origin) : request(origin + path), env);
      expect(response.status).toBe(200);
      expect(fetcher.mock.calls[0]![1]!.method).toBe(body ? 'POST' : 'GET');
      if (body) expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual(body);
    });
  }

  it('caches static metadata and timetable reads for an hour', () => {
    for (const [path, body] of extras.slice(0, 4)) expect(validateUpstream(PASSIO + path, body ? 'POST' : 'GET')?.ttl).toBe(3600);
  });

  it.each([
    ['GET', '/mapGetData.php?getSystems=2&sortMode=1&credentials=1&acronymId=9999'],
    ['GET', '/mapGetData.php?getSystems=1&sortMode=1&credentials=1&acronymId=5842'],
    ['GET', '/mapGetData.php?getSystems=2&sortMode=1&credentials=1&acronymId=5842&deviceId=x'],
    ['GET', '/goServices.php?goWebVer=2'],
    ['GET', '/goServices.php?goWebVer=1&registerDevice=1'],
    ['POST', '/mapGetData.php?getRoutes=2&sortMode=2&credentials=1'],
    ['POST', '/mapGetData.php?getRoutes=2&sortMode=1&credentials=0'],
    ['GET', '/mapGetData.php?schedule=4&routeId=66949'],
    ['GET', '/mapGetData.php?schedule=4&routeId=read&stopId=190923'],
    ['GET', '/mapGetData.php?schedule=4&routeId=66949&stopId=190923&r=random'],
    ['POST', '/mapGetData.php?getBuses=1&search=2100'],
    ['POST', '/mapGetData.php?getBuses=2&search='],
    ['POST', '/mapGetData.php?getBuses=2&search=%20%20'],
    ['POST', '/mapGetData.php?getBuses=2&search=%3Cscript%3E'],
    ['POST', '/mapGetData.php?getBuses=2&search=' + 'a'.repeat(41)],
    ['POST', '/mapGetData.php?getBuses=2&search=2100&speed=1'],
    ['POST', '/mapGetData.php?walk=4'],
    ['POST', '/mapGetData.php?walk=2&debug=1'],
  ] as const)('rejects unreviewed metadata/search/plan selectors %s %s', (method, path) => {
    expect(validateUpstream(PASSIO + path, method)).toBeUndefined();
  });

  it('accepts bounded plain bus names without allowing arbitrary search syntax', () => {
    expect(validateUpstream(PASSIO + '/mapGetData.php?getBuses=2&search=Bus%2021_A-3', 'POST')).toBeDefined();
  });

  it.each([
    { ...walkBody(), mode: 'driving' },
    { ...walkBody(), extra: 'unapproved' },
    { ...walkBody(), systems: { systemSelected0: '9999', amount: 1 } },
    { ...walkBody(), systems: { systemSelected0: '5842', amount: 2 } },
    { ...walkBody(), systems: { systemSelected0: '5842', amount: 1, systemSelected1: '3994' } },
    { ...walkBody(), routes: { amount: 1 } },
    { ...walkBody(), routes: { amount: 0, routeSelected0: '66949' } },
    { ...walkBody(), routes: [] },
    { ...walkBody(), points: [] },
    { ...walkBody(), points: [walkBody().points[0]] },
    { ...walkBody(), points: [...walkBody().points, walkBody().points[0]] },
    { ...walkBody(), points: [{ lat: 91, lng: 0 }, walkBody().points[1]] },
    { ...walkBody(), points: [{ lat: -91, lng: 0 }, walkBody().points[1]] },
    { ...walkBody(), points: [{ lat: 0, lng: 181 }, walkBody().points[1]] },
    { ...walkBody(), points: [{ lat: 0, lng: -181 }, walkBody().points[1]] },
    { ...walkBody(), points: [{ lat: '39.2', lng: -82 }, walkBody().points[1]] },
    { ...walkBody(), points: [{ lat: null, lng: -82 }, walkBody().points[1]] },
    { ...walkBody(), points: [{ lat: 39, lng: -82, userId: '5842' }, walkBody().points[1]] },
    { ...walkBody(), points: [{ lat: 39 }, walkBody().points[1]] },
    { ...walkBody(), points: [[], walkBody().points[1]] },
    { ...walkBody(), points: [null, walkBody().points[1]] },
  ])('rejects an operator-plan payload outside the exact read schema: %j', async body => {
    const fetcher = jsonFetch();
    const response = await createGateway({ fetcher })(passioRequest('/mapGetData.php?walk=2', body), env);
    expect(response.status).toBe(403); expect(fetcher).not.toHaveBeenCalled();
  });

  it('accepts both agencies with valid coordinate bounds, without retaining any operator-plan response', async () => {
    const cache: GatewayCache = { match: vi.fn(async () => undefined), put: vi.fn(async () => undefined) };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ paths: [] }));
    const gateway = createGateway({ fetcher, cache });
    for (const agencyId of ['5842', '3994']) {
      const body = { ...walkBody(), systems: { systemSelected0: agencyId, amount: 1 }, points: [{ lat: -90, lng: -180 }, { lat: 90, lng: 180 }] };
      const response = await gateway(passioRequest('/mapGetData.php?walk=2', body), env);
      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('X-Transit-Cache')).toBe('MISS');
      expect(JSON.parse(fetcher.mock.calls.at(-1)![1]!.body as string)).toEqual(body);
    }
    expect(cache.match).not.toHaveBeenCalled(); expect(cache.put).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('canonicalizes nested coordinate objects before forwarding, without echoing points into response headers', async () => {
    const fetcher = jsonFetch();
    const body = { mode: 'transit', points: [{ lng: -82.11205, lat: 39.295665 }, { lng: -82.101967, lat: 39.325428 }], routes: { amount: 0 }, systems: { amount: 1, systemSelected0: '5842' } };
    const response = await createGateway({ fetcher })(passioRequest('/mapGetData.php?walk=2', body), env);
    expect(response.status).toBe(200);
    expect(fetcher.mock.calls[0]![1]!.body).toBe(JSON.stringify({ mode: 'transit', points: walkBody().points, routes: { amount: 0 }, systems: { amount: 1, systemSelected0: '5842' } }));
    expect([...response.headers.values()].join(' ')).not.toContain('39.295665');
  });
});

describe('edge gateway', () => {
  it('serves the static app through the asset binding', async () => {
    const fetcher = jsonFetch();
    const result = await createGateway({ fetcher })(new Request('https://tranuga.example/'), env);
    expect(await result.text()).toContain('static app');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('requires one explicit url and handles unknown API subpaths', async () => {
    const gateway = createGateway({ fetcher: jsonFetch() });
    expect((await gateway(new Request('https://tranuga.example/api'), env)).status).toBe(400);
    expect((await gateway(new Request('https://tranuga.example/api?url=x&url=y'), env)).status).toBe(400);
    expect((await gateway(new Request('https://tranuga.example/api/missing'), env)).status).toBe(404);
  });

  it('blocks mutations, cross origin access, and arbitrary targets without fetching', async () => {
    const fetcher = jsonFetch(); const gateway = createGateway({ fetcher });
    expect((await gateway(request(BASE + '/Routes/GetAllRoutes', { method: 'POST' }), env)).status).toBe(405);
    expect((await gateway(request(BASE + '/Routes/GetAllRoutes', { headers: { Origin: 'https://evil.example' } }), env)).status).toBe(403);
    expect((await gateway(request('https://evil.example/'), env)).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('passes only GET and Accept upstream, strips cookies/credentials, reports provider date', async () => {
    const fetcher = jsonFetch();
    const result = await createGateway({ fetcher })(request(BASE + '/Routes/GetAllRoutes', { headers: { Authorization: 'Bearer private', Cookie: 'private=1' } }), env);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true });
    expect(result.headers.get('Set-Cookie')).toBeNull();
    expect(result.headers.get('X-Upstream-Date')).toContain('12 Nov 2026');
    expect(result.headers.get('Cache-Control')).toBe('public, max-age=10');
    const options = fetcher.mock.calls[0]![1]!;
    expect(options.method).toBe('GET');
    expect(options.redirect).toBe('manual');
    expect(options.headers).toEqual({ Accept: 'application/json' });
  });

  it('never follows even an allowed-host redirect into an unapproved resource', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/' } }));
    expect((await createGateway({ fetcher })(request(BASE + '/Routes/GetAllRoutes'), env)).status).toBe(502);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 404, 429, 500])('preserves actionable provider status %i without caching errors', async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('private debug message', { status }));
    const result = await createGateway({ fetcher })(request(BASE + '/Routes/GetAllRoutes'), env);
    expect(result.status).toBe(status === 500 ? 502 : status);
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(await result.text()).not.toContain('private debug');
  });

  it('handles network failure and invalid JSON', async () => {
    const failed = vi.fn<typeof fetch>().mockRejectedValue(new Error('private internal details'));
    expect((await createGateway({ fetcher: failed })(request(BASE + '/Routes/GetAllRoutes'), env)).status).toBe(502);
    const html = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>proxy error</html>'));
    expect((await createGateway({ fetcher: html })(request(BASE + '/Routes/GetAllRoutes'), env)).status).toBe(502);
  });

  it('enforces the timeout with an abort signal', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    expect((await createGateway({ fetcher, timeoutMs: 5 })(request(BASE + '/Routes/GetAllRoutes'), env)).status).toBe(504);
  });

  it('enforces size limits on announced and streamed response bodies', async () => {
    const announced = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { headers: { 'Content-Length': '1000' } }));
    expect((await createGateway({ fetcher: announced, maxBytes: 10 })(request(BASE + '/Routes/GetAllRoutes'), env)).status).toBe(502);
    const streamed = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ body: 'x'.repeat(100) })));
    expect((await createGateway({ fetcher: streamed, maxBytes: 10 })(request(BASE + '/Routes/GetAllRoutes'), env)).status).toBe(502);
  });

  it('serves only KML at approved trace URLs', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document/></kml>'));
    const result = await createGateway({ fetcher })(request('https://realtime.catabus.com/InfoPoint/Resources/Traces/Route51.kml'), env);
    expect(result.status).toBe(200);
    expect(result.headers.get('Content-Type')).toContain('kml');
    const html = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html>not a route</html>'));
    expect((await createGateway({ fetcher: html })(request('https://realtime.catabus.com/InfoPoint/Resources/Traces/Route51.kml'), env)).status).toBe(502);
  });

  it('uses edge cache without making another upstream request', async () => {
    const values = new Map<string, Response>();
    const cache: GatewayCache = {
      match: async (key) => values.get(key.url)?.clone(),
      put: async (key, response) => { values.set(key.url, response); },
    };
    const fetcher = jsonFetch(); const gateway = createGateway({ fetcher, cache });
    const first = await gateway(request(BASE + '/Routes/GetAllRoutes'), env);
    const second = await gateway(request(BASE + '/Routes/GetAllRoutes'), env);
    expect(first.headers.get('X-Transit-Cache')).toBe('MISS');
    expect(second.headers.get('X-Transit-Cache')).toBe('HIT');
    expect(await second.json()).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('continues serving when the optional cache fails', async () => {
    const cache: GatewayCache = { match: async () => { throw new Error('unavailable'); }, put: async () => { throw new Error('unavailable'); } };
    const result = await createGateway({ fetcher: jsonFetch(), cache })(request(BASE + '/Routes/GetAllRoutes'), env);
    expect(result.status).toBe(200);
  });
});
