import { describe, expect, it } from 'vitest';
import { MAX_DISPLAY_LAG_METERS, MAX_TWEEN_MS, VehicleMotion } from '../src/vehicle-motion';
import { distanceMeters } from '../src/planner';
import type { Vehicle } from '../src/types';
const now=1800000000000;
const bus=(extra:Partial<Vehicle>={}):Vehicle=>({id:'bus',routeId:'1',lat:33.95,lon:-83.377,heading:359,updatedAt:now,...extra});
describe('bounded display interpolation',()=>{
 it('moves smoothly between real fixes and reaches the new fix without extrapolation',()=>{
  const first=bus(),next=bus({lon:-83.3769,heading:1,updatedAt:now+15000}),motion=new VehicleMotion(first);
  motion.update(next,now+15000);
  const middle=motion.sample(now+15000+MAX_TWEEN_MS/2);
  expect(middle.lon).toBeGreaterThan(first.lon);expect(middle.lon).toBeLessThan(next.lon);
  expect(Math.min(middle.heading,360-middle.heading)).toBeLessThan(1);
  expect(motion.sample(now+15000+MAX_TWEEN_MS)).toMatchObject({lat:next.lat,lon:next.lon,heading:1});
  expect(motion.sample(now+60000)).toEqual(motion.sample(now+15000+MAX_TWEEN_MS));
  expect(first.updatedAt).toBe(now);expect(next.updatedAt).toBe(now+15000);
 });
 it('bounds every displayed frame to 20 m from the latest received fix, even during retargeting',()=>{
  const motion=new VehicleMotion(bus()),next=bus({lon:-83.376,updatedAt:now+15000});motion.update(next,now+15000);
  for(let at=0;at<=1500;at+=25)expect(distanceMeters(motion.sample(now+15000+at),next)).toBeLessThanOrEqual(MAX_DISPLAY_LAG_METERS+.01);
  const following=bus({lon:-83.3758,updatedAt:now+16000});motion.update(following,now+16000);
  expect(distanceMeters(motion.sample(now+16000),following)).toBeLessThanOrEqual(MAX_DISPLAY_LAG_METERS+.01);
 });
 it('does not restart cached identical fixes or move backwards for out-of-order observations',()=>{
  const motion=new VehicleMotion(bus()),next=bus({lon:-83.3769,updatedAt:now+15000});motion.update(next,now+15000);
  motion.update({...next},now+15600);expect(motion.moving(now+16200)).toBe(false);
  motion.update(bus({lon:-83.38}),now+17000);expect(motion.latest).toEqual(next);
 });
 it.each([
  ['unknown time',bus({updatedAt:undefined})],
  ['stale time',bus({updatedAt:now-180000})],
  ['future time',bus({updatedAt:now+180000})],
  ['large jump',bus({lon:-83.35,updatedAt:now+15000})],
  ['route change',bus({routeId:'2',lon:-83.3769,updatedAt:now+15000})],
  ['implausible speed',bus({lon:-83.376,updatedAt:now+1000})],
  ['saved source',bus({lon:-83.3769,updatedAt:now+15000,sources:[{source:'a',id:'bus',fetchedAt:now,cached:true}]})],
 ] as const)('snaps instead of inventing movement for %s',(_label,next)=>{
  const motion=new VehicleMotion(bus({updatedAt:_label==='stale time'?now-200000:now}));motion.update(next,now+15000);
  expect(motion.moving(now+15000)).toBe(false);expect(motion.sample(now+15000)).toMatchObject({lat:next.lat,lon:next.lon});
 });
 it('respects reduced motion and can finish immediately when a map is hidden',()=>{
  const motion=new VehicleMotion(bus()),next=bus({lon:-83.3769,updatedAt:now+15000});motion.update(next,now+15000,true);
  expect(motion.moving(now+15000)).toBe(false);
  motion.update(bus({lon:-83.3768,updatedAt:now+30000}),now+30000);motion.finish();
  expect(motion.moving(now+30000)).toBe(false);expect(motion.sample(now+30000).lon).toBe(-83.3768);
 });
});
