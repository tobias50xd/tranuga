import authorities from '../src/data/authorities.json';

/** Only this committed registry can grant a new upstream host access. Discovery is data, not policy. */
export const APPROVED_REST_BASES: readonly string[] = authorities.map((authority) => authority.restUrl.replace(/\/$/, ''));

interface AssetBinding { fetch(request: Request): Promise<Response> }
export interface Env { ASSETS: AssetBinding }
interface ExecutionContext { waitUntil(promise: Promise<unknown>): void }
export interface GatewayCache { match(request: Request): Promise<Response | undefined>; put(request: Request, response: Response): Promise<unknown> }
interface GatewayOptions {
  fetcher?: typeof fetch;
  cache?: GatewayCache;
  timeoutMs?: number;
  maxBytes?: number;
}

interface UpstreamPolicy { url: URL; ttl: number; format: 'json' | 'kml'; postBody?: 'selection' | 'systems' | 'alerts' | 'walk' }
const ID = /^\d{1,12}$/;
const IDS = /^\d{1,12}(,\d{1,12}){0,199}$/;
const SIMPLE_DIRECTION = /^[\w .+()-]{1,100}$/;
const MAX_URL_LENGTH = 4096;
const MAX_POST_BYTES = 8192;
const PASSIO_ORIGINS = ['https://passiogo.com', 'https://replicated2of3.passiogo.com', 'https://replicated3of3.passiogo.com'];
const PASSIO_AGENCY_IDS = ['5842', '3994']; // Athens, Ohio and University of Georgia, independently verified.
const PASSIO_STOP_IDS = /^\d{1,12}(,\d{1,12}){0,39}$/;

function exactParameters(url: URL, allowed: string[], required = allowed): boolean {
  const keys = [...url.searchParams.keys()];
  return keys.every((key) => allowed.includes(key) && url.searchParams.getAll(key).length === 1)
    && required.every((key) => url.searchParams.has(key));
}

function cleanUrl(value: string): URL | undefined {
  if (value.length > MAX_URL_LENGTH || /[\u0000-\u0020\\]/.test(value)) return;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.port) return;
    // Encoded separators and dot segments must never turn an approved path into another resource.
    if (/%(?:2f|5c|2e|00)/i.test(url.pathname) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(new URL(value).pathname)) return;
    return url;
  } catch { return; }
}

