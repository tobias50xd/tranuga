# API inventory and feature map

tranuga uses all **22 bus API URL patterns** documented in the original [API extraction notes](docs/api-extraction.md): six UGA/static-data patterns, three authority-discovery patterns, twelve InfoPoint patterns, and one KML pattern. Calls are used by the route, stop, network-selection, and journey-planning workflows; opening the home page does not issue every call at once.

The implementation has its own visual design. It does not import APK layouts, artwork, embedded map keys, login credentials, or ticket-purchasing integrations.

## Implemented experience

- The first page lists every route returned by the selected network, with names, colors and active state. Search and an optional active-only filter narrow the list.
- Selecting a route opens a map with its road trace where supplied, available stops, direction selection, and reported buses. Heading arrows and update ages distinguish recent and stale positions.
- Selecting a stop loads its predicted or scheduled arrivals and can make that stop the start of a journey.
- The planner accepts decimal coordinates, map clicks, or browser geolocation. It compares directed active bus routes, walks and transfers, then shows the quickest journey under its stated timing model.
- The Networks page supports the UGA default, the InfoPoint directory, coordinate-based agency discovery, authority-code lookup, and agency search. Each selected network has its own catalog and planner graph.
- Provider failures produce retry states or specific warnings. Missing live data is never replaced with invented vehicles. Static-stop and approximate-geometry fallbacks are labeled.

## UGA endpoints — six patterns

All calls are public `GET` requests. Live-data paths are relative to `https://my.uga.edu/`.

| # | URL pattern | Current use in tranuga | Further features the data could support |
| --- | --- | --- | --- |
| 1 | `v4_19/cache/Routes` | Home-page catalog, names, colors, active state, and the active-route filter used by planning. UGA and Athens classifications are supplied by the source. | Saved route favorites; UGA/Athens agency filters; route availability history. |
| 2 | `v4_19/cache/Buses` | Vehicle markers and heading arrows, bus cards, original update times, route association, and planning freshness context. Refreshed while a route is visible. | Occupancy indicators where valid; next-stop cards; vehicle-follow mode; estimated headway displays. |
| 3 | `v4_19/cache/routeTracking_{routeId}` | Current ordered route stops and arrival predictions when opening a route; all active routes' current stop sequences and predictions when planning. | Stop-level arrival badges directly in the route list; missed-bus notifications; route-level wait comparisons. |
| 4 | `v4_19/cache/stop_{stopId}` | Arrival panel for a selected stop, grouped into normalized route/direction predictions. | Saved stops; arrival countdown widgets; departure-board view; opt-in arrival notifications. |
| 5 | `https://d1dhvjc4b8xlgl.cloudfront.net/mobile-bus-data/version.json` | Checks the static topology version before loading or reusing the session's network dataset. | A visible dataset-version/status panel; version-change notifications; controlled offline dataset updates. |
| 6 | `https://d1dhvjc4b8xlgl.cloudfront.net/mobile-bus-data/busData.json` | Stop directory, encoded road geometry, static ordered-stop fallback, and evidence for loop closure. Current live tracking takes priority for stop order. | Downloadable offline network maps; stop-area exploration; topology comparison across dataset versions. |

UGA route-tracking prediction arrays do not identify an individual vehicle or trip for every arrival. The planner can use these for boarding waits, but it does not claim that corresponding array positions at different stops prove the same bus run. Downstream times are estimated when run identity is unavailable.

## Authority discovery — three patterns

The recovered directory base is `http://mobilegateway.rideralerts.com/gateway/TransitAuthorities`. The production browser calls the same-origin gateway over HTTPS; the gateway makes the documented HTTP upstream discovery request.

| # | URL pattern | Current use in tranuga | Further features the data could support |
| --- | --- | --- | --- |
| 7 | `/gateway/TransitAuthorities` | Networks-page agency directory and each agency's InfoPoint `RestUrl`. | Favorite agencies; agency coverage map; automatic agency suggestions. |
| 8 | `/gateway/TransitAuthorities/Locate?Lat={lat}&long={lon}` | Find nearby on the Networks page, after the user requests browser geolocation. The parameter is lowercase `long`. | Nearby-network suggestions after a map click; explicit out-of-coverage guidance. |
| 9 | `/gateway/TransitAuthorities/?includeHiddenPropertyCode=@{code}` | Find by code on the Networks page. The client URL-encodes the `@` selector and user-entered code. | Shareable agency-selection links; organization-specific network shortcuts. |

