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

interface UpstreamPolicy { url: URL; ttl: number; format: 'json' | 'kml' }
const ID = /^\d{1,12}$/;
const IDS = /^\d{1,12}(,\d{1,12}){0,199}$/;
const SIMPLE_DIRECTION = /^[\w .+()-]{1,100}$/;
const MAX_URL_LENGTH = 4096;

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
export function validateUpstream(value: string): UpstreamPolicy | undefined {
  const url = cleanUrl(value);
  if (!url) return;
  const path = url.pathname;
  if (url.origin === 'https://my.uga.edu' && !url.search) {
    if (/^\/v4_19\/cache\/(?:Buses|Routes|routeTracking_\d{1,12}|stop_\d{1,12})$/.test(path)) {
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

async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
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

export function createGateway(options: GatewayOptions = {}) {
  const fetcher = options.fetcher ?? fetch;
  return async (request: Request, env: Env, context?: ExecutionContext): Promise<Response> => {
    const requestUrl = new URL(request.url);
    if (requestUrl.pathname !== '/api' && requestUrl.pathname !== '/api/') {
      if (requestUrl.pathname.startsWith('/api/')) return jsonError(404, 'Unknown API path');
      return env.ASSETS.fetch(request);
    }
    if (request.method !== 'GET') {
      const response = jsonError(405, 'Only GET is supported'); response.headers.set('Allow', 'GET'); return response;
    }
    const origin = request.headers.get('Origin');
    if (origin && origin !== requestUrl.origin) return jsonError(403, 'Cross-origin API requests are not supported');
    if (!exactParameters(requestUrl, ['url'])) return jsonError(400, 'Provide one url parameter');
    const policy = validateUpstream(requestUrl.searchParams.get('url')!);
    if (!policy) return jsonError(403, 'This upstream endpoint is not approved');
    const cacheKey = new Request(requestUrl.origin + '/api?url=' + encodeURIComponent(policy.url.href));
    const cache = options.cache;
    if (cache) {
      const hit = await cache.match(cacheKey).catch(() => undefined);
      if (hit) { const result = new Response(hit.body, hit); result.headers.set('X-Transit-Cache', 'HIT'); return result; }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 12_000);
    try {
      const response = await fetcher(policy.url.href, {
        method: 'GET', redirect: 'manual', signal: controller.signal,
        headers: { Accept: policy.format === 'kml' ? 'application/vnd.google-earth.kml+xml, application/xml, text/xml' : 'application/json' },
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
        'Cache-Control': `public, max-age=${policy.ttl}`,
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
