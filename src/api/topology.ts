import type { Coordinate, RoutePattern, Stop } from '../types';
import { decodePolyline, list, normalizeStops, num, record, rows, text, uniqueStops } from './normalize';

export interface UgaTopology { stops: Stop[]; patterns: RoutePattern[]; shapes: Map<string, Coordinate[]> }
export function ugaTopology(value: unknown): UgaTopology {
  const data = record(value);
  if (!Array.isArray(data.stops) || !Array.isArray(data.Routes)) throw new Error('Static transit network has an unsupported format.');
  const stops = normalizeStops(data.stops), byId = new Map(stops.map(s => [s.id, s]));
  const shapes = new Map<string, Coordinate[]>();
  for (const row of list(data.shapes)) { try { if (typeof row.shape === 'string') shapes.set(text(row.routeId), decodePolyline(row.shape)); } catch { /* Missing geometry falls back to visible stop connectors. */ } }
  const grouped = new Map<string, { routeId: string; direction: string; rows: Record<string, unknown>[] }>();
  for (const row of list(data.routeStopSequence)) {
    const routeId = text(row.routeId), direction = text(row.direction, '0'), key = `${routeId}:${direction}`;
    const group = grouped.get(key) ?? { routeId, direction, rows: [] }; group.rows.push(row); grouped.set(key, group);
  }
  const tripRoutes = record(data.tripIdToRouteId), sequences = record(data.tripStopSequence);
  const loopRoutes = new Set(Object.entries(sequences).filter(([, s]) => Array.isArray(s) && s.length > 1 && text(s[0]) === text(s[s.length - 1])).map(([trip]) => text(tripRoutes[trip])));
  const patterns = [...grouped.entries()].map(([id, group]) => {
    const ordered = group.rows.sort((a, b) => (num(a.stopSequence) ?? 0) - (num(b.stopSequence) ?? 0)).flatMap(row => { const stop = byId.get(text(row.stopId)); return stop ? [stop] : []; });
    const repeated = ordered.length > 1 && ordered[0].id === ordered.at(-1)?.id;
    return { id: `uga:${id}`, routeId: group.routeId, direction: group.direction, stops: repeated ? ordered.slice(0, -1) : ordered, shape: shapes.get(group.routeId) ?? [], loop: repeated || (group.direction === '0' && loopRoutes.has(group.routeId)) };
  }).filter(p => p.stops.length > 1);
  return { stops, patterns, shapes };
}
export function ugaTrackingPatterns(value: unknown, routeId: string, topology: UgaTopology): RoutePattern[] {
  const tracking = rows(value, 'Route stop predictions');
  const byId = new Map(topology.stops.map(s => [s.id, s]));
  const groups = new Map<string, Record<string, unknown>[]>();
  // Athens route tracking uses directionId, whereas campus tracking uses direction.
  for (const row of tracking) { const direction = text(row.direction ?? row.directionId, '0'); groups.set(direction, [...(groups.get(direction) ?? []), row]); }
  return [...groups.entries()].map(([direction, group]) => {
    const ordered = group.sort((a, b) => (num(a.stopSequence) ?? 0) - (num(b.stopSequence) ?? 0)).flatMap(row => {
      const live = normalizeStops([record(row.stop)])[0], stop = live ?? byId.get(text(row.stopId)); return stop ? [stop] : [];
    });
    const repeated = ordered.length > 1 && ordered[0].id === ordered.at(-1)?.id;
    return { id: `uga:${routeId}:${direction}`, routeId, direction, stops: repeated ? ordered.slice(0, -1) : ordered, shape: topology.shapes.get(routeId) ?? [], loop: repeated || topology.patterns.some(p => p.routeId === routeId && p.direction === direction && p.loop) || group.some(r => /loop/i.test(text(r.directionName))) };
  }).filter(p => p.stops.length > 1);
}
export function infoPatterns(value: unknown, allStops: Stop[] = [], shape: Coordinate[] = []): RoutePattern[] {
  const row = record(value), routeId = text(row.RouteId), stops = normalizeStops(Array.isArray(row.Stops) ? row.Stops : []);
  const byId = new Map([...allStops, ...stops].map(s => [s.id, s]));
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const rs of list(row.RouteStops)) { const direction = text(rs.Direction); groups.set(direction, [...(groups.get(direction) ?? []), rs]); }
  return [...groups.entries()].map(([direction, group]) => {
    const ordered = group.sort((a, b) => (num(a.SortOrder) ?? 0) - (num(b.SortOrder) ?? 0)).flatMap(rs => { const stop = byId.get(text(rs.StopId)); return stop ? [stop] : []; });
    const loop = ordered.length > 1 && ordered[0].id === ordered.at(-1)?.id;
    return { id: `info:${routeId}:${direction}`, routeId, direction, stops: loop ? ordered.slice(0, -1) : ordered, shape, loop };
  }).filter(p => p.stops.length > 1);
}
export function withDirectionStops(patterns: RoutePattern[], direction: string, value: unknown): RoutePattern[] {
  const available = normalizeStops(value), known = patterns.find(p => p.direction === direction);
  // The endpoint does not return SortOrder and some authorities return an unordered stop set.
  // Keep authoritative RouteStops.SortOrder; use this endpoint to refresh names/coordinates.
  const byId = new Map(available.map(s => [s.id, s]));
  if (known) return patterns.map(p => p.direction === direction ? { ...p, stops: p.stops.map(s => byId.get(s.id) ?? s) } : p);
  // Without RouteStops, the API does not prove stop order. Show stops separately, never invent ride edges.
  return patterns;
}
export { uniqueStops };
