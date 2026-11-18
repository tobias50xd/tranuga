import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform, useColorScheme } from 'react-native';
import { ApiClient } from '../../src/api';
import { FAVORITES_KEY } from '../../src/favorites';
import { getCurrentLocation, type UserLocation } from '../../src/location';
import { PlaceSearch } from '../../src/places';
import { ROUTE_LOCK_KEY, THEME_KEY, type Theme } from '../../src/preferences';
import { ATHENS_INFO_AGENCY, createTransitService, GEORGIA_AGENCY, PASSIO_ATHENS_AGENCY, PASSIO_UGA_AGENCY } from '../../src/replication';
import { SnapshotStore, SNAPSHOTS_KEY } from '../../src/replication/store';
import type { Agency, Stop } from '../../src/types';

export const networks = [GEORGIA_AGENCY, ATHENS_INFO_AGENCY, PASSIO_UGA_AGENCY, PASSIO_ATHENS_AGENCY];
export const defaultCenter = { lat: 33.948, lon: -83.377 };
const gateway = Platform.OS === 'web' ? '' :
  (process.env.EXPO_PUBLIC_TRANSIT_URL || 'https://tranuga.tobias-seeanner.workers.dev').replace(/\/+$/, '');
const preferencesKey = 'tranuga.mobile.preferences.v1';
export const placeSearch = new PlaceSearch((input, init) => fetch(gateway + String(input), init));
export const networkKey = (agency: Agency) => `${agency.kind}:${agency.id}`;

type Favorites = Record<string, string[]>;
function loadFavorites(current: unknown, legacy: string | null): Favorites {
  const result: Favorites = {};
  try {
    const keys = JSON.parse(legacy || '[]') as unknown;
    if (Array.isArray(keys)) for (const key of keys.slice(-500)) {
      try {
        const entry = typeof key === 'string' ? JSON.parse(key) : null;
        if (!Array.isArray(entry) || entry.length !== 3 || !entry.every(part => typeof part === 'string')) continue;
        const scope = `${entry[0]}:${entry[1]}`;
        (result[scope] ??= []).push(entry[2]);
      } catch { /* Skip an invalid older favorite. */ }
    }
  } catch { /* Ignore invalid older storage. */ }
  if (current && typeof current === 'object') for (const [scope, values] of Object.entries(current)) {
    if (Array.isArray(values)) result[scope] = values.filter((value): value is string => typeof value === 'string').slice(-500);
  }
  return result;
}

function useTransitState() {
  const [agency, setAgency] = useState<Agency>(GEORGIA_AGENCY);
  const [allFavorites, setFavorites] = useState<Favorites>({});
  const [ready, setReady] = useState(false);
  const [savedTheme, setTheme] = useState<Theme>();
  const [routeLocked, setRouteLocked] = useState(true);
  const [tripStart, setTripStart] = useState<Stop>();
  const [store, setStore] = useState(() => new SnapshotStore());
  const system = useColorScheme();
  const theme = savedTheme ?? (system === 'dark' ? 'dark' : 'light');
  const client = useMemo(() => new ApiClient(undefined, `${gateway}/api`), []);
  const service = useMemo(() => createTransitService(agency, client, store), [agency, client, store]);
  const scope = networkKey(agency);
  const favorites = useMemo(() => new Set(allFavorites[scope]), [allFavorites, scope]);

  useEffect(() => {
    let mounted = true;
    const keys = [preferencesKey, FAVORITES_KEY, THEME_KEY, ROUTE_LOCK_KEY, 'tranuga.athens-lock.v1', SNAPSHOTS_KEY];
    void AsyncStorage.multiGet(keys).then(entries => {
      if (!mounted) return;
      const saved = new Map(entries);
      const theme = saved.get(THEME_KEY);
      if (theme === 'light' || theme === 'dark') setTheme(theme);
      setRouteLocked((saved.get(ROUTE_LOCK_KEY) ?? saved.get('tranuga.athens-lock.v1')) !== 'false');
      setStore(new SnapshotStore({
        getItem: key => saved.get(key) ?? null,
        setItem: (key, value) => { void AsyncStorage.setItem(key, value).catch(() => {}); },
      }));
      let preferences: { network?: string; favorites?: unknown; agency?: Agency } = {};
      try { preferences = JSON.parse(saved.get(preferencesKey) || '{}') ?? {}; } catch { /* Use defaults for malformed settings. */ }
      const stored = preferences.agency;
      const discovered = stored?.kind === 'infopoint' && typeof stored.id === 'string' &&
        typeof stored.name === 'string' && typeof stored.restUrl === 'string' ? stored : undefined;
      setAgency(networks.find(item => networkKey(item) === preferences.network) ?? discovered ?? GEORGIA_AGENCY);
      setFavorites(loadFavorites(preferences.favorites, saved.get(FAVORITES_KEY) ?? null));
    }).catch(() => {}).finally(() => { if (mounted) setReady(true); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (ready) void AsyncStorage.setItem(preferencesKey, JSON.stringify({ network: scope, agency, favorites: allFavorites })).catch(() => {});
  }, [ready, scope, agency, allFavorites]);

  return {
    ready, agency, service, client, theme, routeLocked, favorites, tripStart, setTripStart,
    selectNetwork(next: Agency) { setTripStart(undefined); setAgency(next); },
    setRouteLocked(next: boolean) {
      setRouteLocked(next);
      void AsyncStorage.setItem(ROUTE_LOCK_KEY, String(next)).catch(() => {});
    },
    toggleTheme() {
      const next = theme === 'dark' ? 'light' : 'dark';
      setTheme(next);
      void AsyncStorage.setItem(THEME_KEY, next).catch(() => {});
    },
    toggleFavorite(id: string) {
      setFavorites(previous => {
        const ids = new Set(previous[scope]);
        if (ids.has(id)) ids.delete(id); else ids.add(id);
        return { ...previous, [scope]: [...ids].slice(-500) };
      });
    },
  };
}

const TransitContext = createContext<ReturnType<typeof useTransitState> | undefined>(undefined);
export function TransitProvider({ children }: { children: ReactNode }) {
  return <TransitContext.Provider value={useTransitState()}>{children}</TransitContext.Provider>;
}

export function useTransit() {
  const transit = useContext(TransitContext);
  if (!transit) throw new Error('TransitProvider is required.');
  return transit;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Transit data is temporarily unavailable.';
}

export async function currentPosition(): Promise<UserLocation> {
  if (Platform.OS === 'web') return getCurrentLocation();
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new Error('Location access was denied. Choose an address, stop, or point on the map.');
  const recent = await Location.getLastKnownPositionAsync({ maxAge: 30_000, requiredAccuracy: 75 });
  function point({ coords }: Location.LocationObject): UserLocation {
    return { lat: coords.latitude, lon: coords.longitude, accuracy: coords.accuracy ?? undefined };
  }
  if (recent) return point(recent);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const position = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Location took too long. Try selecting a point on the map.')), 15_000);
      }),
    ]);
    return point(position);
  } finally {
    clearTimeout(timer);
  }
}
