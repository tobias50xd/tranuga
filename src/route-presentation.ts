import type { Route } from './types';
import crosswalk from './data/athens-crosswalk.json';
const campusIds = new Set(crosswalk.routes.filter(route => route.operator === 'uga-campus').map(route => route.id));
export function routeOperator(route: Route): 'uga' | 'city' | 'other' {
  if (route.operator) return route.operator;
  // Compatibility for saved snapshots made before operator metadata was retained.
  if (route.agencyId === '3994') return 'uga';
  if (route.agencyId === 'uga') return campusIds.has(route.id) || route.id.startsWith('passio:') ? 'uga' : 'city';
  return 'other';
}

export type RouteState = 'active' | 'unconfirmed' | 'inactive';
export function routeState(route: Route): RouteState {
  if (route.active && route.availability !== 'published' && route.availability !== 'unknown') return 'active';
  if (route.availability === 'unknown' || route.active && route.availability === 'published') return 'unconfirmed';
  return 'inactive';
}
export function sortRoutes(routes: Route[], favorites: ReadonlySet<string> = new Set()): Route[] {
  const order: Record<RouteState, number> = { active: 0, unconfirmed: 1, inactive: 2 };
  const operators = { uga: 0, city: 1, other: 2 };
  return [...routes].sort((a, b) => Number(favorites.has(b.id)) - Number(favorites.has(a.id)) || operators[routeOperator(a)] - operators[routeOperator(b)] || order[routeState(a)] - order[routeState(b)] || a.shortName.localeCompare(b.shortName, undefined, { numeric: true, sensitivity: 'base' }) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
export const routeStateLabel: Record<RouteState, string> = { active: 'Active service', unconfirmed: 'Service unconfirmed', inactive: 'Not in service' };
