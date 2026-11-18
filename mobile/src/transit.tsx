import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiClient } from '../../src/api';
import { PlaceSearch } from '../../src/places';
import { ATHENS_INFO_AGENCY, createTransitService, GEORGIA_AGENCY, PASSIO_ATHENS_AGENCY, PASSIO_UGA_AGENCY } from '../../src/replication';
import type { Agency, Coordinate, Stop } from '../../src/types';

export const networks = [GEORGIA_AGENCY, ATHENS_INFO_AGENCY, PASSIO_UGA_AGENCY, PASSIO_ATHENS_AGENCY];
export const defaultCenter = { lat: 33.948, lon: -83.377 };
const gateway = (process.env.EXPO_PUBLIC_TRANSIT_URL || 'https://tranuga.tobias-seeanner.workers.dev').replace(/\/+$/, '');
const preferencesKey = 'tranuga.mobile.preferences.v1';
export const placeSearch = new PlaceSearch((input, init) => fetch(gateway + String(input), init));
export const networkKey = (agency: Agency) => `${agency.kind}:${agency.id}`;

type Favorites = Record<string, string[]>;
function useTransitState() {
  const [agency, setAgency] = useState<Agency>(GEORGIA_AGENCY);
  const [allFavorites, setFavorites] = useState<Favorites>({});
  const [ready, setReady] = useState(false);
  const [tripStart, setTripStart] = useState<Stop>();
  const service = useMemo(() => createTransitService(agency, new ApiClient(undefined, `${gateway}/api`)), [agency]);
  const scope = networkKey(agency);
  const favorites = useMemo(() => new Set(allFavorites[scope]), [allFavorites, scope]);

  useEffect(() => {
    let mounted = true;
    void AsyncStorage.getItem(preferencesKey).then(raw => {
      if (!raw || !mounted) return;
      const data = JSON.parse(raw) as { network?: string; favorites?: Record<string, unknown> };
      setAgency(networks.find(item => networkKey(item) === data.network) ?? GEORGIA_AGENCY);
      setFavorites(Object.fromEntries(Object.entries(data.favorites ?? {}).flatMap(([key, values]) =>
        Array.isArray(values) ? [[key, values.filter((value): value is string => typeof value === 'string')]] : []
      )));
    }).catch(() => {}).finally(() => { if (mounted) setReady(true); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (ready) void AsyncStorage.setItem(preferencesKey, JSON.stringify({ network: scope, favorites: allFavorites })).catch(() => {});
  }, [ready, scope, allFavorites]);

  return {
    ready, agency, service, favorites, tripStart, setTripStart,
    selectNetwork(next: Agency) { setTripStart(undefined); setAgency(next); },
    toggleFavorite(id: string) {
      setFavorites(previous => {
        const ids = new Set(previous[scope]);
        if (ids.has(id)) ids.delete(id); else ids.add(id);
        return { ...previous, [scope]: [...ids] };
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

export async function currentPosition(): Promise<Coordinate> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) throw new Error('Location access was denied. Choose an address, stop, or point on the map.');
  const recent = await Location.getLastKnownPositionAsync({ maxAge: 30_000, requiredAccuracy: 75 });
  if (recent) return { lat: recent.coords.latitude, lon: recent.coords.longitude };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const position = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Location took too long. Try selecting a point on the map.')), 15_000);
      }),
    ]);
    return { lat: position.coords.latitude, lon: position.coords.longitude };
  } finally {
    clearTimeout(timer);
  }
}
