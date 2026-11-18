import { Ionicons } from '@expo/vector-icons';
import { Camera, GeoJSONSource, Layer, Map as NativeMap, Marker, type CameraRef } from '@maplibre/maplibre-react-native';
import type { Feature, LineString, Point } from 'geojson';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Linking, StyleSheet, Text, View } from 'react-native';
import type { Coordinate, Vehicle } from '../../../src/types';
import { headingLabel } from '../../../src/ui';
import { VehicleMotion } from '../../../src/vehicle-motion';
import { vehicleIsStale } from '../../../src/vehicle-selection';
import { palette } from './ui';

export interface MapLine { points: Coordinate[]; color: string; approximate?: boolean }
export interface MapStop extends Coordinate { id: string; name: string }
export interface MapPin extends Coordinate { id: string; label: string; color: string }
type MapVehicle = Vehicle & { color: string };

const osmStyle = JSON.stringify({
  version: 8,
  sources: {
    osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>' },
  },
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e8ede4' } },
    { id: 'osm', type: 'raster', source: 'osm' }],
});
const customStyle = process.env.EXPO_PUBLIC_MAP_STYLE_URL;
const lngLat = ({ lon, lat }: Coordinate): [number, number] => [lon, lat];
const emptyVehicles: MapVehicle[] = [];
const emptyStops: MapStop[] = [];
const emptyPins: MapPin[] = [];

function useAnimatedBuses(vehicles: readonly MapVehicle[]) {
  const motion = useRef(new Map<string, VehicleMotion>());
  const [positions, setPositions] = useState<Vehicle[]>(vehicles.slice());
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    let disposed = false;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (!disposed) setReduced(value); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { disposed = true; subscription.remove(); };
  }, []);

  useEffect(() => {
    const now = Date.now();
    const next = new Map<string, VehicleMotion>();
    for (const vehicle of vehicles) {
      const existing = motion.current.get(vehicle.id);
      if (existing) {
        existing.update(vehicle, now, reduced);
        if (reduced) existing.finish();
      }
      next.set(vehicle.id, existing ?? new VehicleMotion(vehicle));
    }
    motion.current = next;
    let frame = 0;
    let painted = 0;
    function tick() {
      const at = Date.now();
      const active = [...next.values()];
      const moving = active.some(bus => bus.moving(at));
      if (at - painted >= 32 || !moving) {
        painted = at;
        setPositions(active.map(bus => ({ ...bus.latest, ...bus.sample(at) })));
      }
      if (moving) frame = requestAnimationFrame(tick);
    }
    tick();
    return () => cancelAnimationFrame(frame);
  }, [reduced, vehicles]);

  return positions;
}

function BusMarkers({ vehicles, onPress }: { vehicles: MapVehicle[]; onPress?: (id: string) => void }) {
  const colors = useMemo(() => new Map(vehicles.map(vehicle => [vehicle.id, vehicle.color])), [vehicles]);
  const positions = useAnimatedBuses(vehicles);
  return <>{positions.map(vehicle => {
    const color = vehicleIsStale(vehicle) ? '#68736e' : (colors.get(vehicle.id) || palette.green);
    return <Marker key={vehicle.id} id={`bus-${vehicle.id}`} lngLat={lngLat(vehicle)}
      onPress={onPress ? () => onPress(vehicle.id) : undefined}>
      <View accessible accessibilityLabel={`Bus ${vehicle.id}, heading ${headingLabel(vehicle.heading)}`}
        style={[mapStyles.bus, { backgroundColor: color }]}>
        <View style={[mapStyles.bearing, { transform: [{ rotate: `${vehicle.heading}deg` }] }]} />
        <Ionicons name="bus" size={14} color="#fff" />
      </View>
    </Marker>;
  })}</>;
}

