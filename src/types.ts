export interface Coordinate { lat: number; lon: number }
export interface Agency { id: string; name: string; kind: 'uga' | 'infopoint' | 'passio'; restUrl?: string; center?: Coordinate }
export interface SourceRef { source: string; id: string; fetchedAt: number; cached?: boolean }
export interface Provenance { sources?: SourceRef[]; agreement?: 'corroborated' | 'single-source' | 'conflict' | 'stale-backup'; snapshotAt?: number }
export interface Route extends Provenance { id: string; name: string; shortName: string; color: string; active: boolean; agencyId: string; availability?: 'current' | 'published' | 'unknown' }
export interface Stop extends Coordinate, Provenance { id: string; name: string }
export interface RoutePattern extends Provenance { id: string; routeId: string; direction: string; stops: Stop[]; shape: Coordinate[]; shapeSegments?: Coordinate[][]; loop?: boolean }
export interface Vehicle extends Coordinate, Provenance { id: string; routeId: string; heading: number; speed?: number; updatedAt?: number; destination?: string; tripId?: string }
export interface Departure extends Provenance { stopId: string; routeId: string; direction?: string; arrivalTime: number; departureTime?: number; updatedAt?: number; vehicleId?: string; tripId?: string; scheduled?: boolean }
export interface Network { agencyId: string; routes: Route[]; stops: Stop[]; patterns: RoutePattern[]; vehicles: Vehicle[]; departures: Departure[]; messages: string[]; updatedAt: number; warnings: string[] }
export interface RouteDetail { route: Route; patterns: RoutePattern[]; stops: Stop[]; vehicles: Vehicle[]; departures: Departure[]; messages: string[]; warnings: string[] }
export interface StopDetail { stop: Stop; departures: Departure[] }
