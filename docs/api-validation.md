# API validation evidence

Validation date: **2026-11-12 UTC**. This file records observations from read-only unauthenticated requests made while implementing tranuga. It complements the original [API extraction notes](api-extraction.md); it is not a promise of current provider availability or a published provider compatibility contract.

## What was checked

The initial schema probes used the documented UGA hosts and the InfoPoint directory to discover CATA. Follow-up service-level tests used the same client/normalization/topology code as the app, with direct upstream fetching for the opt-in test only. Normal production/browser requests use the same-origin `/api` gateway.

All 22 documented API URL patterns were requested successfully with HTTP 200 during these checks. Dynamic IDs were obtained from source responses where applicable. The representative route/stop IDs below identify the checked examples; they must not be assumed valid for another agency or a later date.

| Provider / calls checked | Representative parameters | Observed format and result |
| --- | --- | --- |
| UGA `Routes` | No parameters | JSON array of 35 routes in the initial probe, 25 marked active; UGA and Athens classifications present. |
| UGA `Buses` | No parameters | JSON array of 49 reported vehicles in the initial probe; route/trip IDs, coordinates, heading, speed and original update timestamps present. |
| UGA `routeTracking_{routeId}` | Route `5750` in schema probe; a current active catalog route in live service smoke | JSON array of ordered stop rows, nested stop coordinates, direction, stop sequence, `times` arrays, and `busLocations`. Route `5750` supplied 19 stop rows in the initial probe. |
| UGA `stop_{stopId}` | Stop `155104` in schema probe; a selected route's current first stop in live smoke | JSON array of route/direction groups and epoch-millisecond prediction arrays. |
| CloudFront `version.json` | No parameters | JSON object with version `1086` in the initial probe. |
| CloudFront `busData.json` | No parameters | JSON object containing version, trip mappings, sequences, shapes, stops, route-stop relations and routes. Initial probe contained 36 static routes and 696 stops. |
| Discovery directory | Documented HTTP URL | JSON array of 73 authorities; each included agency identity, map center and `RestUrl`. The committed registry preserves sanitized identity/URL/center fields. |
| Discovery `Locate` | `Lat=33.95&long=-83.37` | JSON object identifying Athens with its InfoPoint URL. The normalizer accepts this singleton format. |
| Discovery property-code selector | `includeHiddenPropertyCode=@CATA` | JSON authority array. This selector did not imply a single-result response. |
| CATA `TransitAuthorityConfig/Get` | Discovered CATA base | JSON configuration including same-origin `BaseUrl`, `KmlUrl=Resources/Traces/`, and refresh settings. Unrelated third-party configuration values were excluded from committed fixtures. |
| CATA `Routes/GetAllRoutes` | No parameters | JSON route array, including embedded vehicles. |
| CATA `Routes/GetVisibleRoutes` | No parameters | JSON route array with 22 visible routes in the initial probe, embedded vehicles and route messages. |
| CATA `RouteDetails/Get/{routeId}` | Route `51` in schema probe; current active catalog route in live smoke | JSON route object with directions, stop set, ordered route-stop relations, messages, trace filename and vehicles. |
| CATA `RouteDetails/GetAllRouteDetails` | No parameters | JSON array of detailed route objects for constructing network topology. |
| CATA `RouteDetails/GetDirectionsByRouteID/{routeId}` | Route `51` | JSON direction array with `Dir=EB` and `Dir=WB`. |
| CATA `RouteDetails/GetStopsForRouteDirection` | `routeid=51&direction=EB&timepointsOnly=false` | JSON stop array. An exploratory `direction=0` request returned an empty array; the implementation uses discovered agency direction codes. |
| CATA `Stops/GetAllStops` | No parameters | JSON array of 331 stops in the initial probe, with names and coordinates. |
| CATA `Stops/GetAllStopsForRoutes` | `routeIDs=51` | JSON stop array for the requested route. |
| CATA `Stops/Get/{stopId}` | Stop `1` in schema probe; selected route's current first stop in live smoke | JSON stop object with name, identity and coordinates. |
| CATA `StopDepartures/Get/{stopId}` | Stop `1` in schema probe | JSON stop-departure array with 15 route/direction groups in the initial response, run identity, ETA/EDT and scheduled times. |
| CATA `PublicMessages/GetCurrentMessages` | No parameters | JSON public-message array with published service notices. |
| CATA route KML | Configuration-derived `Resources/Traces/Route51.kml` | KML document; the committed geometry fixture contains 78 parsed `LineString` coordinate points. |

These are snapshot counts, not constants used by the application. The live smoke tests discover a current active route and stop and do not hardcode the snapshot route count.

## Observations that affected the implementation

