import type { Coordinate } from '../types';

export const UGA_BASE = 'https://my.uga.edu/v4_19/cache';
export const STATIC_BASE = 'https://d1dhvjc4b8xlgl.cloudfront.net/mobile-bus-data';
export const DISCOVERY_BASE = 'http://mobilegateway.rideralerts.com/gateway/TransitAuthorities';
const id = (value: string) => encodeURIComponent(value);
const base = (value: string) => value.replace(/\/+$/, '');
export const ugaEndpoints = {
  routes: `${UGA_BASE}/Routes`, buses: `${UGA_BASE}/Buses`,
  tracking: (routeId: string) => `${UGA_BASE}/routeTracking_${id(routeId)}`,
  stop: (stopId: string) => `${UGA_BASE}/stop_${id(stopId)}`,
  version: `${STATIC_BASE}/version.json`, data: `${STATIC_BASE}/busData.json`,
};
export const discoveryEndpoints = {
  all: DISCOVERY_BASE,
  locate: ({ lat, lon }: Coordinate) => `${DISCOVERY_BASE}/Locate?Lat=${lat}&long=${lon}`,
  code: (code: string) => `${DISCOVERY_BASE}/?includeHiddenPropertyCode=${encodeURIComponent(`@${code.replace(/^@/, '')}`)}`,
};
export const infoEndpoints = (restBase: string) => {
  const root = base(restBase);
  return {
    config: `${root}/TransitAuthorityConfig/Get`,
    routes: `${root}/Routes/GetAllRoutes`, visibleRoutes: `${root}/Routes/GetVisibleRoutes`,
    route: (routeId: string) => `${root}/RouteDetails/Get/${id(routeId)}`,
    allDetails: `${root}/RouteDetails/GetAllRouteDetails`,
    directions: (routeId: string) => `${root}/RouteDetails/GetDirectionsByRouteID/${id(routeId)}`,
    directionStops: (routeId: string, direction: string) => `${root}/RouteDetails/GetStopsForRouteDirection/?routeid=${id(routeId)}&direction=${id(direction)}&timepointsOnly=false`,
    stops: `${root}/Stops/GetAllStops`,
    routeStops: (routeIds: string[]) => `${root}/Stops/GetAllStopsForRoutes?routeIDs=${encodeURIComponent(routeIds.join(','))}`,
    stop: (stopId: string) => `${root}/Stops/Get/${id(stopId)}`,
    departures: (stopId: string) => `${root}/StopDepartures/Get/${id(stopId)}`,
    messages: `${root}/PublicMessages/GetCurrentMessages`,
  };
};
/** Config supplies a trace directory; the gateway independently enforces the reviewed agency/path registry. */
export function kmlEndpoint(config: { BaseUrl?: unknown; KmlUrl?: unknown }, filename: string): string {
  if (typeof config.BaseUrl !== 'string' || typeof config.KmlUrl !== 'string' || !filename || /[/\\]/.test(filename)) throw new Error('No valid route trace URL supplied by agency.');
  return new URL(`${config.KmlUrl.replace(/^\/+/, '')}${encodeURIComponent(filename)}`, `${base(config.BaseUrl)}/`).href;
}
