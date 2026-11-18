import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { discoverAgencies, findAgenciesByCode, locateAgencies } from '../../../../src/api';
import type { PassioSystemInfo } from '../../../../src/api/passio';
import type { Agency, Network } from '../../../../src/types';
import { Button, Heading, Loading, Notice, useUI } from '../../components/ui';
import { useRequest } from '../../components/use-request';
import { currentPosition, networkKey, networks, useTransit } from '../../transit';

function DataSources() {
  const { styles } = useUI();
  const { service } = useTransit();
  const [expanded, setExpanded] = useState(false);
  const [, setFocused] = useState(0);
  const sync = useRequest<Network>();
  const info = useRequest<PassioSystemInfo>();
  useFocusEffect(useCallback(() => { setFocused(value => value + 1); }, []));
  const report = service.report;
  return <View style={styles.card}>
    <Button label={expanded ? 'Hide data sources' : 'Show data sources'} onPress={() => setExpanded(value => !value)} />
    {expanded ? <>
      <Text style={styles.label}>{report.healthy}/{report.total} {report.mode === 'replicas' ? 'replicas' : 'feeds'} responding</Text>
      {report.sources.map(source => <View key={source.id}>
        <Text style={styles.label}>{source.label}</Text>
        <Text style={styles.small}>{source.state}{source.detail ? ` · ${source.detail}` : ''}</Text>
        {source.error ? <Text style={styles.small}>{source.error}</Text> : null}
      </View>)}
      <Text style={styles.small}>{report.agreements} matching · {report.conflicts} disagreements · {report.cached} saved</Text>
      <View style={styles.row}>
        <Button label="Sync all sources" busy={sync.busy} onPress={() => void sync.run(() => service.sync())} />
        {service.hasPassioFor() ? <Button label="Provider information" busy={info.busy}
          onPress={() => void info.run(() => service.getSystemInfo())} /> : null}
      </View>
      {sync.error || info.error ? <Notice text={sync.error || info.error || ''} /> : null}
      {sync.value ? <Text style={styles.small}>Synced {sync.value.routes.length} routes, {sync.value.stops.length} stops and {sync.value.vehicles.length} buses.</Text> : null}
      {info.value ? <>
        <Text style={styles.label}>{info.value.name}</Text>
        <Text style={styles.small}>System {info.value.id} · API {info.value.version ?? 'version unavailable'}</Text>
        {info.value.routeGroups.map(group => <Text key={group.variantId} style={styles.small}>{group.shortName} · {group.name}</Text>)}
      </> : null}
    </> : null}
  </View>;
}

export default function NetworksScreen() {
  const { palette, styles } = useUI();
  const router = useRouter();
  const { agency, client, selectNetwork, theme, toggleTheme } = useTransit();
  const [filter, setFilter] = useState('');
  const [code, setCode] = useState('');
  const [directory, setDirectory] = useState<Agency[]>([]);
  const [loading, setLoading] = useState(true);
  const [directoryError, setDirectoryError] = useState(false);
  const [directoryAttempt, setDirectoryAttempt] = useState(0);
  const search = useRequest<Agency[]>();

  useEffect(() => {
    let mounted = true;
    void discoverAgencies(client).then(rows => { if (mounted) setDirectory(rows); })
      .catch(() => { if (mounted) setDirectoryError(true); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [client, directoryAttempt]);

  const selectedKey = networkKey(agency);
  const base = [...networks, ...(networks.some(item => networkKey(item) === selectedKey) ? [] : [agency]), ...(search.value ?? directory)];
  const choices = [...new Map(base.map(network => [networkKey(network), network])).values()]
    .filter(network => network.name.toLowerCase().includes(filter.trim().toLowerCase()));

  return <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Heading kicker="TranUGA" title="Transit networks" />
      <Text style={styles.small}>TranUGA {Constants.expoConfig?.version ?? ''}</Text>
      <Button label={`Dark mode ${theme === 'dark' ? 'on' : 'off'}`} icon="moon-outline" selected={theme === 'dark'} onPress={toggleTheme} />
      <DataSources key={selectedKey} />
      <TextInput accessibilityLabel="Search networks" placeholder="Search networks" placeholderTextColor={palette.muted}
        style={styles.input} value={filter} onChangeText={setFilter} />
      <View style={styles.row}>
        <Button label="Find nearby" icon="locate-outline" disabled={search.busy} onPress={() => {
          setFilter(''); void search.run(async () => locateAgencies(await currentPosition(), client));
        }} />
        <TextInput accessibilityLabel="Authority code" placeholder="Authority code" placeholderTextColor={palette.muted}
          maxLength={50} style={[styles.input, { flex: 1, minWidth: 120 }]} value={code} onChangeText={setCode} />
        <Button label="Look up code" disabled={!code.trim() || search.busy} onPress={() => {
          setFilter(''); void search.run(() => findAgenciesByCode(code, client));
        }} />
        {search.value ? <Button label="Show all networks" onPress={search.clear} /> : null}
      </View>
      {search.error ? <Notice text={search.error} /> : null}
      {search.busy || loading ? <Loading label="Loading transit networks…" /> : null}
      {directoryError ? <Notice text="The directory is temporarily unavailable. You can still select a listed network or look up an authority code."
        action={{ label: 'Retry directory', onPress: () => {
          setLoading(true); setDirectoryError(false); setDirectoryAttempt(value => value + 1);
        } }} /> : null}
      {search.value?.length === 0 ? <Text style={styles.small}>No matching directory networks.</Text> : null}
      <View accessibilityRole="radiogroup" style={{ gap: 10 }}>
        {choices.map(network => {
          const selected = selectedKey === networkKey(network);
          return <Pressable key={networkKey(network)} accessibilityRole="radio" accessibilityState={{ checked: selected }}
            onPress={() => { selectNetwork(network); router.navigate('/routes'); }}
            style={[styles.card, styles.row, selected && { backgroundColor: palette.softGreen, borderColor: palette.green }]}>
            <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={palette.green} />
            <View style={styles.grow}>
              <Text style={styles.label}>{network.name}</Text>
              <Text style={styles.small}>{network.kind === 'uga' ? 'UGA, InfoPoint and Passio' : network.kind === 'passio' ? 'Passio' : 'InfoPoint'}</Text>
            </View>
          </Pressable>;
        })}
      </View>
    </ScrollView>
  </SafeAreaView>;
}
