import { describe, expect, it, vi } from 'vitest';
import { RouteVehicleTracker, uniqueFleetVehicles } from '../src/replication/route-vehicles';
import type { Vehicle } from '../src/types';
import { vehicleIsStale } from '../src/vehicle-selection';

const time = 1_800_000_000_000;
const bus = (changes: Partial<Vehicle> = {}): Vehicle => ({
  id: 'bus', routeId: '1', lat: 33.95, lon: -83.37, heading: 0, updatedAt: time, ...changes,
});

describe('route vehicle feed selection', () => {
  it('renders a reassigned fleet vehicle once across two selected routes', () => {
    const previous = bus({ id:'portal:12', fleetIdentity:'fleet:12', agreement:'stale-backup' });
    const current = bus({ id:'info:12', fleetIdentity:'fleet:12', routeId:'2', updatedAt:time - 5_000 });
    const independent = bus({ id:'other:12', fleetIdentity:'other-fleet:12' });
    expect(uniqueFleetVehicles([previous, current, independent], time)).toEqual([current, independent]);
  });

  it('switches the entire fleet to a better feed after probing, without mixing old and new positions', async () => {
    let now = time;
    const portal = vi.fn(async () => [bus(), bus({ id: 'portal-only' })]);
    const backup = vi.fn(async () => [bus({ id: 'backup-only', active: false })]);
    const tracker = new RouteVehicleTracker('1', [{ label: 'Portal', read: portal }, { label: 'Backup', read: backup }], () => now);
    await tracker.probe();
    expect(tracker.snapshot().source).toBe('Portal');
    now += 125_000;
    backup.mockResolvedValue([bus({ id: 'backup-only', updatedAt: now, heading: 90 })]);
    await tracker.probe();
    expect(tracker.snapshot()).toMatchObject({
      source: 'Backup',
      vehicles: [{ id: 'backup-only', updatedAt: now, heading: 90, sources: [{ source: 'Backup' }] }],
    });
  });

  it('chooses comparable agreeing positions over a recent outlier and uses the freshest fix among peers', async () => {
    const tracker = new RouteVehicleTracker('1', [
      { label: 'Outlier', read: async () => [bus({ lat: 33.98 })] },
      { label: 'Older', read: async () => [bus({ updatedAt: time - 10_000 })] },
      { label: 'Newer', read: async () => [bus({ lon: -83.3699, updatedAt: time - 5000 })] },
    ], () => time);
    await tracker.probe();
    expect(tracker.snapshot()).toMatchObject({ source: 'Newer', vehicles: [{ lon: -83.3699 }] });
  });

  it('does not favor a jumping GPS fix over a plausible one', async () => {
    let now = time;
    const primary = vi.fn(async () => [bus()]);
    const tracker = new RouteVehicleTracker('1', [
      { label: 'Primary', read: primary },
      { label: 'Backup', read: async () => [bus({ updatedAt: time - 1000 })] },
    ], () => now);
    await tracker.probe();
    expect(tracker.snapshot().source).toBe('Primary');
    now += 15_000;
    primary.mockResolvedValue([bus({ lat: 33.98, updatedAt: now })]);
    await tracker.probe();
    expect(tracker.snapshot().source).toBe('Backup');
  });

  it('retains a single grey fallback if every feed fails, and removes it when it expires', async () => {
    let now = time;
    const feed = vi.fn(async () => [bus({ updatedAt: undefined, active: true })]);
    const tracker = new RouteVehicleTracker('1', [{ label: 'Provider', read: feed }], () => now);
    await tracker.probe();
    expect(vehicleIsStale(tracker.snapshot().vehicles[0], now)).toBe(false);
    now += 15_000;
    feed.mockRejectedValue(new Error('offline'));
    await tracker.probe();
    const fallback = tracker.snapshot();
    expect(fallback).toMatchObject({ source: 'Provider', saved: true });
    expect(vehicleIsStale(fallback.vehicles[0], now)).toBe(true);
    now += 300_000;
    expect(tracker.snapshot().vehicles).toEqual([]);
  });

  it('publishes healthy responses without waiting for a slow feed and coalesces its pending probe', async () => {
    const pending = Promise.withResolvers<Vehicle[]>();
    const slow = vi.fn(() => pending.promise);
    const healthy = async () => [bus()];
    const tracker = new RouteVehicleTracker('1', [{ label: 'Slow', read: slow }, { label: 'Healthy', read: healthy }], () => time);
    const first = tracker.probe();
    const second = tracker.probe();
    expect(slow).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(tracker.snapshot().source).toBe('Healthy');
    pending.resolve([]);
    await Promise.all([first, second]);
  });
});
