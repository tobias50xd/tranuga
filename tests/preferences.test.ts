import { describe, expect, it } from 'vitest';
import { ROUTE_LOCK_KEY, THEME_KEY, readPreferences, savePreference } from '../src/preferences';
const storage = () => { const values = new Map<string,string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } }; };
describe('menu preferences', () => {
  it('starts with route lock and dark mode enabled', () => {
    expect(readPreferences(storage())).toEqual({ theme:'dark', routeLocked:true });
  });
  it('restores explicit choices across sessions and ignores invalid stored values', () => {
    const saved = storage();
    savePreference(THEME_KEY, 'dark', saved); savePreference(ROUTE_LOCK_KEY, 'false', saved);
    expect(readPreferences(saved)).toEqual({ theme:'dark', routeLocked:false });
    savePreference(THEME_KEY, 'light', saved); savePreference(ROUTE_LOCK_KEY, 'true', saved);
    expect(readPreferences(saved)).toEqual({ theme:'light', routeLocked:true });
    saved.setItem(THEME_KEY, 'bad'); saved.setItem(ROUTE_LOCK_KEY, 'bad');
    expect(readPreferences(saved)).toEqual({ theme:'dark', routeLocked:true });
  });
  it('remains usable with blocked/full local storage', () => {
    const blocked = { getItem: () => { throw new Error('Blocked'); }, setItem: () => { throw new Error('Full'); } };
    expect(readPreferences(blocked)).toEqual({ theme:'dark', routeLocked:true });
    expect(() => savePreference(THEME_KEY, 'dark', blocked)).not.toThrow();
  });
  it('uses the previous lock choice only until an explicit route lock choice is saved', () => {
    const saved=storage(); saved.setItem('tranuga.athens-lock.v1','false');
    expect(readPreferences(saved).routeLocked).toBe(false);
    savePreference(ROUTE_LOCK_KEY,'true',saved);
    expect(readPreferences(saved).routeLocked).toBe(true);
  });
});
