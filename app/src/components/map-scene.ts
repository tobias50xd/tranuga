import type { ReactElement } from 'react';
import type { Coordinate } from '../../../src/types';
import type { UserLocation } from '../../../src/location';
import { routeViewportBounds } from '../../../src/route-viewport';

export interface MapLine { points: Coordinate[]; color: string; approximate?: boolean }
export interface MapStop extends Coordinate { id: string; name: string }
export interface MapPin extends Coordinate { id: string; label: string; color: string }
export interface MapAnnotation { id: string; label: string; point: Coordinate; content: ReactElement; onPress?: () => void }
export type MapBounds = [west: number, south: number, east: number, north: number];
export interface MapScene {
  center: Coordinate;
  lines: MapLine[];
  stops: MapStop[];
  annotations: MapAnnotation[];
  bounds?: MapBounds;
  locked: boolean;
  dark: boolean;
  location?: UserLocation;
  focusPoint?: Coordinate;
  zoomRequest?: { delta: number };
  onPick?: (point: Coordinate) => void;
  onStop?: (id: string) => void;
}

export function mapBounds(points: Coordinate[]): MapBounds | undefined {
  if (!points.length) return;
  let west = 180, south = 90, east = -180, north = -90;
  for (const point of points) {
    west = Math.min(west, point.lon); east = Math.max(east, point.lon);
    south = Math.min(south, point.lat); north = Math.max(north, point.lat);
  }
  return [west, south, east, north];
}

const canonicalY = (lat: number) => {
  const radians = Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180;
  return .5 - Math.asinh(Math.tan(radians)) / (2 * Math.PI);
};
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function overviewZoom([west, south, east, north]: MapBounds, width: number, height: number, tileSize: number) {
  return clamp(Math.log2(Math.min(
    Math.max(1, width - 64) / Math.max(1e-10, (east - west) / 360),
    Math.max(1, height - 64) / Math.max(1e-10, canonicalY(south) - canonicalY(north)),
  ) / tileSize), 0, 18);
}

export function constrainedCenter(center: Coordinate, [west, south, east, north]: MapBounds, width: number, height: number, worldSize: number): Coordinate {
  const x = (lon: number) => (lon + 180) / 360 * worldSize;
  const y = (lat: number) => canonicalY(lat) * worldSize;
  const area = routeViewportBounds({ min: { x: x(west), y: y(north) }, max: { x: x(east), y: y(south) } }, { x: width, y: height });
  const nextX = clamp(x(center.lon), area.min.x + width / 2, area.max.x - width / 2);
  const nextY = clamp(y(center.lat), area.min.y + height / 2, area.max.y - height / 2);
  return { lon: nextX / worldSize * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * nextY / worldSize))) * 180 / Math.PI };
}

export function accuracyRing(location: UserLocation): Coordinate[] {
  if (!location.accuracy) return [];
  const radius = location.accuracy / 111_195;
  const cosine = Math.max(.01, Math.cos(location.lat * Math.PI / 180));
  return Array.from({ length: 33 }, (_, i) => {
    const theta = i / 32 * Math.PI * 2;
    return { lat: clamp(location.lat + radius * Math.sin(theta), -85.0511, 85.0511),
      lon: ((location.lon + radius / cosine * Math.cos(theta) + 540) % 360) - 180 };
  });
}
