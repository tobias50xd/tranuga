import type { Agency, Coordinate, Departure, Route, RoutePattern, Stop, Vehicle } from '../types';

export type Row = Record<string, unknown>;
export const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
export function rows(value: unknown, context = 'Transit response'): Row[] {
  if (!Array.isArray(value)) throw new Error(`${context} has an unsupported format.`);
  return value.filter(x => x && typeof x === 'object' && !Array.isArray(x)) as Row[];
}
export const list = (value: unknown): Row[] => Array.isArray(value) ? value.filter(x => x && typeof x === 'object') as Row[] : [];
export const text = (value: unknown, fallback = '') => typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
export const num = (value: unknown): number | undefined => (typeof value === 'number' || typeof value === 'string') && value !== '' && Number.isFinite(Number(value)) ? Number(value) : undefined;
export function coordinate(value: Row): Coordinate | undefined {
  const lat = num(value.latitude ?? value.Latitude ?? value.lat), lon = num(value.longitude ?? value.Longitude ?? value.lon);
  return lat !== undefined && lon !== undefined && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat !== 0 || lon !== 0) ? { lat, lon } : undefined;
}
export function timestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1e11 ? value : value > 1e9 ? value * 1000 : undefined;
  if (typeof value !== 'string' || !value) return undefined;
  const dotnet = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(value);
  if (dotnet) return Number(dotnet[1]);
  const numeric = num(value);
  if (numeric !== undefined) return timestamp(numeric);
  // Unqualified local times depend on agency timezone; only parse explicit offsets.
  if (!/(?:Z|[+-]\d\d:\d\d)$/.test(value)) return undefined;
  const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : undefined;
}
export function color(value: unknown): string {
  if (typeof value === 'string' && /^#?[0-9a-f]{6}$/i.test(value)) return `#${value.replace('#', '')}`;
  const rgb = record(value);
  if (['r', 'g', 'b'].every(k => typeof rgb[k] === 'number' && Number(rgb[k]) >= 0 && Number(rgb[k]) <= 255)) return `#${['r', 'g', 'b'].map(k => Math.round(Number(rgb[k])).toString(16).padStart(2, '0')).join('')}`;
  return '#315b5c';
}
export function normalizeRoutes(value: unknown, agencyId: string, kind: 'uga' | 'infopoint'): Route[] {
  return rows(value, 'Route list').flatMap(row => {
    const id = text(kind === 'uga' ? row.id : row.RouteId); if (!id) return [];
    return [{ id, agencyId, operator: kind === 'uga' ? row.isAthensBus === true ? 'city' : 'uga' : agencyId === '58' ? 'city' : 'other', name: text(row.long_name ?? row.LongName ?? row.Description, `Route ${id}`), shortName: text(row.short_name ?? row.ShortName ?? row.RouteAbbreviation, id), color: color(row.color ?? row.Color ?? row.hex), active: kind === 'uga' ? row.active === true : row.IsVisible !== false, availability: kind === 'uga' ? 'current' : 'published' }];
  });
}
export function normalizeStops(value: unknown): Stop[] {
  return rows(value, 'Stop list').flatMap(row => { const point = coordinate(row), id = text(row.id ?? row.StopId); return point && id ? [{ id, name: text(row.name ?? row.Name ?? row.Description, `Stop ${id}`), ...point }] : []; });
}
export function normalizeVehicles(value: unknown, kind: 'uga' | 'infopoint', now = Date.now()): Vehicle[] {
  const source = rows(value, 'Vehicle list');
  const vehicles: Row[] = kind === 'uga' ? source : source.flatMap(row => list(row.Vehicles).map(v => ({ ...v, RouteId: v.RouteId ?? row.RouteId } as Row)));
  return vehicles.flatMap(row => {
    const point = coordinate(row), id = text(row.id ?? row.VehicleId), routeId = text(row.routeId ?? row.RouteId);
    if (!point || !id || !routeId) return [];
    const updatedAt = timestamp(row.lastUpdate ?? row.LastUpdated ?? row.proxyTimestamp);
    // Keep older vehicles visible with their timestamp; the UI labels them stale, and planner excludes them.
    return [{ id, routeId, ...point, heading: ((num(row.heading ?? row.Heading) ?? 0) % 360 + 360) % 360, speed: num(row.speed ?? row.Speed), updatedAt: updatedAt && updatedAt < now + 60000 ? updatedAt : undefined, destination: text(row.Destination ?? row.destination), tripId: text(row.tripId ?? row.TripId) || undefined }];
  });
}
export function ugaDepartures(value: unknown): Departure[] {
  return rows(value, 'Arrival predictions').flatMap(row => (Array.isArray(row.times) ? row.times : []).flatMap(t => {
    const arrivalTime = timestamp(t), stopId = text(row.stopId), routeId = text(row.routeId);
    // Campus/selected-stop responses use direction; city routeTracking uses directionId.
    return arrivalTime && stopId && routeId ? [{ stopId, routeId, arrivalTime, direction: text(row.direction ?? row.directionId) }] : [];
  }));
}
export function infoDepartures(value: unknown): Departure[] {
  return rows(value, 'Stop departures').flatMap(stop => list(stop.RouteDirections).flatMap(rd => list(rd.Departures).filter(d => d.IsCompleted !== true).flatMap(d => {
    const eta = timestamp(d.ETA), edt = timestamp(d.EDT);
    const arrivalTime = eta ?? edt ?? timestamp(d.STA) ?? timestamp(d.SDT), trip = record(d.Trip), routeId = text(rd.RouteId), stopId = text(stop.StopId);
    const departs = edt ?? timestamp(d.SDT);
    const scheduledStatus = [d.StopStatusReportLabel, d.TripStatusReportLabel, trip.TripStatusReportLabel].some(value => /^scheduled(?:\s|$|\()/i.test(text(value).trim()));
    return arrivalTime && routeId && stopId ? [{ routeId, stopId, arrivalTime, updatedAt: timestamp(d.LastUpdated ?? stop.LastUpdated), departureTime: departs && departs >= arrivalTime ? departs : undefined, direction: text(rd.DirectionCode ?? trip.TripDirection ?? rd.Direction), tripId: text(trip.TripId ?? trip.GtfsTripId) || undefined, scheduled: scheduledStatus || !eta && !edt }] : [];
  })));
}
export function normalizeAgencies(value: unknown): Agency[] {
  return rows(Array.isArray(value) ? value : value && Object.keys(record(value)).length ? [value] : [], 'Agency discovery').flatMap(row => {
    const id = text(row.Id), restUrl = text(row.RestUrl).replace(/\/+$/, '');
    if (!id || !/^https?:\/\//i.test(restUrl)) return [];
    return [{ id, name: text(row.Name, id), kind: 'infopoint' as const, restUrl, center: coordinate(row) }];
  });
}
export function messages(value: unknown): string[] {
  return [...new Set(list(value).filter(m => m.Published !== false).map(m => text(m.Message ?? m.Header)).filter(Boolean))];
}
export function uniqueStops(patterns: RoutePattern[]): Stop[] { return [...new Map(patterns.flatMap(p => p.stops).map(s => [s.id, s])).values()]; }
export function decodePolyline(encoded: string): Coordinate[] {
  let i = 0, lat = 0, lon = 0; const result: Coordinate[] = [];
  const read = () => { let shift = 0, value = 0, b = 0; do { if (i >= encoded.length || shift > 30) throw new Error('Invalid encoded route shape.'); b = encoded.charCodeAt(i++) - 63; if (b < 0 || b > 63) throw new Error('Invalid encoded route shape.'); value |= (b & 31) << shift; shift += 5; } while (b >= 32); return value & 1 ? ~(value >> 1) : value >> 1; };
  while (i < encoded.length) { lat += read(); lon += read(); const point = coordinate({ lat: lat / 1e5, lon: lon / 1e5 }); if (!point) throw new Error('Route shape contains invalid coordinates.'); result.push(point); }
  return result;
}
/** Only LineString coordinates form route geometry; point placemarks are excluded. */
export function parseKml(kml: string): Coordinate[] {
  const points: Coordinate[] = [];
  for (const line of kml.matchAll(/<(?:\w+:)?LineString\b[^>]*>([\s\S]*?)<\/(?:\w+:)?LineString>/gi)) {
    const coords = /<(?:\w+:)?coordinates\b[^>]*>([\s\S]*?)<\/(?:\w+:)?coordinates>/i.exec(line[1]);
    if (!coords) continue;
    for (const tuple of coords[1].trim().split(/\s+/)) { const [lon, lat] = tuple.split(',').map(Number); const point = coordinate({ lat, lon }); if (point) points.push(point); }
  }
  return points;
}
