import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Keyboard, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { journeyTransfers, rideGeometry } from '../../../../src/journey-map';
import { matchStops, nearestPlaces, type Place } from '../../../../src/places';
import { parseCoordinate, planJourney, type Journey } from '../../../../src/planner';
import { knownStops } from '../../../../src/replication';
import type { Coordinate, Network, Stop, Vehicle } from '../../../../src/types';
import { clockTime, safeColor } from '../../../../src/ui';
import { TransitMap, type MapLine, type MapPin } from '../../components/TransitMap';
import { Button, Heading, Notice, palette, styles } from '../../components/ui';
import { currentPosition, defaultCenter, errorMessage, networkKey, placeSearch, useTransit } from '../../transit';

type Side = 'origin' | 'destination';
interface Endpoint { label: string; point?: Coordinate }
const empty: Endpoint = { label: '' };
const endpointLabel = { origin: 'Start', destination: 'Destination' };
const walkingLimits = [800, 1200, 2000];
const startColor = palette.green;
const endColor = palette.red;

function PlaceField({ side, value, stops, center, near, disabled, onChange, onFocus, active }: {
  side: Side; value: Endpoint; stops: Stop[]; center: Coordinate; near: Coordinate; disabled: boolean; active: boolean;
  onChange: (value: Endpoint) => void; onFocus: () => void;
}) {
  const [addressResult, setAddressResult] = useState<{ query: string; places: Place[]; failed?: boolean }>();
  const term = value.label.trim();
  const suggest = active && !value.point && term.length >= 2 && !/^[-+\d.\s,]+$/.test(term);
  const local = useMemo(() => suggest ? matchStops(stops, term, near) : [], [stops, suggest, term, near]);
  const remote = suggest && term.length >= 3 && local.length < 3 && !local.some(item => item.label.toLocaleLowerCase() === term.toLocaleLowerCase());
  const result = remote && addressResult?.query === term ? addressResult : undefined;
  const suggestions = result?.places.length ? nearestPlaces([...local, ...result.places], near, 6) : local;

  useEffect(() => {
    if (!remote) return;
    const request = new AbortController();
    const timer = setTimeout(() => {
      void placeSearch.search(term, center, request.signal).then(places => {
        if (!request.signal.aborted) setAddressResult({ query: term, places });
      }).catch(() => { if (!request.signal.aborted) setAddressResult({ query: term, places: [], failed: true }); });
    }, 500);
    return () => { clearTimeout(timer); request.abort(); };
  }, [remote, term, center]);

  return <View style={{ gap: 7 }}>
    <Text style={styles.label}>{endpointLabel[side]}</Text>
    <TextInput accessibilityLabel={endpointLabel[side]} editable={!disabled} autoCorrect={false} value={value.label}
      placeholder={side === 'origin' ? 'Stop, address, or coordinates' : 'Where are you going?'} placeholderTextColor={palette.muted}
      onFocus={onFocus} onChangeText={label => {
        setAddressResult(undefined);
        onChange({ label, point: parseCoordinate(label) ?? undefined });
      }} style={styles.input} />
    {suggestions.map(item => <Pressable key={item.id}
      accessibilityRole="button" onPress={() => { onChange({ label: item.label, point: item }); Keyboard.dismiss(); }} style={styles.card}>
      <Text style={styles.label}>{item.label}</Text>
      <Text style={styles.small}>{item.kind === 'stop' ? 'Bus stop' : item.detail}</Text>
    </Pressable>)}
    {result?.failed ? <Text style={styles.small}>Address search unavailable. Try a stop or the map.</Text> : null}
  </View>;
}

