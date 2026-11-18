import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import type { PassioJourneyComparison, PassioTimetable } from '../../../src/api/passio';
import type { Coordinate, Vehicle } from '../../../src/types';
import { headingLabel, vehicleAge } from '../../../src/ui';
import { useTransit } from '../transit';
import { Button, Notice, useUI } from './ui';
import { useRequest } from './use-request';

export function FleetSearch() {
  const { palette, styles } = useUI();
  const { service } = useTransit();
  const [query, setQuery] = useState('');
  const lookup = useRequest<Vehicle[]>();
  return <View style={styles.card}>
    <View style={styles.row}>
      <TextInput accessibilityLabel="Bus fleet number" placeholder="Fleet number" placeholderTextColor={palette.muted}
        style={[styles.input, { flex: 1, minWidth: 100 }]} value={query} maxLength={40}
        onChangeText={value => { setQuery(value); lookup.clear(); }} />
      <Button label="Find bus" busy={lookup.busy} disabled={!query.trim()} onPress={() => void lookup.run(() => service.searchBuses(query.trim()))} />
    </View>
    {lookup.error ? <Notice text={lookup.error} /> : null}
    {lookup.value?.length === 0 ? <Text style={styles.small}>No matching bus was reported.</Text> : null}
    {lookup.value?.map(bus => <Text key={bus.id} style={styles.label}>Bus {bus.id} · Route {bus.routeId} · {headingLabel(bus.heading)} · {vehicleAge(bus.updatedAt)}</Text>)}
  </View>;
}

export function Timetable({ stopId, routeId }: { stopId: string; routeId: string }) {
  const { styles } = useUI();
  const { service } = useTransit();
  const lookup = useRequest<PassioTimetable>();
  return <View style={{ gap: 6 }}>
    <Button label="Provider timetable" busy={lookup.busy} onPress={() => void lookup.run(() => service.getTimetable(stopId, routeId))} />
    {lookup.error ? <Notice text={lookup.error} /> : null}
    {lookup.value ? <Text style={styles.small}>
      {lookup.value.times.join(' · ') || 'No upcoming timetable entries'}
      {lookup.value.timezone ? ` · ${lookup.value.timezone}` : ''} · Provider clock times
    </Text> : null}
  </View>;
}

export function OperatorComparison({ origin, destination, disabled }: { origin?: Coordinate; destination?: Coordinate; disabled: boolean }) {
  const { styles } = useUI();
  const { service } = useTransit();
  const comparison = useRequest<PassioJourneyComparison>();
  return <View style={{ gap: 8 }}>
    <Button label="Request provider comparison" busy={comparison.busy} disabled={disabled || !origin || !destination}
      onPress={() => {
        if (origin && destination) void comparison.run(() => service.compareJourney(origin, destination));
      }} />
    {comparison.error ? <Notice text={comparison.error} /> : null}
    {comparison.value?.routes.length === 0 ? <Text style={styles.small}>The provider returned no transit suggestion.</Text> : null}
    {comparison.value?.routes.map((route, index) => <View key={index} style={styles.card}>
      <Text style={styles.label}>{route.label}</Text>
      <Text style={styles.small}>{route.durationSeconds === undefined ? 'Duration unavailable' : `${Math.ceil(route.durationSeconds / 60)} min`}
        {route.transfers === undefined ? '' : ` · ${route.transfers} transfers`}</Text>
      {route.legs.map((leg, i) => <Text key={i} style={styles.small}>
        {leg.mode === 'ride' ? leg.routeName || 'Bus' : 'Walk'}{leg.fromStopName ? ` · ${leg.fromStopName}` : ''}{leg.toStopName ? ` → ${leg.toStopName}` : ''}
      </Text>)}
    </View>)}
    {comparison.value?.warnings.map(text => <Text key={text} style={styles.small}>{text}</Text>)}
  </View>;
}