/** Validate exact public transit endpoints, never an arbitrary host or caller supplied base. */
export function validateUpstream(value: string, method: 'GET' | 'POST' = 'GET'): UpstreamPolicy | undefined {
  const url = cleanUrl(value);
  if (!url) return;
  const path = url.pathname;
  if (PASSIO_ORIGINS.includes(url.origin)) {
    // These are the public read queries observed in the agency's own web client.
    // No account/device identifiers, write actions, debug options, or arbitrary agencies are allowed.
    if (method === 'POST') {
      if (path === '/mapGetData.php') {
        if (exactParameters(url, ['getRoutes']) && url.searchParams.get('getRoutes') === '1') {
          return { url, ttl: 60, format: 'json', postBody: 'selection' };
        }
        if (exactParameters(url, ['getRoutes', 'sortMode', 'credentials']) && url.searchParams.get('getRoutes') === '2'
          && url.searchParams.get('sortMode') === '1' && url.searchParams.get('credentials') === '1') {
          return { url, ttl: 3600, format: 'json', postBody: 'selection' };
        }
        if (exactParameters(url, ['getStops', 'withOutdated', 'wBounds', 'showBusInOos'])
          && url.searchParams.get('getStops') === '2' && url.searchParams.get('withOutdated') === '1'
          && url.searchParams.get('wBounds') === '1' && url.searchParams.get('showBusInOos') === '0') {
          return { url, ttl: 3600, format: 'json', postBody: 'systems' };
        }
        if (exactParameters(url, ['getBuses', 'speed'], ['getBuses'])
          && ['1', '2'].includes(url.searchParams.get('getBuses')!)
          && (!url.searchParams.has('speed') || url.searchParams.get('speed') === '1')) {
          return { url, ttl: 10, format: 'json', postBody: 'systems' };
        }
        if (exactParameters(url, ['getBuses', 'search']) && url.searchParams.get('getBuses') === '2'
          && /^[A-Za-z0-9 _-]{1,40}$/.test(url.searchParams.get('search')!) && url.searchParams.get('search')!.trim()) {
          return { url, ttl: 10, format: 'json', postBody: 'systems' };
        }
        if (exactParameters(url, ['walk']) && url.searchParams.get('walk') === '2') {
          return { url, ttl: 0, format: 'json', postBody: 'walk' };
        }
      }
      if (path === '/goServices.php' && exactParameters(url, ['getAlertMessages', 'alertCRC', 'noOptions'])
        && url.searchParams.get('getAlertMessages') === '1' && url.searchParams.get('alertCRC') === 'na'
        && url.searchParams.get('noOptions') === '1') return { url, ttl: 10, format: 'json', postBody: 'alerts' };
    }
    if (method === 'GET') {
      if (path === '/goServices.php' && exactParameters(url, ['goWebVer']) && url.searchParams.get('goWebVer') === '1') {
        return { url, ttl: 3600, format: 'json' };
      }
      if (path === '/mapGetData.php') {
        if (exactParameters(url, ['getSystems', 'sortMode', 'credentials', 'acronymId'])
          && url.searchParams.get('getSystems') === '2' && url.searchParams.get('sortMode') === '1'
          && url.searchParams.get('credentials') === '1' && PASSIO_AGENCY_IDS.includes(url.searchParams.get('acronymId')!)) {
          return { url, ttl: 3600, format: 'json' };
        }
        if (exactParameters(url, ['schedule', 'routeId', 'stopId']) && url.searchParams.get('schedule') === '4'
          && ID.test(url.searchParams.get('routeId')!) && ID.test(url.searchParams.get('stopId')!)) {
          return { url, ttl: 3600, format: 'json' };
        }
      }
    }
    if (method === 'GET' && path === '/mapGetData.php'
      && exactParameters(url, ['eta', 'stopIds', 'routeId', 'position', 'userId'], ['eta', 'stopIds', 'userId'])
      && url.searchParams.get('eta') === '3' && PASSIO_STOP_IDS.test(url.searchParams.get('stopIds')!)
      && PASSIO_AGENCY_IDS.includes(url.searchParams.get('userId')!)
      && (!url.searchParams.has('routeId') || ID.test(url.searchParams.get('routeId')!))
      && (!url.searchParams.has('position') || /^[1-9]\d{0,5}$/.test(url.searchParams.get('position')!))) {
      return { url, ttl: 10, format: 'json' };
    }
    return;
  }
  if (method !== 'GET') return;
  if (url.origin === 'https://my.uga.edu' && !url.search) {
    if (/^\/v4_19\/cache\/(?:Buses|Routes|routeTracking_\d{1,12}|stop_c?\d{1,12})$/.test(path)) {
      return { url, ttl: 10, format: 'json' };
    }
  }
  if (url.origin === 'https://d1dhvjc4b8xlgl.cloudfront.net' && !url.search
    && /^\/mobile-bus-data\/(?:version|busData)\.json$/.test(path)) {
    return { url, ttl: 3600, format: 'json' };
  }
  if (['http://mobilegateway.rideralerts.com', 'https://mobilegateway.rideralerts.com'].includes(url.origin)) {
    if (/^\/gateway\/TransitAuthorities\/?$/.test(path)) {
      if (!url.search || (exactParameters(url, ['includeHiddenPropertyCode'])
        && /^@[A-Za-z0-9_-]{1,50}$/.test(url.searchParams.get('includeHiddenPropertyCode')!))) {
        return { url, ttl: 3600, format: 'json' };
      }
    }
    if (path === '/gateway/TransitAuthorities/Locate' && exactParameters(url, ['Lat', 'long'])) {
      const latText = url.searchParams.get('Lat')!;
      const lonText = url.searchParams.get('long')!;
      const lat = Number(latText); const lon = Number(lonText);
      if (latText.trim() && lonText.trim() && Number.isFinite(lat) && Math.abs(lat) <= 90
        && Number.isFinite(lon) && Math.abs(lon) <= 180) return { url, ttl: 3600, format: 'json' };
    }
    return;
  }
  for (const baseValue of APPROVED_REST_BASES) {
    const base = new URL(baseValue);
    if (url.origin !== base.origin) continue;
    const basePath = base.pathname.replace(/\/$/, '');
    const relative = path.slice(basePath.length);
    if (path.toLowerCase().startsWith(basePath.toLowerCase() + '/')) {
      if (!url.search && /^\/(?:TransitAuthorityConfig\/Get|Routes\/(?:GetAllRoutes|GetVisibleRoutes)|RouteDetails\/(?:GetAllRouteDetails|Get\/\d{1,12}|GetDirectionsByRouteID\/\d{1,12})|Stops\/(?:GetAllStops|Get\/\d{1,12})|StopDepartures\/Get\/\d{1,12}|PublicMessages\/GetCurrentMessages)$/i.test(relative)) {
        const ttl = /^\/(?:TransitAuthorityConfig|Stops)/i.test(relative) ? 3600 : 10;
        return { url, ttl, format: 'json' };
      }
      if (/^\/RouteDetails\/GetStopsForRouteDirection\/?$/i.test(relative)
        && exactParameters(url, ['routeid', 'direction', 'timepointsOnly'])
        && ID.test(url.searchParams.get('routeid')!)
        && SIMPLE_DIRECTION.test(url.searchParams.get('direction')!)
        && url.searchParams.get('timepointsOnly') === 'false') return { url, ttl: 3600, format: 'json' };
      if (/^\/Stops\/GetAllStopsForRoutes\/?$/i.test(relative)
        && exactParameters(url, ['routeIDs']) && IDS.test(url.searchParams.get('routeIDs')!)) {
        return { url, ttl: 3600, format: 'json' };
      }
    }
    // Agency configs may describe geometry, but cannot expand the approved origin or root.
    const siteRoot = basePath.replace(/\/rest$/i, '');
    if (!url.search && path.toLowerCase().startsWith((siteRoot + '/Resources/Traces/').toLowerCase())) {
      const filename = path.slice((siteRoot + '/Resources/Traces/').length);
      if (/^[\w% +().-]{1,200}\.kml$/i.test(filename) && !filename.includes('..')) return { url, ttl: 3600, format: 'kml' };
    }
  }
}

