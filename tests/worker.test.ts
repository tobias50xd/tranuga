import { describe, expect, it, vi } from 'vitest';
import { APPROVED_REST_BASES, createGateway, validateUpstream, type Env, type GatewayCache } from '../worker/index';

const BASE = 'https://realtime.catabus.com/InfoPoint/rest';
const env: Env = { ASSETS: { fetch: async () => new Response('<html>static app</html>', { headers: { 'Content-Type': 'text/html' } }) } };
const request = (url: string, init?: RequestInit) => new Request('https://tranuga.example/api?url=' + encodeURIComponent(url), init);
const jsonFetch = () => vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }, { headers: { 'Set-Cookie': 'ignored=secret', Date: 'Thu, 12 Nov 2026 23:00:00 GMT' } }));

describe('approved upstream endpoint policy', () => {
  it.each([
    'https://my.uga.edu/v4_19/cache/Routes',
    'https://my.uga.edu/v4_19/cache/Buses',
    'https://my.uga.edu/v4_19/cache/routeTracking_5750',
    'https://my.uga.edu/v4_19/cache/stop_155104',
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
