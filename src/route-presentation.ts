import type { Route } from './types';

export type RouteState = 'active' | 'unconfirmed' | 'inactive';
export function routeState(route: Route): RouteState {
  if (route.active && route.availability !== 'published' && route.availability !== 'unknown') return 'active';
  if (route.availability === 'unknown' || route.active && route.availability === 'published') return 'unconfirmed';
  return 'inactive';
}
export function sortRoutes(routes: Route[]): Route[] {
  const order: Record<RouteState, number> = { active: 0, unconfirmed: 1, inactive: 2 };
  return [...routes].sort((a, b) => order[routeState(a)] - order[routeState(b)] || a.shortName.localeCompare(b.shortName, undefined, { numeric: true, sensitivity: 'base' }) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
export const routeStateLabel: Record<RouteState, string> = { active: 'Active service', unconfirmed: 'Service unconfirmed', inactive: 'Not in service' };