function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

async function readLimited(response: Pick<Response, 'headers' | 'body'>, maxBytes: number): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel();
    throw new Error('Upstream response is too large');
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new Error('Upstream response is too large');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

/** Construct a fresh canonical body only after every field has matched the observed read schema. */
function canonicalPassioBody(value: unknown, schema: NonNullable<UpstreamPolicy['postBody']>): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const body = value as Record<string, unknown>;
  if (schema === 'walk') {
    if (!hasExactKeys(body, ['systems', 'routes', 'points', 'mode']) || body.mode !== 'transit') return;
    const systems = canonicalPassioBody(body.systems, 'selection');
    if (!systems || !body.routes || typeof body.routes !== 'object' || Array.isArray(body.routes)
      || !hasExactKeys(body.routes, ['amount']) || (body.routes as Record<string, unknown>).amount !== 0) return;
    if (!Array.isArray(body.points) || body.points.length !== 2) return;
    const points: { lat: number; lng: number }[] = [];
    for (const point of body.points) {
      if (!point || typeof point !== 'object' || Array.isArray(point) || !hasExactKeys(point, ['lat', 'lng'])) return;
      const { lat, lng } = point as Record<string, unknown>;
      if (typeof lat !== 'number' || !Number.isFinite(lat) || Math.abs(lat) > 90
        || typeof lng !== 'number' || !Number.isFinite(lng) || Math.abs(lng) > 180) return;
      points.push({ lat, lng });
    }
    return JSON.stringify({ mode: 'transit', points, routes: { amount: 0 }, systems: JSON.parse(systems) });
  }
  const agencyId = schema === 'systems' ? body.s0 : body.systemSelected0;
  if (typeof agencyId !== 'string' || !PASSIO_AGENCY_IDS.includes(agencyId)) return;
  const expected: Record<string, unknown> = schema === 'systems'
    ? { s0: agencyId, sA: 1 }
    : schema === 'alerts' ? { amount: 1, routesAmount: 0, systemSelected0: agencyId }
      : { amount: 1, systemSelected0: agencyId };
  const keys = Object.keys(body);
  if (keys.length !== Object.keys(expected).length || keys.some(key => !Object.hasOwn(expected, key) || body[key] !== expected[key])) return;
  return JSON.stringify(expected);
}

function hasExactKeys(value: object, allowed: string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every(key => allowed.includes(key));
}