An authority code selects directory data; it is not a bearer token. The endpoint may return the normal directory plus additional matching properties rather than one exact match. Directory metadata cannot expand the gateway's approved host list. The committed [agency registry](src/data/authorities.json) contains the 73 authorities observed during validation; adding a new upstream requires a reviewed source change.

## InfoPoint endpoints — twelve patterns

`{restBase}` comes from the selected authority's `RestUrl`, subject to the gateway's committed registry. For example, the validated CATA base was `https://realtime.catabus.com/InfoPoint/rest`. IDs and direction codes are read from the chosen network rather than assumed to be portable between agencies.

| # | URL relative to `{restBase}` | Current use in tranuga | Further features the data could support |
| --- | --- | --- | --- |
| 10 | `/TransitAuthorityConfig/Get` | Loads agency configuration and its `BaseUrl`/`KmlUrl` geometry location while loading the route catalog. | Agency-specific map bounds/starting zoom; operator-driven refresh settings; capability-aware controls. |
| 11 | `/Routes/GetAllRoutes` | Complete agency catalog, including routes outside the visible set. Merged with visible routes to determine active state. | Route groups; seasonal-route browsing; availability summaries. |
| 12 | `/Routes/GetVisibleRoutes` | Current visible-service set, embedded live vehicles and route messages; the vehicle refresh source for InfoPoint route views. | Vehicle occupancy and destination badges; current headway estimates; route-specific alerts on catalog cards. |
| 13 | `/RouteDetails/Get/{routeId}` | Selected route's directions, stop relations, messages, trace filename and current vehicles. | Detailed route information sheets; detour summaries; printable route pages. |
| 14 | `/RouteDetails/GetAllRouteDetails` | Complete directed route topology for the selected network's planner, filtered to active routes. | Network-wide service coverage analysis; transfer-hub views; topology consistency checks. |
| 15 | `/RouteDetails/GetDirectionsByRouteID/{routeId}` | Discovers the selected route's direction codes before requesting each direction's current stop directory. | Human-readable direction descriptions; direction-specific share links; remembered direction preferences. |
| 16 | `/RouteDetails/GetStopsForRouteDirection/?routeid={routeId}&direction={direction}&timepointsOnly=false` | Refreshes names/coordinates for each selected route direction. Route-stop sort order remains authoritative for ride edges. | A timepoints-only view; direction-specific stop search; timepoint labeling. |
| 17 | `/Stops/GetAllStops` | Stop coordinates/names for full-network journey planning. | Nearby-stop finder; stop search; accessible station-area summaries when supporting data exists. |
| 18 | `/Stops/GetAllStopsForRoutes?routeIDs={routeIds}` | Loads the selected route's stop set, supplementing route detail and direction data. The builder also supports comma-separated route ID lists. | Multi-route stop overlays; shared-stop comparisons; transfer-stop highlighting. |
| 19 | `/Stops/Get/{stopId}` | Selected stop's current name and position before displaying arrivals. | Shareable stop detail views; location correction reports through a separately authorized channel. |
| 20 | `/StopDepartures/Get/{stopId}` | Selected-stop arrivals; when planning, predictions for every stop served by the active directed network. Preserves trip IDs, direction codes, arrival ETA and departure EDT separately. | Full departure boards; trip-following views; connection reliability estimates using collected history. |
| 21 | `/PublicMessages/GetCurrentMessages` | Public service notices on selected-route views and in the planning network. Plain text is rendered safely. | An alerts inbox; route-filtered notices; opt-in alert notifications. |

There is no separate InfoPoint vehicle endpoint in the recovered API set. Vehicles are embedded in route responses. The API client uses all twelve endpoints above through purposeful catalog, route, stop and planning actions.

