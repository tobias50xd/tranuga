import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Linking, StyleSheet, Text, View } from 'react-native';
import type { Coordinate, Vehicle } from '../../../src/types';
import type { UserLocation } from '../../../src/location';
import { headingLabel } from '../../../src/ui';
import { VehicleMotion } from '../../../src/vehicle-motion';
import { vehicleIsStale } from '../../../src/vehicle-selection';
import { currentPosition, errorMessage, useTransit } from '../transit';
import { Button, Notice, useUI } from './ui';
import MapRenderer from './MapRenderer';
import { mapBounds, type MapAnnotation, type MapLine, type MapPin, type MapStop } from './map-scene';
export type { MapLine, MapPin, MapStop } from './map-scene';

type MapVehicle = Vehicle & { color: string };
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

export function TransitMap({ center, lines, stops = emptyStops, pins = emptyPins, vehicles = emptyVehicles, focusPoint, onStop, onPick, onVehicle }: {
  center: Coordinate; lines: MapLine[]; stops?: MapStop[]; pins?: MapPin[]; vehicles?: MapVehicle[];
  focusPoint?: Coordinate;
  onStop?: (id: string) => void; onPick?: (point: Coordinate) => void; onVehicle?: (id: string) => void;
}) {
  const { palette, styles } = useUI();
  const { theme, routeLocked, setRouteLocked } = useTransit();
  const [location, setLocation] = useState<UserLocation>();
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');
  const [zoomRequest, setZoomRequest] = useState<{ delta: number }>();
  const lifetime = useRef(true);
  useEffect(() => { lifetime.current = true; return () => { lifetime.current = false; }; }, []);
  const bounds = useMemo(() => mapBounds([...lines.flatMap(line => line.points), ...stops, ...pins]), [lines, pins, stops]);
  const routeBounds = lines.length || stops.length ? bounds : undefined;
  const colors = useMemo(() => new Map(vehicles.map(vehicle => [vehicle.id, vehicle.color])), [vehicles]);
  const positions = useAnimatedBuses(vehicles);

  async function locate() {
    setLocating(true); setError('');
    try {
      const fix = await currentPosition();
      if (!lifetime.current) return;
      if (routeLocked && routeBounds && (
        fix.lon < routeBounds[0] || fix.lon > routeBounds[2] || fix.lat < routeBounds[1] || fix.lat > routeBounds[3]
      )) {
        setRouteLocked(false);
        setError('Route lock was turned off to show your location.');
      }
      setLocation({ ...fix });
    } catch (failure) {
      if (lifetime.current) setError(errorMessage(failure));
    } finally {
      if (lifetime.current) setLocating(false);
    }
  }

  const annotations: MapAnnotation[] = pins.map(pin => ({
    id: pin.id, label: pin.label, point: pin,
    content: <View accessible accessibilityLabel={pin.label} style={[mapStyles.pin, { backgroundColor: pin.color }]}>
      <Text style={mapStyles.pinText}>{pin.id === 'origin' ? 'A' : pin.id === 'destination' ? 'B' : '↔'}</Text>
    </View>,
  }));
  if (location) annotations.push({
    id: 'user-location', label: 'Your location', point: location,
    content: <View accessible accessibilityLabel="Your location" style={[mapStyles.pin, mapStyles.location]} />,
  });
  for (const vehicle of positions) {
    const stale = vehicleIsStale(vehicle);
    const color = stale ? '#798580' : (colors.get(vehicle.id) || '#235b46');
    const label = `Bus ${vehicle.id}, heading ${headingLabel(vehicle.heading)}${stale ? ', last known position' : ''}`;
    annotations.push({
      id: `bus-${vehicle.id}`, label, point: vehicle, onPress: onVehicle ? () => onVehicle(vehicle.id) : undefined,
      content: <View accessible accessibilityLabel={label}
        style={[mapStyles.bus, { backgroundColor: color }]}>
        <View style={[mapStyles.busCenter, stale && mapStyles.busCenterStale]}>
          <View style={{ transform: [{ rotate: `${vehicle.heading}deg` }] }}>
            <Ionicons testID="heading-arrow" name="arrow-up" size={15} color="#fff" style={mapStyles.busArrow} />
          </View>
        </View>
      </View>,
    });
  }

  return <View style={{ gap: 8 }}>
    <View style={[mapStyles.container, { borderColor: palette.border }]}>
      <MapRenderer center={center} lines={lines} stops={stops} annotations={annotations} bounds={bounds}
        locked={routeLocked && !!routeBounds} dark={theme === 'dark'} location={location} focusPoint={focusPoint}
        zoomRequest={zoomRequest} onPick={onPick} onStop={onStop} />
      <Text accessibilityRole="link" style={[mapStyles.attribution, { backgroundColor: palette.surface, color: palette.ink }]}
        onPress={() => void Linking.openURL('https://www.openstreetmap.org/copyright').catch(() => {})}>
        © OpenStreetMap contributors
      </Text>
    </View>
    <View style={styles.row}>
      <Button label="Zoom in" icon="add-outline" onPress={() => setZoomRequest({ delta: 1 })} />
      <Button label="Zoom out" icon="remove-outline" onPress={() => setZoomRequest({ delta: -1 })} />
      <Button label="Show my location" icon="locate-outline" busy={locating} onPress={() => void locate()} />
      <Button label={`Route lock ${routeLocked ? 'on' : 'off'}`} icon={routeLocked ? 'lock-closed-outline' : 'lock-open-outline'}
        selected={routeLocked} onPress={() => setRouteLocked(!routeLocked)} />
    </View>
    {error ? <Notice text={error} /> : null}
  </View>;
}

const mapStyles = StyleSheet.create({
  container: { overflow: 'hidden', height: 350, borderRadius: 16, borderWidth: 1, backgroundColor: '#e8ede4' },
  pin: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  pinText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  location: { backgroundColor: '#267bea', width: 16, height: 16, margin: 6 },
  bus: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  busCenter: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#172822e6', alignItems: 'center', justifyContent: 'center' },
  busCenterStale: { backgroundColor: '#47534e' },
  busArrow: { includeFontPadding: false },
  attribution: { position: 'absolute', right: 0, bottom: 0, paddingHorizontal: 6, paddingVertical: 3, fontSize: 11 },
});
