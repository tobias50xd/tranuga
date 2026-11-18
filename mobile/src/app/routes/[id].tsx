import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { RouteVehicleSnapshot } from '../../../../src/replication/route-vehicles';
import type { RouteDetail, Stop, StopDetail } from '../../../../src/types';
import { arrivalLabel, clockTime, headingLabel, safeColor, vehicleAge } from '../../../../src/ui';
import { vehicleIsStale } from '../../../../src/vehicle-selection';
import { TransitMap } from '../../components/TransitMap';
import { Badge, Button, Heading, Loading, Notice, palette, styles } from '../../components/ui';
import { defaultCenter, errorMessage, networkKey, useTransit } from '../../transit';

const initialVehicles: RouteVehicleSnapshot = { vehicles: [], pending: true };

function RouteDetails({ id }: { id: string }) {
  const router = useRouter();
  const { agency, service, setTripStart } = useTransit();
  const [detail, setDetail] = useState<RouteDetail>();
  const reload = useRef<() => void>(() => {});
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState(initialVehicles);
  const [direction, setDirection] = useState('');
  const [selectedStop, setSelectedStop] = useState<Stop>();
  const [selectedBus, setSelectedBus] = useState<string>();
  const [arrivals, setArrivals] = useState<StopDetail>();
  const [stopError, setStopError] = useState('');
  const [notes, setNotes] = useState(false);

  useFocusEffect(useCallback(() => {
    let disposed = false;
    const tracker = service.routeVehicleTracker(id);
    const foreground = () => AppState.currentState === 'active';
    const publish = () => { if (!disposed && foreground()) setSnapshot(tracker.snapshot()); };
    const probe = () => { if (foreground()) void tracker.probe(); };
    let initial = true;
    if (foreground()) void tracker.probe().then(() => { if (initial) publish(); });
    const initialDeadline = setTimeout(() => { initial = false; publish(); }, 5000);
    let repeatingProbe: ReturnType<typeof setInterval> | undefined;
    const firstProbe = setTimeout(() => { probe(); repeatingProbe = setInterval(probe, 15_000); }, 10_000);
    const poll = setInterval(publish, 15_000);
    const activity = AppState.addEventListener('change', state => {
      if (state === 'active') void tracker.probe().then(publish);
    });
    async function loadDetails() {
      try {
        const value = await service.getRoute(id, false);
        if (!disposed) { setDetail(value); setError(''); }
      } catch (failure) {
        if (!disposed) setError(errorMessage(failure));
      }
    }
    reload.current = () => { setError(''); void loadDetails(); };
    void loadDetails();
    return () => {
      disposed = true;
      clearTimeout(initialDeadline);
      clearTimeout(firstProbe);
      clearInterval(repeatingProbe);
      clearInterval(poll);
      activity.remove();
      reload.current = () => {};
    };
  }, [id, service]));

  useEffect(() => {
    if (!selectedStop) return;
    let disposed = false;
    void service.getStop(selectedStop.id).then(value => {
      if (!disposed) setArrivals(value);
    }).catch(failure => { if (!disposed) setStopError(errorMessage(failure)); });
    return () => { disposed = true; };
  }, [selectedStop, service]);

  const { lines, stops } = useMemo(() => {
    if (!detail) return { lines: [], stops: [] };
    const patterns = detail.patterns.filter(pattern => !direction || pattern.id === direction);
    const color = safeColor(detail.route.color);
    return {
      lines: patterns.flatMap(pattern => {
        const traces = pattern.shapeSegments?.length ? pattern.shapeSegments : [pattern.shape];
        const available = traces.filter(trace => trace.length > 1);
        return available.length ? available.map(points => ({ points, color, approximate: false }))
          : [{ points: pattern.stops, color, approximate: true }];
      }),
      stops: direction ? [...new Map(patterns.flatMap(pattern => pattern.stops).map(stop => [stop.id, stop])).values()]
        : detail.stops,
    };
  }, [detail, direction]);
  const vehicles = useMemo(() => snapshot.vehicles.map(bus => ({ ...bus, color: safeColor(detail?.route.color ?? palette.green) })), [detail?.route.color, snapshot]);

  function openStop(stop?: Stop) {
    setSelectedStop(stop); setArrivals(undefined); setStopError('');
  }

  return <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
    <ScrollView contentContainerStyle={styles.content} nestedScrollEnabled>
      <Button label="All routes" icon="arrow-back" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} />
      {error ? <Notice text={error} action={{ label: 'Retry route', onPress: () => reload.current() }} /> : null}
      {!detail && !error ? <Loading label="Loading route and stops…" /> : null}
      {detail ? <>
        <View style={[styles.row, { flexWrap: 'nowrap' }]}>
          <Badge color={detail.route.color} label={detail.route.shortName} />
          <View style={styles.grow}><Heading kicker={agency.name} title={detail.route.name} /></View>
        </View>
        {detail.patterns.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {[{ id: '', direction: 'All directions' }, ...detail.patterns].map(pattern =>
            <Button key={pattern.id} label={pattern.direction} primary={direction === pattern.id}
              onPress={() => { setDirection(pattern.id); openStop(); }} />)}
        </ScrollView> : null}
        <TransitMap center={agency.center ?? defaultCenter} lines={lines} stops={stops} vehicles={vehicles}
          onStop={stopId => openStop(stops.find(stop => stop.id === stopId))} onVehicle={setSelectedBus} />
        <View style={styles.row}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>On the road</Text>
          <Text style={styles.small}>{vehicles.length} {vehicles.length === 1 ? 'bus' : 'buses'} reported</Text>
        </View>
        <Text style={styles.muted}>{snapshot.source
          ? `${snapshot.source} · ${snapshot.saved ? 'Last received positions' : 'Refreshes every 15 seconds'}`
          : snapshot.pending ? 'Checking bus feeds…' : 'Bus feeds unavailable'}</Text>
        {vehicles.map(vehicle => <Pressable key={vehicle.id} accessibilityRole="button" onPress={() => setSelectedBus(vehicle.id)}
          accessibilityState={{ selected: vehicle.id === selectedBus }}
          style={[styles.card, styles.row, vehicle.id === selectedBus && { borderColor: palette.green }]}>
          <Text style={styles.label}>Bus {vehicle.id}</Text>
          <Text style={styles.small}>{headingLabel(vehicle.heading)} · {vehicleAge(vehicle.updatedAt)}{vehicleIsStale(vehicle) ? ' · Last known position' : ''}</Text>
        </Pressable>)}
        {selectedStop ? <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>{selectedStop.name}</Text>
          {stopError ? <Notice text={stopError} /> : !arrivals ? <Loading label="Loading arrivals…" /> : null}
          {arrivals ? (() => {
            const now = Date.now();
            const upcoming = arrivals.departures.filter(item => item.arrivalTime >= now - 30_000)
              .sort((a, b) => a.arrivalTime - b.arrivalTime).slice(0, 8);
            return upcoming.length ? upcoming.map((item, i) => <View key={i} style={styles.row}>
              <Text style={[styles.label, { flex: 1 }]}>Route {item.routeId}{item.direction ? ` · ${item.direction}` : ''}</Text>
              <Text style={styles.small}>{arrivalLabel(item.arrivalTime, now)} · {clockTime(item.arrivalTime)}{item.scheduled ? ' scheduled' : ''}</Text>
            </View>) : <Text style={styles.muted}>No upcoming predictions for this stop.</Text>;
          })() : null}
          <Button label="Start a trip here" icon="navigate-outline" onPress={() => {
            setTripStart(selectedStop);
            router.navigate('/plan');
          }} />
        </View> : null}
        <Text accessibilityRole="header" style={styles.sectionTitle}>Stops</Text>
        {stops.length ? stops.map((stop, index) => <Pressable key={stop.id} accessibilityRole="button"
          accessibilityState={{ selected: selectedStop?.id === stop.id }} onPress={() => openStop(stop)}
          style={[styles.card, styles.row, selectedStop?.id === stop.id && { backgroundColor: palette.softGreen }]}>
          <Text style={styles.kicker}>{index + 1}</Text><Text style={[styles.label, { flex: 1 }]}>{stop.name}</Text>
        </Pressable>) : <Text style={styles.muted}>The operator has not supplied stops for this route.</Text>}
        {detail.warnings.length || detail.messages.length ? <View style={{ gap: 8 }}>
          <Button label={notes ? 'Hide route notes' : 'Show route notes'} onPress={() => setNotes(value => !value)} />
          {notes ? [...new Set([...detail.messages, ...detail.warnings])].map(message => <Notice key={message} text={message} />) : null}
        </View> : null}
      </> : null}
    </ScrollView>
  </SafeAreaView>;
}

export default function RouteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { agency } = useTransit();
  return <RouteDetails id={id} key={`${networkKey(agency)}:${id}`} />;
}
