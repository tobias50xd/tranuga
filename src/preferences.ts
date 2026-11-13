export const THEME_KEY = 'tranuga.theme.v1';
export const ATHENS_LOCK_KEY = 'tranuga.athens-lock.v1';
export type Theme = 'light' | 'dark';
interface PreferenceStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
function browserStorage(): PreferenceStorage | undefined { try { return globalThis.localStorage; } catch { return undefined; } }
export function readPreferences(storage = browserStorage(), systemDark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches) {
  let theme: Theme = systemDark ? 'dark' : 'light', athensLocked = true;
  try {
    const savedTheme = storage?.getItem(THEME_KEY);
    if (savedTheme === 'dark' || savedTheme === 'light') theme = savedTheme;
    athensLocked = storage?.getItem(ATHENS_LOCK_KEY) !== 'false';
  } catch { /* The app remains usable when browser storage is blocked. */ }
  return { theme, athensLocked };
}
export function savePreference(key: typeof THEME_KEY | typeof ATHENS_LOCK_KEY, value: string, storage = browserStorage()) {
  try { storage?.setItem(key, value); } catch { /* Keep the current session's choice. */ }
}
