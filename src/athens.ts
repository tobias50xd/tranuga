import type { Agency, Coordinate, Network, Vehicle } from './types';

/** App service-area rectangle covering Athens/Clarke County and all reviewed local stops. */
export const ATHENS_BOUNDS = { south: 33.86, west: -83.54, north: 34.10, east: -83.24 } as const;
export function inAthens(point: Coordinate): boolean {
  return Number.isFinite(point.lat) && Number.isFinite(point.lon) && point.lat >= ATHENS_BOUNDS.south && point.lat <= ATHENS_BOUNDS.north && point.lon >= ATHENS_BOUNDS.west && point.lon <= ATHENS_BOUNDS.east;
}
export function isAthensAgency(agency: Agency): boolean {
  return agency.kind === 'uga' || agency.kind === 'passio' && agency.id === '3994' || agency.kind === 'infopoint' && agency.id === '58' && agency.restUrl?.replace(/\/$/, '') === 'https://bustracker.accgov.com/InfoPoint/rest';
}
export function vehiclesInScope(vehicles: Vehicle[], locked: boolean): Vehicle[] { return locked ? vehicles.filter(inAthens) : vehicles; }
export function networkInScope(network: Network, locked: boolean): Network {
  if (!locked) return network;
  // Keep whole directed patterns: deleting an intermediate out-of-area stop would invent a connection.
  const patterns = network.patterns.filter(pattern => pattern.stops.every(inAthens));
  const stops = network.stops.filter(inAthens), ids = new Set(stops.map(stop => stop.id));
  const excluded = network.patterns.length - patterns.length;
  return { ...network, patterns, stops, vehicles: vehiclesInScope(network.vehicles, true), departures: network.departures.filter(departure => ids.has(departure.stopId)), warnings: [...network.warnings, ...(excluded ? [`${excluded} route direction${excluded === 1 ? '' : 's'} outside the Athens area excluded from planning while Athens lock is on.`] : [])] };
}
