export interface Coordinate { lat: number; lon: number }
export interface Agency { id: string; name: string; kind: 'uga' | 'infopoint'; restUrl?: string; center?: Coordinate }
export interface Route { id: string; name: string; shortName: string; color: string; active: boolean; agencyId: string }
export interface Stop extends Coordinate { id: string; name: string }
export interface RoutePattern { id: string; routeId: string; direction: string; stops: Stop[]; shape: Coordinate[]; loop?: boolean }
export interface Vehicle extends Coordinate { id: string; routeId: string; heading: number; speed?: number; updatedAt?: number; destination?: string; tripId?: string }
export interface Departure { stopId: string; routeId: string; direction?: string; arrivalTime: number; departureTime?: number; vehicleId?: string; tripId?: string; scheduled?: boolean }
export interface Network { agencyId: string; routes: Route[]; stops: Stop[]; patterns: RoutePattern[]; vehicles: Vehicle[]; departures: Departure[]; messages: string[]; updatedAt: number; warnings: string[] }
export interface RouteDetail { route: Route; patterns: RoutePattern[]; stops: Stop[]; vehicles: Vehicle[]; departures: Departure[]; messages: string[]; warnings: string[] }
export interface StopDetail { stop: Stop; departures: Departure[] }
