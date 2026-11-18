import { distanceMeters } from '../planner';
import type { Vehicle } from '../types';
import { uniqueVehicles, vehicleIsStale } from '../vehicle-selection';

export interface RouteVehicleFeed {
  label: string;
  read(): Promise<Vehicle[]>;
  coversRoute?: boolean;
  directAssignments?: boolean;
}

interface Sample {
  at: number;
  duration: number;
  vehicles: Vehicle[];
  advancing: Set<string>;
  implausible: Set<string>;
}

export interface RouteVehicleSnapshot {
  source?: string;
  vehicles: Vehicle[];
  saved?: boolean;
  pending?: boolean;
}

const LIVE_SAMPLE_MS = 30_000;
const SAVED_SAMPLE_MS = 300_000;

/** Candidate samples are independent. A published snapshot always comes from one endpoint. */
export class RouteVehicleTracker {
  private feeds: { feed: RouteVehicleFeed; sample?: Sample; pending?: Promise<void>; failed?: boolean }[];
  private selected?: { source: string; sample: Sample };
  constructor(private routeId: string, feeds: RouteVehicleFeed[], private now = Date.now) {
    this.feeds = feeds.map(feed => ({ feed }));
  }

  async probe(): Promise<void> {
    await Promise.all(this.feeds.map(state => {
      if (state.pending) return state.pending;
      const started = this.now();
      state.pending = state.feed.read().then(fleet => {
        const at = this.now();
        const vehicles = uniqueVehicles(fleet);
        const previous = new Map(state.sample?.vehicles.map(bus => [bus.id, bus]));
        const implausible = new Set<string>();
        const advancing = new Set<string>();
        for (const bus of vehicles) {
          const prior = previous.get(bus.id);
          if (prior?.routeId !== bus.routeId || prior.updatedAt === undefined || bus.updatedAt === undefined || vehicleIsStale(bus, at) || vehicleIsStale(prior, at)) continue;
          const elapsed = bus.updatedAt - prior.updatedAt;
          const distance = distanceMeters(prior, bus);
          if (elapsed < 0 || (elapsed === 0 ? distance > 100 : distance / (elapsed / 1000) > 55)) implausible.add(bus.id);
          else if (elapsed > 0) advancing.add(bus.id);
        }
        state.sample = { at, duration: at - started, vehicles, advancing, implausible };
        state.failed = false;
      }).catch(() => {
        state.failed = true;
      }).finally(() => { state.pending = undefined; });
      return state.pending;
    }));
  }

  snapshot(): RouteVehicleSnapshot {
    const now = this.now();
    const samples = this.feeds.flatMap(({ feed, sample, failed }, priority) => {
      if (!sample || failed || now - sample.at > LIVE_SAMPLE_MS) return [];
      return [{ feed, sample, priority }];
    });
    // A known canonical ID can still link a report that omitted its fleet number.
    const identities = new Map<string, string>();
    for (const { sample } of samples) {
      for (const bus of sample.vehicles) if (bus.fleetIdentity) identities.set(bus.id, bus.fleetIdentity);
    }
    const identity = (bus: Vehicle) => identities.get(bus.id) ?? bus.fleetIdentity ?? bus.id;
    const assignments = new Map<string, { routeId: string; rank: number; measured: number }>();
    for (const { feed, sample } of samples) {
      for (const bus of sample.vehicles) {
        const fresh = !vehicleIsStale(bus, now) && !sample.implausible.has(bus.id);
        // Prefer the city's own assignment while it is current. The UGA portal proxies city data.
        const rank = fresh ? (feed.directAssignments ? 2 : 1) : 0;
        const measured = bus.updatedAt ?? -Infinity;
        const id = identity(bus), previous = assignments.get(id);
        if (!previous || rank > previous.rank || rank === previous.rank && measured > previous.measured) {
          assignments.set(id, { routeId: bus.routeId, rank, measured });
        }
      }
    }
    const belongsToRoute = (bus: Vehicle) => bus.routeId === this.routeId
      && (assignments.get(identity(bus))?.routeId ?? bus.routeId) === this.routeId;
    const candidates = samples.filter(({ feed }) => feed.coversRoute !== false).map(({ feed, sample, priority }) => {
      const vehicles = sample.vehicles.filter(belongsToRoute);
      const fresh = vehicles.filter(bus => !vehicleIsStale(bus, now) && !sample.implausible.has(bus.id));
      const measured = fresh.filter(bus => bus.updatedAt !== undefined);
      const age = measured.length ? measured.reduce((sum, bus) => sum + Math.max(0, now - bus.updatedAt!), 0) / measured.length : Infinity;
      const implausible = vehicles.filter(bus => sample.implausible.has(bus.id)).length;
      const advancing = vehicles.filter(bus => sample.advancing.has(bus.id)).length;
      return { feed, sample, vehicles, fresh, measured, age, implausible, advancing, matches: 0, priority };
    });
    for (const candidate of candidates) {
      candidate.matches = candidate.measured.filter(bus => candidates.some(peer => peer !== candidate && peer.measured.some(other =>
        identity(other) === identity(bus) && Math.abs(other.updatedAt! - bus.updatedAt!) <= 15_000 && distanceMeters(other, bus) <= 100
      ))).length;
    }
    candidates.sort((a, b) => b.fresh.length - a.fresh.length
      || a.implausible - b.implausible
      || b.measured.length - a.measured.length
      || b.matches - a.matches
      || a.age - b.age
      || b.advancing - a.advancing
      || Number(b.vehicles.length > 0) - Number(a.vehicles.length > 0)
      || Math.floor(a.sample.duration / 250) - Math.floor(b.sample.duration / 250)
      || Number(b.feed.label === this.selected?.source) - Number(a.feed.label === this.selected?.source)
      || a.priority - b.priority);
    const winner = candidates[0];
    if (winner) this.selected = { source: winner.feed.label, sample: { ...winner.sample, vehicles: winner.vehicles } };
    const selected = this.selected;
    if (selected && (winner || selected.sample.vehicles.length && now - selected.sample.at <= SAVED_SAMPLE_MS)) {
      const { source, sample } = selected;
      const saved = !winner;
      return {
        source, saved,
        vehicles: sample.vehicles.filter(belongsToRoute).map(bus => ({
          ...bus,
          active: sample.implausible.has(bus.id) ? false : bus.active,
          agreement: saved ? 'stale-backup' : 'single-source',
          sources: [{ source, id: bus.sources?.[0]?.id ?? bus.id, fetchedAt: sample.at, cached: saved }],
        })),
      };
    }
    return { vehicles: [], pending: this.feeds.some(state => state.pending !== undefined) };
  }
}
