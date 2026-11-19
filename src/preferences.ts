import { normalizeAgencies, record } from './api/normalize';
import type { Agency } from './types';

export const THEME_KEY = 'tranuga.theme.v1';
export const ROUTE_LOCK_KEY = 'tranuga.route-lock.v1';
const NETWORK_KEY = 'tranuga.network.v1';
export type Theme = 'light' | 'dark';
interface PreferenceStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
function browserStorage(): PreferenceStorage | undefined { try { return globalThis.localStorage; } catch { return undefined; } }
export function readPreferences(storage = browserStorage(), systemDark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches) {
  let theme: Theme = systemDark ? 'dark' : 'light', routeLocked = true;
  try {
    const savedTheme = storage?.getItem(THEME_KEY);
    if (savedTheme === 'dark' || savedTheme === 'light') theme = savedTheme;
    const savedLock = storage?.getItem(ROUTE_LOCK_KEY) ?? storage?.getItem('tranuga.athens-lock.v1');
    routeLocked = savedLock !== 'false';
  } catch { /* The app remains usable when browser storage is blocked. */ }
  return { theme, routeLocked };
}
export function savePreference(key: typeof THEME_KEY | typeof ROUTE_LOCK_KEY, value: string, storage = browserStorage()) {
  try { storage?.setItem(key, value); } catch { /* Keep the current session's choice. */ }
}

export function readPreviousPreferences(storage = browserStorage()) {
  try { return record(JSON.parse(storage?.getItem('tranuga.mobile.preferences.v1') ?? 'null')); }
  catch { return {}; }
}

export function readNetwork(presets: readonly Agency[], storage = browserStorage()): Agency | undefined {
  try {
    const saved = storage?.getItem(NETWORK_KEY);
    const previous = saved ? {} : readPreviousPreferences(storage);
    const agency = record(saved ? JSON.parse(saved) : previous.agency);
    const scope = saved ? `${agency.kind}:${agency.id}` : previous.network;
    const preset = presets.find(item => `${item.kind}:${item.id}` === scope);
    if (preset) return preset;
    if (agency.kind === 'infopoint') {
      return normalizeAgencies({ ...record(agency.center), Id: agency.id, Name: agency.name, RestUrl: agency.restUrl })[0];
    }
  } catch { /* Fall back to the default network if the saved choice is unreadable. */ }
  return undefined;
}

export function saveNetwork(agency: Agency, storage = browserStorage()) {
  try { storage?.setItem(NETWORK_KEY, JSON.stringify(agency)); }
  catch { /* Keep the current session's choice. */ }
}
