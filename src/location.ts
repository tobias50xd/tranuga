import type { Coordinate } from './types';

export interface UserLocation extends Coordinate { accuracy?: number }
type LocationProvider = Pick<Geolocation, 'getCurrentPosition'>;

/** Explicit, one-shot browser location. This helper makes no provider calls and stores nothing. */
export function getCurrentLocation(provider: LocationProvider | undefined = globalThis.navigator?.geolocation): Promise<UserLocation> {
  return new Promise((resolve, reject) => {
    if (!provider) { reject(new Error('Location is unavailable in this browser. Search for a place or pick a point on the map.')); return; }
    provider.getCurrentPosition(position => {
      const { latitude:lat, longitude:lon, accuracy } = position.coords;
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat)>90 || Math.abs(lon)>180) {
        reject(new Error('Your browser returned an invalid location. Try again or pick a point on the map.')); return;
      }
      resolve({lat,lon,accuracy:Number.isFinite(accuracy) && accuracy>=0 ? accuracy : undefined});
    }, error => reject(new Error(error.code === 1 ? 'Location permission was denied. Search for a place or pick a start on the map.' : error.code === 3 ? 'Location request timed out. Try again or pick a point on the map.' : 'Could not determine your location. Pick a point on the map.')), {enableHighAccuracy:true,timeout:15000,maximumAge:30000});
  });
}