async function bodyDigest(body: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function createGateway(options: GatewayOptions = {}) {
  const fetcher = options.fetcher ?? fetch;
  return async (request: Request, env: Env, context?: ExecutionContext): Promise<Response> => {
    const requestUrl = new URL(request.url);
    if (requestUrl.pathname !== '/api' && requestUrl.pathname !== '/api/') {
      if (requestUrl.pathname.startsWith('/api/')) return jsonError(404, 'Unknown API path');
      return env.ASSETS.fetch(request);
    }
    if (request.method !== 'GET' && request.method !== 'POST') {
      const response = jsonError(405, 'Only approved GET and read-only POST queries are supported'); response.headers.set('Allow', 'GET, POST'); return response;
    }
    const origin = request.headers.get('Origin');
    if (origin && origin !== requestUrl.origin) return jsonError(403, 'Cross-origin API requests are not supported');
    if (!exactParameters(requestUrl, ['url'])) return jsonError(400, 'Provide one url parameter');
    const upstreamUrl = requestUrl.searchParams.get('url')!;
    const policy = validateUpstream(upstreamUrl, request.method);
    if (!policy) {
      const otherMethod = request.method === 'POST' ? 'GET' : 'POST';
      if (validateUpstream(upstreamUrl, otherMethod)) {
        const result = jsonError(405, 'This endpoint does not support that method'); result.headers.set('Allow', otherMethod); return result;
      }
      return jsonError(403, 'This upstream endpoint is not approved');
    }
    let postBody: string | undefined;
    if (policy.postBody) {
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('Content-Type') ?? '')) {
        return jsonError(415, 'Read-only POST queries require application/json');
      }
      let bytes: Uint8Array;
      try { bytes = await readLimited(request, MAX_POST_BYTES); }
      catch { return jsonError(413, 'POST body exceeds the 8 KiB limit'); }
      let value: unknown;
      try { value = JSON.parse(new TextDecoder().decode(bytes)); }
      catch { return jsonError(400, 'POST body must be valid JSON'); }
      postBody = canonicalPassioBody(value, policy.postBody);
      if (!postBody) return jsonError(403, 'This POST query body is not approved');
    }
    const canonicalUrl = new URL(policy.url); canonicalUrl.searchParams.sort();
    const cacheKey = new Request(requestUrl.origin + '/api?url=' + encodeURIComponent(canonicalUrl.href)
      + (postBody ? '&method=POST&body=' + await bodyDigest(postBody) : ''));
    // Operator-plan comparisons contain caller-selected coordinates and are never retained in the edge cache.
    const cache = policy.ttl > 0 ? options.cache : undefined;
    if (cache) {
      const hit = await cache.match(cacheKey).catch(() => undefined);
      if (hit) { const result = new Response(hit.body, hit); result.headers.set('X-Transit-Cache', 'HIT'); return result; }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 12_000);
    try {
      const response = await fetcher(policy.url.href, {
        method: postBody ? 'POST' : 'GET', redirect: 'manual', signal: controller.signal,
        headers: {
          Accept: policy.format === 'kml' ? 'application/vnd.google-earth.kml+xml, application/xml, text/xml' : 'application/json',
          ...(postBody ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(postBody ? { body: postBody } : {}),
      });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        return jsonError(502, 'Upstream redirected; the approved endpoint needs review');
      }
      if (!response.ok) {
        await response.body?.cancel();
        return jsonError([401, 403, 404, 429].includes(response.status) ? response.status : 502, `Transit provider returned HTTP ${response.status}`);
      }
      const bytes = await readLimited(response, options.maxBytes ?? 8 * 1024 * 1024);
      const text = new TextDecoder().decode(bytes);
      if (policy.format === 'json') { try { JSON.parse(text); } catch { return jsonError(502, 'Transit provider returned invalid JSON'); } }
      else if (!/<(?:[\w-]+:)?kml(?:\s|>)/i.test(text)) return jsonError(502, 'Transit provider returned invalid KML');
      const headers = new Headers({
        'Content-Type': policy.format === 'json' ? 'application/json; charset=utf-8' : 'application/vnd.google-earth.kml+xml; charset=utf-8',
        'Cache-Control': policy.ttl > 0 ? `public, max-age=${policy.ttl}` : 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Transit-Cache': 'MISS',
      });
      const upstreamDate = response.headers.get('Date');
      if (upstreamDate) headers.set('X-Upstream-Date', upstreamDate);
      const result = new Response(text, { headers });
      if (cache) {
        const write = cache.put(cacheKey, result.clone()).catch(() => undefined);
        if (context) context.waitUntil(write); else await write;
      }
      return result;
    } catch {
      return jsonError(controller.signal.aborted ? 504 : 502,
        controller.signal.aborted ? 'Transit provider timed out' : 'Transit provider is unavailable or its response exceeded the size limit');
    } finally { clearTimeout(timer); }
  };
}

export default {
  fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    const runtimeCaches = globalThis as typeof globalThis & { caches?: { default?: GatewayCache } };
    return createGateway({ cache: runtimeCaches.caches?.default })(request, env, context);
  },
};