- UGA live responses and CloudFront static responses did not include `Access-Control-Allow-Origin` in the checked responses. CATA InfoPoint responses included `Access-Control-Allow-Origin: *`. The Cloudflare gateway makes browser behavior consistent without embedding credentials or requiring public CORS proxies.
- HTTPS discovery failed certificate verification because the discovery certificate was expired at validation time. The documented HTTP directory endpoint succeeded. The gateway uses the documented discovery URL; it does not disable TLS verification. An HTTPS connection from the browser to the app does not encrypt the gateway's upstream HTTP discovery hop.
- One discovered authority, IndyGo, advertised an HTTP `RestUrl`. Discovery records remain data; only origins and paths in the committed registry can be proxied. Agency data returned over HTTP is not protected by TLS on that upstream hop.
- Static UGA trip mappings did not cover all trip IDs observed in live vehicle data. Current route tracking therefore supplies current stop order; static topology supplies geometry and corroborated loop closure rather than replacing current sequences blindly.
- UGA prediction arrays did not expose a run identifier for every prediction. The planner does not pair predictions at separate stops solely by their position in an array.
- CATA's direction-stop response started with Pattee Transit Center while the same route's `RouteStops.SortOrder` started at West Deck. Stop-array order alone was therefore insufficient evidence for directed ride order. `RouteStops.SortOrder` controls ride edges; direction-stop responses refresh names and coordinates.
- CATA timestamps used .NET strings such as `/Date(epochMilliseconds-0500)/`. The milliseconds already represent the absolute instant; the parser does not apply the displayed offset a second time. Unqualified local-time strings are not treated as absolute timestamps.
- CATA arrival ETA and departure EDT could differ due to dwell. Both are preserved: boarding can use departure time while downstream arrival can use ETA. Completed departures are excluded.
- Some position timestamps became more than two minutes old during the work. Vehicle rows keep their original timestamp and are visibly labeled stale; a successful HTTP response alone does not prove a current position.
- KML point placemarks are not road geometry. Only `LineString` coordinates become traces; a missing trace causes labeled approximate connectors.

## Reproduce deterministic tests

From the repository root after `npm ci`:

```sh
npx vitest run tests/api.test.ts
npm run typecheck
```

The API feature suite passed **13 tests** during implementation. It uses sanitized, bounded fixtures derived from the observed response contracts, including a real encoded UGA shape and a real CATA KML trace. Tests cover all six UGA calls; all three discovery selectors; all twelve InfoPoint calls and KML; active/inactive route state; ordered direction/loop topology; valid coordinate filtering; timestamp interpretation; arrival versus departure times; stale vehicle timestamp preservation; safe color parsing; polyline/KML decoding; coalescing/caching; HTTP failures; invalid JSON; timeouts; labeled static fallback; and exclusion of unconfirmed current routes from planning.

Deterministic fixtures prove the implemented transformations and workflow calls against those schemas. They do not contact operators, prove current live data, or prove other agencies use identical optional fields. Browser, planner and gateway tests are separate suites; use the [README](../README.md) for the full verification commands.

## Reproduce opt-in live checks

```sh
LIVE_TRANSIT=1 npx vitest run tests/api-live.test.ts
```

The opt-in suite passed **2 tests in 4.42 seconds** during the implementation check around 22:36 UTC on 2026-11-12:

1. UGA catalog, active route, current ordered stops, valid reported headings, selected-stop predictions, and the complete current active planning network. At that check, every active catalog route had a current planning pattern.
2. Authority directory, locate and code selectors; discovered CATA catalog/configuration; selected route, directions, direction-stop calls, route stop directory, KML, selected stop/departures, public notices, all-route details and all stops. Each logged request completed successfully.

The InfoPoint live smoke checks the all-network topology endpoints but does not fetch departure predictions at every CATA stop; that complete fan-out is exercised with deterministic fixtures and occurs on an actual InfoPoint planning search. This distinction avoids presenting a selected-stop probe as full-network live planning proof.

Live tests are skipped unless `LIVE_TRANSIT=1` is explicitly set. Normal CI stays deterministic and does not depend on the transit providers. Live checks are read-only, require no bus API secret, and can fail when service, schemas, IDs, network access, or certificates change. Run them deliberately rather than on every commit.

## Limits of the evidence

These checks validate representative UGA and CATA calls and the observed discovery directory. They do not establish all 73 agencies' live behavior, future uptime, operator permission for unrelated use, guaranteed ETA accuracy, pedestrian accessibility, or an actual Cloudflare production deployment. The gateway's reviewed-host policy can intentionally reject a newly discovered origin, an unfamiliar trace location, or a redirect until its source policy is updated and tested. See [feature.md](../feature.md) for per-endpoint shipped uses, future possibilities and the request/cache policy.