function Planner() {
  const { agency, service, tripStart, setTripStart } = useTransit();
  const center = agency.center ?? defaultCenter;
  const [stops, setStops] = useState(() => knownStops(agency));
  const [origin, setOrigin] = useState(empty);
  const [destination, setDestination] = useState(empty);
  const [focus, setFocus] = useState<Side>();
  const [picking, setPicking] = useState<Side>();
  const [limit, setLimit] = useState(1200);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ journey: Journey; network: Network }>();
  const [liveVehicles, setLiveVehicles] = useState<Vehicle[]>();
  const [notes, setNotes] = useState(false);
  const revisions = useRef({ trip: 0, location: 0 });
  const scroll = useRef<ScrollView>(null);
  const mapTop = useRef(0);

  useEffect(() => {
    const requests = revisions.current;
    let active = true;
    void service.getStops().then(value => {
      if (active) setStops(previous => [...new Map([...previous, ...value].map(stop => [stop.id, stop])).values()]);
    }).catch(() => {});
    return () => { active = false; requests.trip++; requests.location++; };
  }, [service]);

  useFocusEffect(useCallback(() => {
    if (!result) return;
    let active = true;
    const poll = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      void service.refreshVehicles().then(value => { if (active) setLiveVehicles(value); }).catch(() => {});
    }, 15_000);
    return () => { active = false; clearInterval(poll); };
  }, [result, service]));

  useEffect(() => {
    if (!tripStart) return;
    revisions.current.trip++;
    revisions.current.location++;
    setOrigin({ label: tripStart.name, point: tripStart });
    setResult(undefined); setLiveVehicles(undefined); setError(''); setBusy(false); setLocating(false);
    setTripStart(undefined);
  }, [tripStart, setTripStart]);

  function clearResult() {
    revisions.current.trip++;
    setResult(undefined); setLiveVehicles(undefined); setError('');
  }

  function update(side: Side, value: Endpoint) {
    revisions.current.location++;
    setLocating(false);
    if (side === 'origin') setOrigin(value); else setDestination(value);
    if (value.point) setFocus(undefined);
    clearResult();
  }

  function pick(side: Side) {
    setFocus(undefined);
    setPicking(side);
    Keyboard.dismiss();
    requestAnimationFrame(() => scroll.current?.scrollTo({ y: Math.max(0, mapTop.current - 54), animated: true }));
  }

  async function locate() {
    const token = ++revisions.current.location;
    setLocating(true); setError('');
    try {
      const point = await currentPosition();
      if (token === revisions.current.location) {
        update('origin', { label: 'Current location', point });
        setPicking(undefined);
      }
    } catch (failure) {
      if (token === revisions.current.location) setError(errorMessage(failure));
    } finally {
      if (token === revisions.current.location) setLocating(false);
    }
  }

  async function calculate() {
    if (!origin.point || !destination.point) {
      setError('Choose a start and destination from the suggestions, enter coordinates, or use the map.');
      return;
    }
    Keyboard.dismiss();
    setFocus(undefined); setPicking(undefined); setBusy(true); setResult(undefined); setLiveVehicles(undefined); setError('');
    const token = ++revisions.current.trip;
    try {
      const network = await service.getNetwork();
      if (token !== revisions.current.trip) return;
      const value = planJourney(network, origin.point, destination.point, { maxWalkMeters: limit });
      if (value.status === 'unavailable') setError(value.reason);
      else setResult({ journey: value.journey, network });
    } catch (failure) {
      if (token === revisions.current.trip) setError(errorMessage(failure));
    } finally {
      if (token === revisions.current.trip) setBusy(false);
    }
  }

  const { lines, routeColors, transfers } = useMemo(() => {
    const lines: MapLine[] = [];
    const routeColors = new Map<string, string>();
    const transfers: MapPin[] = [];
    if (result) {
      const { journey, network } = result;
      const colors = new Map(network.routes.map(route => [route.id, safeColor(route.color)]));
      for (const leg of journey.legs) {
        if (leg.kind === 'walk') lines.push({ points: [leg.from, leg.to], color: palette.green, approximate: true });
        if (leg.kind === 'ride') {
          const geometry = rideGeometry(leg, network);
          const color = colors.get(leg.routeId) ?? palette.green;
          routeColors.set(leg.routeId, color);
          lines.push(...geometry.segments.map(points => ({ points, color, approximate: geometry.approximate })));
        }
      }
      for (const transfer of journeyTransfers(journey)) {
        transfers.push({ ...transfer.from, id: `transfer-${transfer.index}-from`, color: '#673790', label: `Transfer at ${transfer.from.name}` });
        if (transfer.from.id !== transfer.to.id) transfers.push({
          ...transfer.to, id: `transfer-${transfer.index}-to`, color: '#673790', label: `Board next bus at ${transfer.to.name}`,
        });
      }
    }
    return { lines, routeColors, transfers };
  }, [result]);
  const pins = useMemo(() => [
    ...(origin.point ? [{ ...origin.point, id: 'origin', label: `Start: ${origin.label}`, color: startColor }] : []),
    ...(destination.point ? [{ ...destination.point, id: 'destination', label: `Destination: ${destination.label}`, color: endColor }] : []),
    ...transfers,
  ], [origin, destination, transfers]);
  const vehicles = useMemo(() => (liveVehicles ?? result?.network.vehicles ?? []).flatMap(bus => {
    const color = routeColors.get(bus.routeId);
    return color ? [{ ...bus, color }] : [];
  }), [liveVehicles, result, routeColors]);

  return <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
    <ScrollView ref={scroll} contentContainerStyle={styles.content} nestedScrollEnabled keyboardShouldPersistTaps="handled">
      <Heading kicker={agency.name} title="Plan a trip" />
      <View style={styles.card}>
        <PlaceField side="origin" value={origin} stops={stops} center={center} near={destination.point ?? center} active={focus === 'origin'} disabled={busy}
          onFocus={() => setFocus('origin')} onChange={value => update('origin', value)} />
        <View style={styles.row}>
          <Button label="My location" icon="locate-outline" busy={locating} disabled={busy} onPress={() => void locate()} />
          <Button label="Pick start" icon="pin-outline" disabled={busy} onPress={() => pick('origin')} />
        </View>
        <PlaceField side="destination" value={destination} stops={stops} center={center} near={origin.point ?? center} active={focus === 'destination'} disabled={busy}
          onFocus={() => setFocus('destination')} onChange={value => update('destination', value)} />
        <View style={styles.row}>
          <Button label="Pick destination" icon="pin-outline" disabled={busy} onPress={() => pick('destination')} />
          <Button label="Swap points" icon="swap-vertical" disabled={busy} onPress={() => {
            revisions.current.location++;
            setLocating(false); setOrigin(destination); setDestination(origin); clearResult();
          }} />
        </View>
      </View>
      <View style={{ gap: 8 }}>
        <Text style={styles.label}>Maximum walk to or from a stop</Text>
        <View style={styles.row}>
          {walkingLimits.map(value => <Button key={value} label={value >= 1000 ? `${value / 1000} km` : `${value} m`}
            primary={limit === value} disabled={busy} onPress={() => { setLimit(value); clearResult(); }} />)}
        </View>
      </View>
      <Button label={busy ? 'Calculating route…' : 'Find quickest bus trip'} icon="navigate-outline" primary busy={busy} routeLoading
        disabled={locating} onPress={() => void calculate()} />
      {error ? <Notice text={error} /> : null}
      {result ? <View style={[styles.card, { backgroundColor: palette.softGreen }]}>
        <Text style={styles.kicker}>QUICKEST ESTIMATED CONNECTION</Text>
        <Text accessibilityRole="header" style={styles.title}>{Math.ceil(result.journey.durationSeconds / 60)} min</Text>
        <Text style={styles.muted}>Arrive {clockTime(result.journey.arrivalTime)} · {result.journey.transfers} transfers · {Math.round(result.journey.walkingMeters)} m walking</Text>
        <Text style={styles.small}>{result.journey.confidence === 'live-assisted' ? 'Uses live predictions or recent bus positions' : 'Estimated timing'}</Text>
      </View> : null}
      <View onLayout={event => { mapTop.current = event.nativeEvent.layout.y; }} style={{ gap: 8 }}>
        {picking ? <View style={styles.row}><Text style={styles.label}>Tap the map to set {picking === 'origin' ? 'your start' : 'your destination'}</Text>
          <Button label="Cancel" onPress={() => setPicking(undefined)} /></View> : null}
        <TransitMap center={center} lines={lines} pins={pins} vehicles={vehicles} onPick={picking ? point => {
          update(picking, { label: `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`, point });
          setPicking(undefined);
        } : undefined} />
      </View>
      {result ? <>
        {result.journey.legs.map((leg, index) => <View key={index} style={styles.card}>
          <Text style={styles.kicker}>{clockTime(leg.startTime)} – {clockTime(leg.endTime)}</Text>
          <Text style={styles.label}>{leg.kind === 'ride' ? leg.routeName : leg.kind === 'wait' ? 'Wait for the bus' : 'Walk'}</Text>
          <Text style={styles.muted}>{leg.kind === 'wait' ? leg.from.name : `${leg.from.name} → ${leg.to.name}`}</Text>
          {leg.kind === 'ride' ? <Text style={styles.small}>{leg.direction} · {leg.source === 'live' ? 'Live ETA' : leg.source === 'vehicle' ? 'Recent bus position' : 'Estimated'}</Text> : null}
        </View>)}
        <Button label={notes ? 'Hide estimate details' : 'How this estimate works'} onPress={() => setNotes(value => !value)} />
        {notes ? [...new Set([...result.journey.assumptions, ...result.network.messages, ...result.network.warnings])]
          .map(note => <Text key={note} style={styles.small}>{note}</Text>) : null}
      </> : null}
    </ScrollView>
  </SafeAreaView>;
}

export default function PlannerScreen() {
  const { agency } = useTransit();
  return <Planner key={networkKey(agency)} />;
}
