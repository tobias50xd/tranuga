import { describe, expect, it } from 'vitest';
import { ATHENS_LOCK_KEY, THEME_KEY, readPreferences, savePreference } from '../src/preferences';
import { ATHENS_BOUNDS, inAthens, isAthensAgency, networkInScope, vehiclesInScope } from '../src/athens';
import { ATHENS_INFO_AGENCY, GEORGIA_AGENCY, PASSIO_ATHENS_AGENCY, PASSIO_UGA_AGENCY, knownStops } from '../src/replication';
import type { Network, Stop, Vehicle } from '../src/types';

const storage = () => { const values = new Map<string,string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } }; };
describe('menu preferences', () => {
  it('starts locked to Athens and follows the system palette until a theme is chosen', () => {
    expect(readPreferences(storage(), false)).toEqual({ theme:'light', athensLocked:true });
    expect(readPreferences(storage(), true)).toEqual({ theme:'dark', athensLocked:true });
  });
  it('restores explicit choices across sessions and ignores invalid stored values', () => {
    const saved = storage();
    savePreference(THEME_KEY, 'dark', saved); savePreference(ATHENS_LOCK_KEY, 'false', saved);
    expect(readPreferences(saved, false)).toEqual({ theme:'dark', athensLocked:false });
    savePreference(THEME_KEY, 'light', saved); savePreference(ATHENS_LOCK_KEY, 'true', saved);
    expect(readPreferences(saved, true)).toEqual({ theme:'light', athensLocked:true });
    saved.setItem(THEME_KEY, 'bad'); saved.setItem(ATHENS_LOCK_KEY, 'bad');
    expect(readPreferences(saved, false)).toEqual({ theme:'light', athensLocked:true });
  });
  it('remains usable with blocked/full local storage', () => {
    const blocked = { getItem: () => { throw new Error('Blocked'); }, setItem: () => { throw new Error('Full'); } };
    expect(readPreferences(blocked, true)).toEqual({ theme:'dark', athensLocked:true });
    expect(() => savePreference(THEME_KEY, 'dark', blocked)).not.toThrow();
  });
});

describe('Athens app scope', () => {
  const local: Stop = { id:'local', name:'Campus', lat:33.948, lon:-83.377 };
  const ohio: Stop = { id:'ohio', name:'Athens Ohio', lat:39.33, lon:-82.1 };
  const vehicle: Vehicle = { ...local, id:'bus', routeId:'1', heading:45, updatedAt:1234 };
  it('includes the complete reviewed Georgia stop directory and rejects other cities or invalid points', () => {
    expect(knownStops(GEORGIA_AGENCY).every(inAthens)).toBe(true);
    expect(inAthens(ohio)).toBe(false); expect(inAthens({ lat:NaN, lon:-83.377 })).toBe(false);
    expect(inAthens({ lat:ATHENS_BOUNDS.north, lon:ATHENS_BOUNDS.west })).toBe(true);
    expect(inAthens({ lat:ATHENS_BOUNDS.north + .0001, lon:ATHENS_BOUNDS.west })).toBe(false);
  });
  it('admits only the reviewed Athens Georgia networks, including campus and city feeds', () => {
    [GEORGIA_AGENCY, PASSIO_UGA_AGENCY, ATHENS_INFO_AGENCY].forEach(agency => expect(isAthensAgency(agency)).toBe(true));
    expect(isAthensAgency(PASSIO_ATHENS_AGENCY)).toBe(false);
    expect(isAthensAgency({ ...ATHENS_INFO_AGENCY, restUrl:'https://realtime.catabus.com/InfoPoint/rest' })).toBe(false);
  });
  it('filters foreign buses without moving positions or changing freshness, and restores them when unlocked', () => {
    const foreign = { ...vehicle, ...ohio, id:'foreign' }, buses = [vehicle, foreign];
    expect(vehiclesInScope(buses, true)).toEqual([vehicle]); expect(vehiclesInScope(buses, false)).toBe(buses);
    expect(buses).toHaveLength(2); expect(vehiclesInScope(buses, true)[0].updatedAt).toBe(1234);
  });
  it('drops complete out-of-area patterns instead of inventing a shortcut through removed stops', () => {
    const end = { ...local, id:'end', lat:33.95 };
    const network: Network = { agencyId:'uga', updatedAt:1234, routes:[], stops:[local, ohio, end], vehicles:[vehicle, { ...vehicle, ...ohio }], messages:[], warnings:[], departures:[{ stopId:'ohio', routeId:'1', arrivalTime:5678 }], patterns:[
      { id:'local', routeId:'1', direction:'0', stops:[local, end], shape:[] },
      { id:'foreign', routeId:'1', direction:'1', stops:[local, ohio, end], shape:[] },
    ] };
    const result = networkInScope(network, true);
    expect(result.patterns.map(pattern => pattern.id)).toEqual(['local']); expect(result.stops).toHaveLength(2);
    expect(result.vehicles).toEqual([vehicle]); expect(result.departures).toEqual([]);
    expect(result.warnings.join(' ')).toContain('outside the Athens area');
    expect(network.patterns).toHaveLength(2); expect(networkInScope(network, false)).toBe(network);
  });
});
