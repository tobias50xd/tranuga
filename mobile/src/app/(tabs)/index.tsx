import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { AppState, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { routeState, routeStateLabel, sortRoutes } from '../../../../src/route-presentation';
import type { Route } from '../../../../src/types';
import { Badge, Button, Heading, Loading, Notice, palette, styles } from '../../components/ui';
import { errorMessage, networkKey, useTransit } from '../../transit';

function RouteCatalog() {
  const router = useRouter();
  const { agency, service, favorites, toggleFavorite } = useTransit();
  const [routes, setRoutes] = useState<Route[]>();
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const reload = useRef<() => void>(() => {});
  const [query, setQuery] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);

  useFocusEffect(useCallback(() => {
    let disposed = false;
    let loading = false;
    async function load() {
      if (loading) return;
      loading = true;
      try {
        const next = await service.getLiveRoutes();
        if (!disposed) { setRoutes(next); setError(''); }
      } catch (failure) {
        if (!disposed) setError(errorMessage(failure));
      } finally {
        loading = false;
        if (!disposed) setRefreshing(false);
      }
    }
    reload.current = () => void load();
    void load();
    const poll = setInterval(() => { if (AppState.currentState === 'active') void load(); }, 60_000);
    return () => { disposed = true; clearInterval(poll); reload.current = () => {}; };
  }, [service]));

  function refresh() {
    setRefreshing(true);
    reload.current();
  }

  const term = query.trim().toLocaleLowerCase();
  const visible = sortRoutes(routes ?? [], favorites).filter(route =>
    (!activeOnly || routeState(route) === 'active') &&
    `${route.shortName} ${route.name}`.toLocaleLowerCase().includes(term)
  );

  return <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
    <FlatList data={visible} keyExtractor={route => route.id} refreshing={refreshing} onRefresh={refresh}
      keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}
      ListHeaderComponent={<View style={{ gap: 14 }}>
        <Heading kicker={agency.name} title="TranUGA" />
        <TextInput accessibilityLabel="Search routes" onChangeText={setQuery} value={query}
          placeholder="Search route names or numbers" placeholderTextColor={palette.muted} style={styles.input} />
        <View style={styles.row}>
          <Button label={activeOnly ? 'Show all routes' : 'Active routes only'}
            icon={activeOnly ? 'checkmark-circle' : 'filter-outline'} onPress={() => setActiveOnly(value => !value)} />
          {routes ? <Text style={styles.small}>{visible.length} of {routes.length} routes</Text> : null}
        </View>
        {error ? <Notice text={error} action={{ label: 'Refresh routes', onPress: refresh }} /> : null}
      </View>}
      ListEmptyComponent={!routes && !error ? <Loading label="Loading routes…" /> : routes ? <Text style={styles.muted}>No routes match your filters.</Text> : null}
      renderItem={({ item }) => {
        const state = routeState(item);
        const starred = favorites.has(item.id);
        return <View style={[styles.card, styles.row, { flexWrap: 'nowrap', paddingVertical: 10 }]}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${item.shortName}, ${item.name}, ${routeStateLabel[state]}`}
            style={[styles.row, { flex: 1, flexWrap: 'nowrap', minHeight: 50 }]}
            onPress={() => router.push({ pathname: '/routes/[id]', params: { id: item.id } })}>
            <Badge label={item.shortName} color={item.color} />
            <View style={styles.grow}>
              <Text style={styles.label}>{item.name}</Text>
              <Text style={state === 'active' ? { color: palette.green, fontSize: 12, fontWeight: '700' } : styles.small}>
                {routeStateLabel[state]}
              </Text>
            </View>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`${starred ? 'Remove' : 'Add'} ${item.shortName} ${starred ? 'from' : 'to'} favorites`}
            onPress={() => toggleFavorite(item.id)} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={starred ? 'star' : 'star-outline'} size={21} color={starred ? palette.amber : palette.muted} />
          </Pressable>
        </View>;
      }} />
  </SafeAreaView>;
}

export default function RoutesScreen() {
  const { agency } = useTransit();
  return <RouteCatalog key={networkKey(agency)} />;
}