export function TransitMap({ center, lines, stops = emptyStops, pins = emptyPins, vehicles = emptyVehicles, onStop, onPick, onVehicle }: {
  center: Coordinate; lines: MapLine[]; stops?: MapStop[]; pins?: MapPin[]; vehicles?: MapVehicle[];
  onStop?: (id: string) => void; onPick?: (point: Coordinate) => void; onVehicle?: (id: string) => void;
}) {
  const camera = useRef<CameraRef>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const lineFeatures = useMemo<Feature<LineString>[]>(() => lines.filter(line => line.points.length > 1).map(line => ({
    type: 'Feature', geometry: { type: 'LineString', coordinates: line.points.map(lngLat) },
    properties: { color: line.color, approximate: !!line.approximate },
  })), [lines]);
  const stopFeatures = useMemo<Feature<Point>[]>(() => stops.map(stop => ({
    type: 'Feature', id: stop.id, geometry: { type: 'Point', coordinates: lngLat(stop) }, properties: { id: stop.id },
  })), [stops]);

  useEffect(() => {
    if (!loaded) return;
    const points = [...lines.flatMap(line => line.points), ...stops, ...pins];
    if (!points.length) return;
    let west = 180, south = 90, east = -180, north = -90;
    for (const point of points) {
      west = Math.min(west, point.lon); east = Math.max(east, point.lon);
      south = Math.min(south, point.lat); north = Math.max(north, point.lat);
    }
    if (east === west && north === south) camera.current?.jumpTo({ center: [west, south], zoom: 15 });
    else camera.current?.fitBounds([west, south, east, north], { padding: { top: 32, right: 32, bottom: 32, left: 32 }, duration: 0 });
  }, [lines, loaded, pins, stops]);

  return <View style={mapStyles.container}>
    <NativeMap androidView="texture" style={mapStyles.map} mapStyle={customStyle || osmStyle} touchRotate={false}
      attribution={!!customStyle}
      onDidFinishLoadingMap={() => { setLoaded(true); setFailed(false); }}
      onDidFailLoadingMap={() => setFailed(true)}
      onPress={onPick ? ({ nativeEvent }) => {
        const [lon, lat] = nativeEvent.lngLat;
        onPick({ lat, lon });
      } : undefined}>
      <Camera ref={camera} initialViewState={{ center: lngLat(center), zoom: 13 }} maxZoom={18} />
      <GeoJSONSource id="transit-lines" data={{ type: 'FeatureCollection', features: lineFeatures }}>
        <Layer id="solid-lines" type="line" filter={['==', ['get', 'approximate'], false]}
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': ['get', 'color'], 'line-width': 5, 'line-opacity': .95 }} />
        <Layer id="approximate-lines" type="line" filter={['==', ['get', 'approximate'], true]}
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': ['get', 'color'], 'line-width': 4, 'line-dasharray': [1.6, 2] }} />
      </GeoJSONSource>
      <GeoJSONSource id="transit-stops" data={{ type: 'FeatureCollection', features: stopFeatures }}
        onPress={onStop ? event => {
          const id = event.nativeEvent.features[0]?.properties?.id;
          if (typeof id === 'string') { event.stopPropagation(); onStop(id); }
        } : undefined}>
        <Layer id="stops" type="circle"
          paint={{ 'circle-color': '#ffffff', 'circle-stroke-color': '#172822', 'circle-radius': 4, 'circle-stroke-width': 2 }} />
      </GeoJSONSource>
      {pins.map(pin => <Marker key={pin.id} id={pin.id} lngLat={lngLat(pin)}>
        <View accessible accessibilityLabel={pin.label} style={[mapStyles.pin, { backgroundColor: pin.color }]}>
          <Text style={mapStyles.pinText}>{pin.id === 'origin' ? 'A' : pin.id === 'destination' ? 'B' : '↔'}</Text>
        </View>
      </Marker>)}
      <BusMarkers vehicles={vehicles} onPress={onVehicle} />
    </NativeMap>
    {!customStyle ? <Text accessibilityRole="link" style={mapStyles.attribution}
      onPress={() => void Linking.openURL('https://www.openstreetmap.org/copyright').catch(() => {})}>
      © OpenStreetMap contributors
    </Text> : null}
    {failed ? <Text style={mapStyles.message}>Map tiles are unavailable.</Text> : null}
  </View>;
}

const mapStyles = StyleSheet.create({
  container: { overflow: 'hidden', height: 340, borderRadius: 16, backgroundColor: '#e8ede4', borderWidth: 1, borderColor: palette.border },
  map: { flex: 1 },
  pin: { width: 25, height: 25, borderRadius: 13, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  pinText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  bus: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  bearing: { position: 'absolute', top: -4, width: 0, height: 0, borderLeftWidth: 4, borderRightWidth: 4,
    borderBottomWidth: 6, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#fff',
    transformOrigin: 'center 15px' },
  message: { position: 'absolute', top: 10, left: 10, backgroundColor: '#fff', padding: 8, borderRadius: 8, color: palette.ink },
  attribution: { position: 'absolute', right: 0, bottom: 0, backgroundColor: '#fffe', color: palette.ink, paddingHorizontal: 6, paddingVertical: 3, fontSize: 11 },
});
