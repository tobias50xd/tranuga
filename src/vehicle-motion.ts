import type { Coordinate, Vehicle } from './types';
import { distanceMeters } from './planner';

export const MAX_DISPLAY_LAG_METERS = 20;
export const MAX_TWEEN_MS = 1200;
export interface MotionPoint extends Coordinate { heading: number }
const point = (bus: Vehicle): MotionPoint => ({ lat:bus.lat, lon:bus.lon, heading:Number.isFinite(bus.heading)?bus.heading:0 });
const mix = (from: MotionPoint, to: MotionPoint, ratio: number): MotionPoint => ({ lat:from.lat+(to.lat-from.lat)*ratio, lon:from.lon+(((to.lon-from.lon+540)%360)-180)*ratio, heading:(from.heading+(((to.heading-from.heading+540)%360)-180)*ratio+360)%360 });
/** Display-only interpolation; source coordinates/times are never modified or extrapolated. */
export class VehicleMotion {
  latest: Vehicle;
  private from: MotionPoint;
  private to: MotionPoint;
  private start = 0;
  private duration = 0;
  constructor(bus: Vehicle) { this.latest=bus; this.from=this.to=point(bus); }
  sample(now: number): MotionPoint { return !this.duration || now>=this.start+this.duration ? {...this.to} : mix(this.from,this.to,Math.max(0,(now-this.start)/this.duration)); }
  moving(now: number) { return now < this.start+this.duration; }
  finish() { this.from=this.to; this.duration=0; }
  update(bus: Vehicle, now: number, reducedMotion = false) {
    const prior=this.latest;
    if (bus.updatedAt !== undefined && prior.updatedAt !== undefined && bus.updatedAt < prior.updatedAt) return;
    // Identical cached fixes do not restart a tween.
    if (bus.lat===prior.lat && bus.lon===prior.lon && bus.updatedAt===prior.updatedAt && bus.heading===prior.heading) return;
    const current=this.sample(now), gap=(bus.updatedAt??0)-(prior.updatedAt??0), distance=distanceMeters(prior,bus);
    const fresh=(value: Vehicle) => value.updatedAt !== undefined && Number.isFinite(value.updatedAt) && now-value.updatedAt>=-1000 && now-value.updatedAt<=120000;
    const animate=!reducedMotion && !bus.sources?.some(source=>source.cached) && !prior.sources?.some(source=>source.cached) && bus.agreement!=='stale-backup' && prior.agreement!=='stale-backup' && bus.id===prior.id && bus.routeId===prior.routeId && gap>0 && gap<=60000 && fresh(bus) && fresh(prior) && distance<=120 && distance/(gap/1000)<=25;
    this.latest=bus; this.to=point(bus); this.start=now;
    if (!animate) { this.from=this.to; this.duration=0; return; }
    const remaining=distanceMeters(current,this.to);
    this.from=remaining>MAX_DISPLAY_LAG_METERS ? mix(this.to,current,MAX_DISPLAY_LAG_METERS/remaining) : current;
    this.duration=Math.min(MAX_TWEEN_MS,gap*.35);
  }
}
