import { describe, expect, it } from 'vitest';
import { uniqueVehicles, vehicleIsStale } from '../src/vehicle-selection';
import type { Vehicle } from '../src/types';

const now=1800000000000;
const bus=(extra:Partial<Vehicle>={}):Vehicle=>({id:'bus',routeId:'1',lat:33.95,lon:-83.377,heading:0,updatedAt:now,...extra});
describe('one current presentation per bus',()=>{
  it.each([true,false])('deduplicates current and outdated assignments before filtering to a used route (reverse=%s)',reverse=>{
    const current=bus({active:true,routeId:'2'}),old=bus({active:false});
    const result=uniqueVehicles(reverse?[current,old]:[old,current]);
    expect(result).toEqual([current]);expect(result.filter(bus=>bus.routeId==='1')).toEqual([]);
  });
  it('colors provider-current clock-only reports without inventing measurement time',()=>{
    const current=bus({active:true,updatedAt:undefined});
    expect(vehicleIsStale(current,now)).toBe(false);expect(current.updatedAt).toBeUndefined();
    expect(vehicleIsStale(bus(),now)).toBe(false);
  });
  it.each([
    bus({active:false}),bus({updatedAt:undefined}),bus({active:true,updatedAt:now-120001}),
    bus({updatedAt:now+60001}),bus({active:true,updatedAt:undefined,agreement:'stale-backup'}),
    bus({sources:[{source:'saved',id:'bus',fetchedAt:now,cached:true}]}),
  ])('keeps outdated, unconfirmed or saved bus reports grey: %j',value=>{
    expect(vehicleIsStale(value,now)).toBe(true);
  });
});
