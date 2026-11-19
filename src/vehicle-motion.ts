import type { Coordinate, Vehicle } from './types';
import { distanceMeters } from './planner';
import { vehicleIsStale } from './vehicle-selection';

export const MAX_DISPLAY_LAG_METERS = 20;
export const MAX_TWEEN_MS = 3600;
const MAX_OBSERVATION_STEP_METERS = 120;
export interface MotionPoint extends Coordinate { heading: number }
const point = (bus: Vehicle): MotionPoint => ({ lat:bus.lat, lon:bus.lon, heading:Number.isFinite(bus.heading)?bus.heading:0 });
const mix = (from: MotionPoint, to: MotionPoint, ratio: number): MotionPoint => ({ lat:from.lat+(to.lat-from.lat)*ratio, lon:from.lon+(((to.lon-from.lon+540)%360)-180)*ratio, heading:(from.heading+(((to.heading-from.heading+540)%360)-180)*ratio+360)%360 });
// A provider-current clock-only fix can use receipt intervals for display pacing.
const motionTime = (bus: Vehicle) => bus.updatedAt ?? (bus.active === true ? bus.sources?.[0]?.fetchedAt : undefined);
/** Display-only interpolation; source coordinates/times are never modified or extrapolated. */
export class VehicleMotion {
  latest: Vehicle;
  private from: MotionPoint;
  private to: MotionPoint;
  private start = 0;
  private duration = 0;
  constructor(bus: Vehicle, private refreshIntervalMs?: number) { this.latest=bus; this.from=this.to=point(bus); }
  sample(now: number): MotionPoint {
    if (!this.moving(now)) return { ...this.to };
    const progress = Math.max(0, (now - this.start) / this.duration);
    const ratio = this.refreshIntervalMs === undefined ? progress * progress * (3 - 2 * progress) : progress;
    return mix(this.from, this.to, ratio);
  }
  moving(now: number) { return now < this.start+this.duration; }
  finish() { this.from=this.to; this.duration=0; }
  update(bus: Vehicle, now: number, reducedMotion = false) {
    const prior = this.latest;
    const sameSource = prior.sources?.[0]?.source === bus.sources?.[0]?.source;
    if (sameSource && bus.updatedAt !== undefined && prior.updatedAt !== undefined && bus.updatedAt < prior.updatedAt
      && !(vehicleIsStale(prior, now) && !vehicleIsStale(bus, now))) return;
    // A repeated position and heading keep the same arrival time for an in-progress tween.
    if (bus.lat === prior.lat && bus.lon === prior.lon && bus.heading === prior.heading) {
      this.latest=bus;
      if (reducedMotion || !sameSource || bus.routeId !== prior.routeId || vehicleIsStale(bus, now)) this.finish();
      return;
    }
    const current = this.sample(now), at = motionTime(bus), priorAt = motionTime(prior);
    const gap = (at ?? 0) - (priorAt ?? 0), distance = distanceMeters(prior, bus);
    const speed = distance / (gap / 1000);
    const fresh = (value: Vehicle, time: number | undefined) => time !== undefined && time <= now + 1000
      && now - time <= 120_000 && !vehicleIsStale(value, now);
    const animate = !reducedMotion && sameSource && bus.id === prior.id && bus.routeId === prior.routeId
      && (bus.updatedAt === undefined) === (prior.updatedAt === undefined)
      && gap > 0 && gap <= 60_000 && fresh(bus, at) && fresh(prior, priorAt) && distance <= MAX_OBSERVATION_STEP_METERS && speed <= 25;
    this.latest=bus; this.to=point(bus); this.start=now;
    if (!animate) { this.from=this.to; this.duration=0; return; }
    const remaining=distanceMeters(current,this.to);
    if (remaining === 0 && current.heading === this.to.heading) { this.from=this.to; this.duration=0; return; }
    const maxLag = this.refreshIntervalMs === undefined ? MAX_DISPLAY_LAG_METERS : MAX_OBSERVATION_STEP_METERS;
    this.from = remaining > maxLag ? mix(this.to, current, maxLag / remaining) : current;
    const visibleDistance = Math.min(remaining, maxLag);
    this.duration = this.refreshIntervalMs ?? Math.min(MAX_TWEEN_MS, gap * .6, Math.max(450, visibleDistance / Math.max(2, speed) * 1000));
  }
}