## Route geometry — one pattern

| # | URL pattern | Current use in tranuga | Further features the data could support |
| --- | --- | --- | --- |
| 22 | `{config.BaseUrl}{config.KmlUrl}{urlEncodedRouteTraceFilename}` | Downloads selected InfoPoint route geometry. Only KML `LineString` coordinates become road traces. The gateway restricts requests to reviewed agency origins and the approved trace directory. | Direction-aware trace styling where geometry identifies direction; printable maps; distance-along-route displays. |

If a trace is unavailable, the map uses visibly dashed straight connectors between known stops and labels them approximate. Connectors do not prove a street route. A new agency configuration pointing to another host or trace directory requires review before it can be used through the gateway.

## Request policy and validation

The endpoint builders are in [src/api/endpoints.ts](src/api/endpoints.ts), the feature workflows in [src/api/index.ts](src/api/index.ts), and the gateway policy in [worker/index.ts](worker/index.ts).

| Work | Browser request policy | Gateway caching |
| --- | --- | --- |
| Live catalog/route predictions | On route/catalog load or explicit planning search; default client cache 15 seconds. | 10 seconds for live route, bus, prediction and public-message calls. |
| Vehicle refresh | Every 15 seconds while a route view is visible; hidden tabs and overlapping polls are skipped. Vehicle client cache 10 seconds. | 10 seconds. |
| Selected-stop arrivals | On stop selection; client cache 10 seconds. | 10 seconds. |
| Planning network | Refreshed for each search. Requests within one session still honor endpoint cache TTLs. UGA tracking and InfoPoint stop-departure batches use at most four concurrent requests. | Endpoint-specific cache values apply. |
| Static UGA data/version | Client cache 5 minutes; dataset reused while its version matches. | 1 hour. |
| InfoPoint topology and stop directories | Client cache 5 minutes for all-route details and stop/direction directories; single-stop details 5 minutes. | 1 hour for stops/direction-stop data; 10 seconds for route-detail data. |
| Agency configuration and KML | Client cache 1 hour. | 1 hour. |
| Discovery | Client cache 1 hour for directory, 1 minute for locate/code lookups. | 1 hour, keyed by the exact URL including selector coordinates/code. |
| Public notices | On route view and planning; client cache 1 minute. | 10 seconds. |

The browser transport coalesces identical in-flight reads and has a 15-second timeout. The gateway has a 12-second upstream timeout, an 8 MiB response limit, GET-only endpoint validation, no forwarded credentials/cookies, no redirect following, and validated JSON/KML responses. Limits and policies are tested in source; they do not make the upstream APIs contractual or continuously available.

No login token, API key, or app cookie is required by the recovered bus-data calls. The Cloudflare deployment token is a separate server-side GitHub Actions secret and is never included in the webapp. Embedded third-party configuration and unrelated fare APIs are outside this inventory.

## What “quickest” means

The browser planner searches directed active-route patterns, access/egress walks and transfers. It considers reachable boarding stops rather than only the nearest one, keeps loop direction, checks prediction reachability, and uses matching run identity for downstream arrival anchors where possible. Its result is the earliest arrival under the available data and configured estimates, with walking/transfers as tie-breakers.

The current model considers live runs and estimated following service starting 7.5 minutes after readiness or the latest known departure, whichever is later. It estimates bus movement when run-specific timing is absent and uses straight-line walking distances, transfer buffers, and a bounded search horizon. It does not have a pedestrian street graph or a complete guaranteed timetable. Results expose their assumptions. Position reports older than two minutes, or without an update timestamp, are labeled as last known positions. Missing current UGA stop tracking or missing ordered InfoPoint topology excludes the affected route from planning rather than inventing ride edges.

Future work can improve this model with an operator-approved GTFS/GTFS-Realtime feed, a pedestrian routing graph, accessible-path data, timetable-backed last-service checks, and observed connection reliability. These are possible additions, not shipped features.

See [API validation evidence](docs/api-validation.md) for the actual read-only probes, response observations, and reproducible deterministic/opt-in test commands. Provider paths, fields, IDs, active states and coverage can change.
