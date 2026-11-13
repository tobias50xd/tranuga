/** Fixed, live-checked read-only Passio nodes. They are mirrors, not independent operators. */
export const PASSIO_ORIGINS = ['https://passiogo.com', 'https://replicated2of3.passiogo.com', 'https://replicated3of3.passiogo.com'] as const;
export type PassioOrigin = typeof PASSIO_ORIGINS[number];
export const PASSIO_SYSTEM_IDS = ['5842', '3994'] as const;
export type PassioSystemId = typeof PASSIO_SYSTEM_IDS[number];
export function passioEndpoints(origin = PASSIO_ORIGINS[0] as string, systemId = '5842' as string) {
  if (!(PASSIO_ORIGINS as readonly string[]).includes(origin)) throw new Error('Unapproved Passio mirror.');
  if (!(PASSIO_SYSTEM_IDS as readonly string[]).includes(systemId)) throw new Error('Unapproved Passio agency.');
  return {
    routes: `${origin}/mapGetData.php?getRoutes=1`,
    routePayload: { systemSelected0: systemId, amount: 1 },
    topology: `${origin}/mapGetData.php?getStops=2&withOutdated=1&wBounds=1&showBusInOos=0`,
    buses: `${origin}/mapGetData.php?getBuses=1&speed=1`,
    systemPayload: { s0: systemId, sA: 1 },
    messages: `${origin}/goServices.php?getAlertMessages=1&alertCRC=na&noOptions=1`,
    messagePayload: { systemSelected0: systemId, amount: 1, routesAmount: 0 },
    systems: `${origin}/mapGetData.php?getSystems=2&sortMode=1&credentials=1&acronymId=${systemId}`,
    version: `${origin}/goServices.php?goWebVer=1`,
    routeGroups: `${origin}/mapGetData.php?getRoutes=2&sortMode=1&credentials=1`,
    search: (query: string) => {
      const cleaned = query.trim();
      if (!/^[A-Za-z0-9 _-]{1,40}$/.test(cleaned)) throw new Error('Enter a bus number or name using at most forty letters, digits, spaces, underscores or hyphens.');
      return `${origin}/mapGetData.php?getBuses=2&search=${encodeURIComponent(cleaned)}`;
    },
    timetable: (stopId: string, routeId: string) => {
      if (![stopId, routeId].every(id => /^\d{1,12}$/.test(id))) throw new Error('Choose valid Passio stop and route IDs.');
      return `${origin}/mapGetData.php?schedule=4&routeId=${routeId}&stopId=${stopId}`;
    },
    compare: `${origin}/mapGetData.php?walk=2`,
    comparisonPayload: (from: { lat: number; lon: number }, to: { lat: number; lon: number }) => {
      if (![from, to].every(point => Number.isFinite(point.lat) && Number.isFinite(point.lon) && Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180)) throw new Error('Choose valid coordinates for operator comparison.');
      return { systems: { systemSelected0: systemId, amount: 1 }, routes: { amount: 0 }, points: [{ lat: from.lat, lng: from.lon }, { lat: to.lat, lng: to.lon }], mode: 'transit' };
    },
    eta: (stopIds: string[]) => {
      if (!stopIds.length || stopIds.length > 40 || stopIds.some(id => !/^\d{1,12}$/.test(id))) throw new Error('Choose one to forty valid Passio stop IDs.');
      return `${origin}/mapGetData.php?eta=3&stopIds=${encodeURIComponent(stopIds.join(','))}&userId=${systemId}`;
    },
  };
}
