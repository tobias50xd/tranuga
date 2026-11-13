import crosswalk from '../data/athens-crosswalk.json';
import { ApiClient, TransitService, UGA_AGENCY } from '../api';
import { PassioService, PASSIO_ATHENS_AGENCY, PASSIO_UGA_AGENCY, PASSIO_ORIGINS } from '../api/passio';
import type { Agency } from '../types';
import { ReplicatedTransitService } from './service';
import { SnapshotStore, type StorageLike } from './store';
import type { Crosswalk } from './merge';

export { ReplicatedTransitService } from './service';
export type { ReplicationReport, SourceHealth } from './service';
export { PASSIO_ATHENS_AGENCY, PASSIO_UGA_AGENCY } from '../api/passio';
export const ATHENS_INFO_AGENCY: Agency = { id: '58', name: 'Athens-Clarke County · Georgia', kind: 'infopoint', restUrl: 'https://bustracker.accgov.com/InfoPoint/rest', center: { lat: 33.96, lon: -83.38 } };
export const GEORGIA_AGENCY: Agency = { ...UGA_AGENCY, name: 'UGA + Athens · Georgia' };
function browserStorage(): StorageLike | undefined { try { return globalThis.localStorage; } catch { return undefined; } }

/** Ohio and Georgia always use different coordinator scopes and storage keys. */
export function createTransitService(agency: Agency = GEORGIA_AGENCY, client = new ApiClient(), store = new SnapshotStore(browserStorage())): ReplicatedTransitService {
  const passio = (system: Agency) => new ReplicatedTransitService(system, PASSIO_ORIGINS.map((origin, index) => ({ id: `passio-${index + 1}`, label: index ? `Passio replica ${index + 1}` : 'Passio primary', priority: index, service: new PassioService(system, client, origin) })), undefined, store, Date.now, 'replicas', 20000);
  if (agency.kind === 'passio') return passio(agency);
  if (agency.kind === 'uga') return new ReplicatedTransitService(GEORGIA_AGENCY, [
    { id: 'uga', label: 'UGA portal', aliasKey: 'uga', prefix: '', priority: 0, service: new TransitService(UGA_AGENCY, client) },
    { id: 'infopoint', label: 'Athens GA · InfoPoint', aliasKey: 'infopoint', prefix: 'infopoint:', priority: 1, service: new TransitService(ATHENS_INFO_AGENCY, client) },
    { id: 'passio', label: 'UGA · Passio replicas', aliasKey: 'passio', prefix: 'passio:', priority: 2, service: passio(PASSIO_UGA_AGENCY) },
  ], crosswalk as Crosswalk, store);
  return new ReplicatedTransitService(agency, [{ id: `infopoint-${agency.id}`, label: agency.name, priority: 0, service: new TransitService(agency, client) }], undefined, store);
}
