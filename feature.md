# API inventory and feature map

The shipped app integrates **33 transit read-query patterns** plus **one Photon address-search pattern**: the original six UGA/static patterns, three agency-discovery selectors, twelve InfoPoint endpoints and KML, plus eleven Passio patterns. The [README](README.md#complete-api-inventory-33-patterns) contains the complete transit method/query/body contracts and reproduction commands; its [address-search section](README.md#address-search-and-maps) specifies the additional `/api/places` and fixed Photon upstream contract. This file maps every call to implemented and possible future features; future ideas are not shipped capabilities.

The interface is original. APK visual designs/assets, embedded keys, account APIs, ticket purchasing, ride requests and push/device registration are excluded.

## Implemented features

- Complete route catalog with confirmed active service first, lightly tinted active cards, grey unavailable/unconfirmed cards, explicit service labels, search/filter, selected-route road traces and current stops/variants.
- Reported bus position/heading, original update ages, stale/unknown-age labels and selected-stop arrivals.
- Named stop/place/address autocomplete with keyboard selection, arbitrary map or decimal-coordinate endpoints, requested geolocation, endpoint swapping and directed bus journey estimation with walks, waits and transfers.
- Combined reviewed Georgia channels, separate Ohio Passio and other InfoPoint networks, explicit ID aliases, three-node Passio comparison, source health and bounded saved fallback.
- Visible-tab lightweight refresh, explicit full-network synchronization and source/provenance/conflict status.
- Passio provider name/software version/route groups, explicit bus search, provider timetable clock labels and a separate requested operator transit comparison.
- Classified travel notes with line icons, plain-language titles, deduplication and expandable source details; student development/open-source and Codex footer attribution.
- Static production assets, restricted read-only gateway, GitHub Actions verification/deployment workflow and desktop/mobile feature checks.

“Active now” differs from “published in a route catalog.” Publication flags abstain from current-service decisions; a publication-only fallback needs a fresh reported vehicle or a credible nonscheduled arrival with an original update time. Unknown, stale and contradictory topology cannot silently manufacture planning service. See [replication.md](docs/replication.md).

## Bases and bodies

- `U = https://my.uga.edu/v4_19/cache`
- `S = https://d1dhvjc4b8xlgl.cloudfront.net/mobile-bus-data`
- `D = http://mobilegateway.rideralerts.com/gateway/TransitAuthorities`
- `I = {discovered and reviewed RestUrl}`, such as `https://bustracker.accgov.com/InfoPoint/rest` or CATA's `https://realtime.catabus.com/InfoPoint/rest`.
- `P = https://passiogo.com`, `https://replicated2of3.passiogo.com` or `https://replicated3of3.passiogo.com`.
- `sid = "5842"` for Athens Public Transit **Ohio**, or `"3994"` for UGA **Georgia**. These systems are never aliases.
- Passio JSON bodies: `R = {"systemSelected0":"{sid}","amount":1}`, `B = {"s0":"{sid}","sA":1}`, `A = {"systemSelected0":"{sid}","amount":1,"routesAmount":0}`. `W` is the exact two-point transit payload in the README. Every POST requires `Content-Type: application/json`.

## UGA and static data — six patterns

| # | Method and request | Implemented use | Possible further features |
| --- | --- | --- | --- |
| 1 | GET `U/Routes` | All UGA/county routes, names/colors and current-service flags. | Route favorites; operator filters; observed service history. |
| 2 | GET `U/Buses` | Fleet location/heading, route association, original timestamps and refresh. | Occupancy where reliable; next-stop cards; vehicle-follow mode. |
| 3 | GET `U/routeTracking_{routeId}` | Current ordered stops, native directions, route predictions and planning. | Stop arrival badges on route cards; route wait comparisons. |
| 4 | GET `U/stop_{stopId}` | Selected-stop predictions; numeric campus and `c`-prefixed county IDs. | Favorites; departure-board widgets; explicit opt-in arrival reminders. |
| 5 | GET `S/version.json` | Static dataset version checks. | Dataset change summaries and controlled offline refresh. |
| 6 | GET `S/busData.json` | Shapes, stops, trip/route mappings, static fallback and loop evidence. | Offline network maps; topology version comparison; coverage analysis. |

Current `routeTracking` stops take precedence over older static positions/order. Campus responses can use `direction`; county tracking uses `directionId`, while stop prediction groups can still use `direction`. Native direction labels are not enough to cross-map providers: reviewed county direction `1` corresponds to InfoPoint `O`, and `0` to `I`, based on actual ordered stops. UGA prediction-array positions do not establish common run identity.

## InfoPoint discovery — three selectors

| # | Method and request | Implemented use | Possible further features |
| --- | --- | --- | --- |
| 7 | GET `D` | Agency directory and reviewed `RestUrl` selection. | Favorite networks; agency coverage map. |
| 8 | GET `D/Locate?Lat={lat}&long={lon}` | Explicit nearby-agency lookup. | Map-based agency suggestions after user selection. |
| 9 | GET `D/?includeHiddenPropertyCode=%40{code}` | Explicit authority/property-code lookup. | Shareable network shortcuts. |

The code selector is not authentication and may return more than one authority. The original directory uses HTTP on the gateway-to-provider hop. Dynamic metadata cannot expand the committed gateway origin registry; 73 observed authority roots are reviewed, not individually guaranteed compatible.

## InfoPoint data — twelve endpoints and KML

| # | Method and request | Implemented use | Possible further features |
| --- | --- | --- | --- |
| 10 | GET `I/TransitAuthorityConfig/Get` | Selected-authority settings and approved trace location. | Capability-aware controls; operator map bounds and refresh settings. |
| 11 | GET `I/Routes/GetAllRoutes` | Complete agency catalog and embedded vehicles. | Seasonal/grouped route browsing. |
| 12 | GET `I/Routes/GetVisibleRoutes` | Published route set, buses and route notices. | Occupancy/destination badges; catalog alerts. |
| 13 | GET `I/RouteDetails/Get/{routeId}` | Route stops/directions, vehicles, notices and trace filename. | Printable route sheets; detour summaries. |
| 14 | GET `I/RouteDetails/GetAllRouteDetails` | Complete directed topology for network planning. | Transfer-hub/coverage analysis; topology consistency tools. |
| 15 | GET `I/RouteDetails/GetDirectionsByRouteID/{routeId}` | Actual native direction codes. | Direction-specific links and preferences. |
| 16 | GET `I/RouteDetails/GetStopsForRouteDirection/?routeid={routeId}&direction={direction}&timepointsOnly=false` | Direction stop metadata; `RouteStops.SortOrder` supplies ride order. | Timepoint-only view; direction stop search. |
| 17 | GET `I/Stops/GetAllStops` | Full stop directory/coordinates for planning. | Nearby-stop search; station-area exploration. |
| 18 | GET `I/Stops/GetAllStopsForRoutes?routeIDs={commaSeparatedRouteIds}` | Route-served stop set. | Multi-route overlays and shared-stop highlighting. |
| 19 | GET `I/Stops/Get/{stopId}` | Selected-stop current details. | Shareable stop pages. |
| 20 | GET `I/StopDepartures/Get/{stopId}` | Selected/network arrivals, ETA versus EDT, schedule/run identity and update ages. | Full departure boards; historical connection reliability. |
| 21 | GET `I/PublicMessages/GetCurrentMessages` | Safely rendered public notices. | Alert inbox and explicit opt-in notice subscriptions. |
| 22 | GET `{config.BaseUrl}{config.KmlUrl}{encodedTraceFilename}` | Reviewed KML road geometry; only `LineString` coordinates count. | Trace-distance overlays and printable maps. |

There is no separate vehicle endpoint in this contract: vehicles are embedded in route responses. Unordered direction-stop arrays do not prove stop order. Missing traces produce labeled approximate connectors; missing ordered topology excludes the affected pattern from planning.

## Passio — eleven read queries

| # | Method and request | Implemented use | Possible further features |
| --- | --- | --- | --- |
| 23 | POST `P/mapGetData.php?getRoutes=1`, body `R` | Variant catalog, publication flags and explicit UGA group IDs. | Group favorites; seasonal/variant comparison. |
| 24 | POST `P/mapGetData.php?getStops=2&withOutdated=1&wBounds=1&showBusInOos=0`, body `B` | Stops, complete ordered variants, return visits, separate road segments and groups. | Stop coverage layers; data-quality comparison; offline maps. |
| 25 | POST `P/mapGetData.php?getBuses=1&speed=1`, body `B` | Fleet positions/headings and refresh; device keys are not bus IDs. | Occupancy where validated; vehicle following; headway observations. |
| 26 | GET `P/mapGetData.php?eta=3&stopIds={ids}&userId={sid}` | Stop/route predictions and network batches of up to 40 stops; reviewed optional `routeId`/`position`. | Visit-specific arrival boards and run-following views. |
| 27 | POST `P/goServices.php?getAlertMessages=1&alertCRC=na&noOptions=1`, body `A` | Plain-text public messages. | Route-filtered alert inbox and importance filters. |
| 28 | GET `P/mapGetData.php?getSystems=2&sortMode=1&credentials=1&acronymId={sid}` | Selected provider's normalized name/identity information. | Verified coverage/bounds panel. |
| 29 | GET `P/goServices.php?goWebVer=1` | Provider website software version. | Version-change diagnostics; compatibility notices. |
| 30 | POST `P/mapGetData.php?getRoutes=2&sortMode=1&credentials=1`, body `R` | Actual route groups, representative variants and supplied stop counts. | Group-level navigation and cross-version group comparison. |
| 31 | GET `P/mapGetData.php?schedule=4&routeId={variantId}&stopId={stopId}` | Explicit stop timetable with provider timezone and undated clock labels. | Printable schedules if complete dates/service calendars become available. |
| 32 | POST `P/mapGetData.php?getBuses=2&search={encodedQuery}`, body `B` | Explicit bus-number/name lookup; unmatched searches stay empty. | Saved fleet searches; follow a selected matching bus. |
| 33 | POST `P/mapGetData.php?walk=2`, body `W` | Explicit separate operator transit comparison; coordinates are not cached/persisted. | Explain differences between operator and local estimates, where identities/timing are supplied. |

`credentials=1` is a public query selector, not a secret. Native optional device IDs and account/write selectors are unnecessary and not permitted. Provider journey comparisons exclude driving alternatives, preserve missing route identities/durations, and use only explicit numeric duration fields. The application's independent bus planner is not replaced by, averaged with, or corroborated by these suggestions.

Passio local clock-only bus timestamps do not prove an absolute GPS measurement time; those positions retain unknown freshness. UTC/epoch ETA fields are parsed only when the contract identifies the absolute time. Return visits and multiple variants are preserved. Disconnected trace pieces remain separate polylines. See [Passio contracts](docs/passio-api.md).

## Request, cache and crawl policy

| Work | Client policy | Edge cache |
| --- | --- | --- |
| UGA live catalog/tracking | On feature/full crawl; default 15 s. | 10 s. |
| Original vehicle refresh / selected stops | Route positions every 15 s visible; vehicle and selected-stop requests generally 10 s. | 10 s. |
| Lightweight configured-source crawl | Catalogs, vehicles, alerts every 60 s visible; skips overlap/hidden tabs. | Endpoint-specific. |
| Full network | Explicit sync or planner; each adapter caps route/stop calls or Passio ETA batches at four; each ETA batch has at most 40 stops. Mirrors run concurrently. | Endpoint-specific. |
| UGA static/version | Client 5 min; dataset reused while version matches. | 1 h. |
| InfoPoint config/KML | Client 1 h. | 1 h. |
| InfoPoint topology/stop/direction directories | Client 5 min. | Stops/config/direction-stop 1 h; route detail/all-details 10 s. |
| Discovery | Directory 1 h client; locate/code 1 min. | 1 h, keyed by exact selector URL. |
| Passio catalog | Client 15 s default. | 1 min. |
| Passio topology | Client 5 min. | 1 h. |
| Passio buses/search and ETAs | Client 10 s. | 10 s. |
| Public messages | Client 1 min. | 10 s. |
| Passio provider information/version/groups | Identity/version 1 h; groups 5 min. | 1 h. |
| Passio timetable | Client 1 min. | 1 h. |
| Photon address search | 500 ms pause; 3–120 characters; skip exact local stop matches or at least three local stop hints; abort superseded queries; 50-entry, 5-minute tab-memory cache. JSON POST to `/api/places`; fixed upstream GET `/api/?q=…&lat=…&lon=…&limit=5&lang=en`. | `no-store`; no saved snapshots. |
| Operator comparison | Explicit action; no client/edge cache or saved snapshot; coordinate bodies are not written to the request log. | `no-store`. |
| Last-good normalized snapshots | At most 64 slots, 2,000,000-character persistence cap and 24 h static age. Cached active flags/predictions: 2 min eligibility; cached vehicle display: at most 5 min. | Browser storage, not edge state. |

Address queries use a separate six-second/256 KiB upstream cap and 1 KiB POST cap. Maps retain Leaflet/OpenStreetMap, and the selected network supplies the address-search bias. See the README for Photon usage policy, privacy, costs and note classes.

Identical transit requests coalesce. Browser timeout is 15 s; gateway upstream timeout is 12 s, response limit 8 MiB and validated POST body limit 8 KiB. Cache/body keys preserve system/action separation. Storage/schema failures do not convert corrupt data into valid fallback. `snapshotAt` and original measurement/update times are preserved through nested coordinators. There is no closed-browser/server cron crawler.

The full source/replica rules and tolerances are in [replication.md](docs/replication.md). The reviewed Georgia aliases cover at most two overlapping channels per route; unrelated InfoPoint agencies and Ohio never become extra Georgia votes.

## Planning boundaries and future work

The browser searches all feasible access/egress stops, directed active patterns, predicted waits, estimated following service and transfers. It preserves loop direction, considers later faster runs, and keeps nondominated arrival/transfer/walking states. Timing uses straight-line walking, declared bus estimates and a bounded horizon. It does not guarantee future service or accessible street paths.

Possible additions include operator-approved GTFS/GTFS-Realtime schedules, pedestrian routing/accessibility data, service-calendar and last-bus checks, saved favorites, and explicitly authorized historical reliability collection. Notifications, user accounts, server-side scheduled crawling and geographic identity guesses are not shipped.

[API validation](docs/api-validation.md) and [verification evidence](docs/verification.md) distinguish executed dated checks from production publication. Undocumented provider paths, fields, IDs and coverage may change.
