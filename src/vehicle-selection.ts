import type { Vehicle } from './types';

/** Provider-current clock-only reports can be colored without inventing a GPS timestamp. */
export function vehicleIsStale(vehicle: Vehicle, now = Date.now()): boolean {
  if (vehicle.active === false || vehicle.agreement === 'stale-backup' || vehicle.sources?.length && vehicle.sources.every(source => source.cached)) return true;
  if (vehicle.updatedAt === undefined) return vehicle.active !== true;
  return !Number.isFinite(vehicle.updatedAt) || now - vehicle.updatedAt > 120000 || vehicle.updatedAt > now + 60000;
}

export function vehicleAgeWarnings(vehicles: readonly Vehicle[], now = Date.now()): string[] {
  return vehicles.some(bus => !bus.updatedAt || now - bus.updatedAt > 120_000)
    ? ['Some vehicle positions are older than two minutes or have no timestamp. Check their update time.']
    : [];
}

const agreementRank = (vehicle: Vehicle) => vehicle.agreement === 'corroborated' ? 2 : vehicle.agreement === 'single-source' ? 1 : 0;

/** Prefer a provider-current marker for one canonical bus. */
export function preferredVehicle(current: Vehicle, candidate: Vehicle): Vehicle {
  const active = (vehicle: Vehicle) => vehicle.active === true ? 2 : vehicle.active === undefined ? 1 : 0;
  if (active(candidate) !== active(current)) return active(candidate) > active(current) ? candidate : current;
  if (agreementRank(candidate) !== agreementRank(current)) return agreementRank(candidate) > agreementRank(current) ? candidate : current;
  const candidateTime = candidate.updatedAt ?? -Infinity, currentTime = current.updatedAt ?? -Infinity;
  return candidateTime > currentTime ? candidate : current;
}

/** One canonical bus produces at most one marker/list row. */
export function uniqueVehicles(vehicles: readonly Vehicle[]): Vehicle[] {
  const selected = new Map<string, Vehicle>();
  for (const vehicle of vehicles) {
    const current = selected.get(vehicle.id);
    selected.set(vehicle.id, current ? preferredVehicle(current, vehicle) : vehicle);
  }
  return [...selected.values()];
}
