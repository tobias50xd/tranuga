# tranuga

A static bus explorer and quickest-trip estimator, deployed with GitHub Actions to Cloudflare Workers Static Assets. The browser lists routes, maps current stops and reported bus positions/headings, and computes directed bus journeys between named stops, addresses, map points or your location. Its visual design is original; APK layouts, artwork, assets and embedded keys are not build inputs.

## Use the app

- **Main menu:** switch **Dark mode** on/off and use **Athens lock**, which is on by default. Both settings are remembered on this device.
- **Routes:** star bus-line cards to pin favorites first, followed by UGA routes, then city routes. Active service has a light tint; unavailable and unconfirmed service appears grey with a text label. Search names/numbers, filter service, and select a route for its road trace, stops, direction variants, bus headings and observation ages. Select a stop for arrivals or to start a journey there.
- **Plan a trip:** type a stop, place or address, then select an autocomplete hint with the pointer or arrow keys and Enter. You can also pick either point on the map, choose **My location** for the start, or enter decimal `latitude, longitude`. Editing a selected name clears its previous coordinates until you select again. Swap points, choose the access/egress walking limit, and get a bus-and-walk itinerary with waits, transfers and explicit timing assumptions. Calculation shows an indeterminate loading bar. The result map draws only the ridden portions of the selected lines, marks transfer stops with a purple ↔ symbol, and refreshes their bus markers. Notes stay collapsed below the map.
- **Data reliability:** inspect responding sources, disagreements and saved-backup state. **Sync all sources** crawls the selected network's full route/stop/prediction data. One responding source can still provide a labeled catalog/topology fallback, but a bus location from a three-node Passio network is displayed only after at least two replicas agree. A current Passio point supersedes an outdated duplicate for the same bus.
- **Provider tools:** where Passio supplies them, open provider information/version/route groups, search for a specific bus, view a stop's provider timetable, or explicitly request a separate provider journey comparison.
- **Networks:** Athens lock offers the combined Georgia network, UGA's Passio network and Athens-Clarke County InfoPoint. Turn the lock off to use Athens Public Transit in Ohio or another reviewed InfoPoint agency, search the directory, locate a nearby agency, or enter an authority code.

All clock times use the device timezone except provider timetable clock labels, which retain the operator's stated IANA timezone. Missing dates, route identities and durations remain unknown rather than being invented.

### Favorites and bus-line order

Use the **star** on a bus-line card to add/remove a favorite without opening the route. Favorites stay at the top across reloads. The ordering is **favorites → UGA campus → city → other networks**, with active, unconfirmed and inactive service sorted within each group, followed by natural route-number order. A favorite city route can therefore precede an unfavorited UGA route. Search and **Active only** still apply to favorites.

Operator labels use explicit UGA `isAthensBus`/selected-provider metadata, with reviewed aliases for older snapshots. Favorites are scoped by network kind, agency ID and native/canonical route ID, so equal IDs in Ohio and Georgia remain distinct. They are saved locally under `tranuga.favorites.v1`, capped at 500 entries. Blocked/full storage keeps session favorites usable; malformed saved entries are ignored. No account or location is needed. See [favorites.ts](src/favorites.ts) and [route-presentation.ts](src/route-presentation.ts).

### Dark mode and Athens lock

Both buttons are in the main navigation on desktop and mobile and expose their on/off state with `aria-pressed`.

**Dark mode** changes the complete app palette: route/service cards, notes, forms, address hints, journey results, footer and map controls/popups. Leaflet/OpenStreetMap stays in use; a local CSS filter darkens only the map tile layer while preserving route and bus colors and the map attribution. On the first visit, the app follows the device's light/dark preference. An explicit choice is saved under `tranuga.theme.v1` (`light` or `dark`) and applied before the app renders through [public/theme.js](public/theme.js). Switching the palette preserves the current view and selected trip points.

**Athens lock starts on** and scopes the app to **Athens, Georgia / UGA / Athens-Clarke County**:

- Network choices include only combined UGA/Athens, UGA Passio `3994`, and Athens InfoPoint authority `58`. The global directory, nearby/code lookup and Ohio network are available after unlocking. The lock also guards network selection in code.
- Bus markers, vehicle lists/counts, polling, bus-search results, sync summaries and planner vehicle data exclude positions outside the configured Athens area. Original positions and observation times are preserved.
- Stop/address suggestions and map picks stay inside the same area. Typed coordinates and **My location** outside it receive an explanation before trip planning or provider comparison is requested. Enabling the lock clears foreign trip points; enabling it while another city's network is selected returns to the default Georgia network.
- The planner keeps complete directed stop patterns inside the area. A pattern containing an outside stop is excluded with a note, preserving stop order and transfer correctness.
- Every route/planner map limits panning to the Athens area. Its minimum zoom is calculated from the actual viewport using Leaflet's [bounds/zoom controls](https://leafletjs.com/reference-1.9.4.html#map-getboundszoom), so the furthest overview shows the whole area without allowing further zoom-out. The limit updates when the viewport changes; zooming in remains available. Turning the lock off restores other networks and unrestricted map navigation.

[athens.ts](src/athens.ts) defines one shared service-area rectangle: **33.86°–34.10° latitude, −83.54°–−83.24° longitude**. It covers all 608 reviewed local stops and is the common boundary for bus/point filtering and map limits. The setting controls the client interface and planner; the gateway retains its documented read-query allowlist for unlocked use. This is an app service-area rectangle rather than a parcel-level boundary dataset.

The lock choice is saved under `tranuga.athens-lock.v1` (`true`/`false`); a new or invalid preference defaults to locked. Preferences contain no coordinates. If storage is unavailable, both controls still work for the current visit. Routes and settings can be changed independently; replication rules and API credentials are unaffected.

### Application URLs

The app uses browser-history routes and Cloudflare's single-page-app fallback, so these paths can be opened, refreshed and shared directly:

| Path | View |
| --- | --- |
| `/routes` | Route catalog |
| `/routes/{routeId}` | One route, its stops, trace and current buses |
| `/plan` | Trip planner |
| `/networks` | Network selector |

Opening `/` replaces the address with `/routes`. Back/forward navigation restores the corresponding view without a full page reload.

## Networks, replicas and identity

The requested [Athens Passio website](https://athenstransit.passiogo.com/) is **Athens Public Transit, Ohio**, system **5842**. UGA and Athens-Clarke County are in **Georgia**. The official [UGA transit page](https://tps.uga.edu/transit/) links [routes.uga.edu](https://routes.uga.edu/), whose Passio system is **3994**. Ohio and Georgia have separate coordinators, map centers, ID scopes and saved snapshots.

| Network | Sources used | Comparison scope |
| --- | --- | --- |
| UGA + Athens, Georgia | UGA portal, Athens InfoPoint authority `58`, UGA Passio `3994` | Reviewed campus aliases join UGA↔Passio; reviewed county aliases join UGA↔InfoPoint. At most two overlapping provider channels per reviewed route. |
| UGA Passio | System `3994` on three fixed Passio nodes | Same operator and system across backend mirrors. |
| Athens Public Transit, Ohio | System `5842` on three fixed Passio nodes | Same Ohio operator across backend mirrors; never a Georgia replica. |
| Another InfoPoint authority, such as CATA | That authority's reviewed `RestUrl` | Independent selected network; no CATA/Georgia identity merge. |

Passio nodes are `https://passiogo.com`, `https://replicated2of3.passiogo.com`, and `https://replicated3of3.passiogo.com`. A two-of-three result means **transport replica agreement**, not independent GPS measurements or guaranteed truth. The UGA portal and its overlapping providers also appear to share upstream data. Missing operator coverage abstains from comparison.

The [reviewed crosswalk](src/data/athens-crosswalk.json) contains 35 route aliases, 608 stop aliases and 19 observed fleet aliases. It preserves route variants and source-native IDs. Current ordered stops proved 49 direction-pair matches and four conflicting city patterns. Similar names, nearby coordinates and numeric ID suffixes do not create new aliases. [Replication evidence](docs/replication-evidence.md) records the observations, inverted UGA city direction labels, stale static-coordinate anomalies and source hashes. [Replication behavior](docs/replication.md) explains selection and fallback rules.

## Travel notes and service states

Notes are **collapsed dropdowns**, placed after route maps and after the planner map. Short titles and regex-generated fragments replace long diagnostic sentences. Expand **Notes**, then **Full text** for every original provider/diagnostic message. Repeated warnings share a card; operator alerts stay distinct. Errors appear before warnings and information. A blocking request, point-selection or location error opens its dropdown so the next action remains visible. Icons and text convey meaning alongside color.

| Class (`data-note-kind`) | Icon | Meaning and action |
| --- | --- | --- |
| `service` | Bus | Operator service update: read the original alert. |
| `availability` | Warning triangle | Some routes lack confirmed service or usable stops and are excluded from planning. |
| `backup` | Archive | Another source or a saved snapshot is being used; check its age. |
| `freshness` | Clock | Old/unknown observation times: check bus update labels. |
| `comparison` | Comparison squares | Sources disagree; unresolved stop order is excluded from planning. |
| `estimate` | Calculator | Timing or walking is estimated; allow extra time. |
| `connection` | Disconnected Wi-Fi | A request failed; retry and inspect source details. |
| `action` | Map pin | Select the trip points or recover from a location error. |
| `info` | Information circle | Additional context that does not imply an error. |

Informational cards use a quiet green tone, warnings amber, and action/request errors red with `role="alert"`. The mapping lives in [notes.ts](src/notes.ts); it organizes messages for display without changing source status, service availability or planner decisions. Operator alert text is escaped and never rendered as HTML. Bus-line cards sort favorites first, then UGA before city, with service state and natural route numbers inside each group. Grey cards remain available for viewing route details, while the planner uses only eligible active service.

[compact-note.ts](src/compact-note.ts) applies ordered, anchored regex rules to known messages; examples:

| Input pattern / evidence | Compact fragment |
| --- | --- |
| `^Backup data in use: (sources) (is|are) unavailable` | `Backup · sources offline` |
| `^(\d+) data disagreements? detected` | `N source conflicts · disputed stop order excluded` |
| `Showing static stops` | `Static stops · service unconfirmed` |
| `older than (two|2) minutes` / missing timestamp | `GPS >2 min / time unknown` |
| `Transit request failed\s*\((\d{3})\)` | `HTTP 503 · retry` |
| `Predictions unavailable at (N) stops` | `N stops · no ETA · estimated waits` |
| Planner defaults and assumptions | `Fallback wait: 7.5 min`, `Transfer buffer: 45 s`, other original numeric limits |

Operator service alerts bypass diagnostic substitutions and receive only conservative whitespace, punctuation and boilerplate cleanup; unmatched diagnostics use that same conservative cleanup. Route letters/IDs, negation (`no`, `not`, `until`), clock times, counts and cancellation/detour information are preserved. Regex processing changes presentation only; original text is escaped and retained under **Full text**, and service/planning decisions still use source data. Normal notes open only on request; expanded route notes retain their state during refresh.

The footer on every view identifies this as **a student-based open source project, for development purposes only**, followed by **Vibe coded with ❤️ by Codex**. It also keeps the independent-service and estimated-time notices.

## Address search and maps

Maps retain **Leaflet + OpenStreetMap tiles**. Address suggestions use the keyless public [Photon demo](https://github.com/komoot/photon#readme), an OpenStreetMap geocoder that supports autocomplete. Stop hints first search the reviewed selected-network directory, supplemented by the existing transit stop-directory APIs; opening the planner does not require a full arrival crawl. Ohio and Georgia stop hints remain separate. A hint is a location, not evidence that buses are currently serving it.

| Request | Exact contract and use |
| --- | --- |
| Browser `POST /api/places` | `Content-Type: application/json`; body `{"query":"Tate Student Center","lat":33.948,"lon":-83.377}`. Exactly these three keys; query 3–120 characters with no control characters; finite numeric latitude `[-90,90]`, longitude `[-180,180]`; upload at most 1 KiB; no URL parameters. |
| Fixed upstream `GET https://photon.komoot.io/api/` | Query `q={encodedQuery}&lat={latitude}&lon={longitude}&limit=5&lang=en`. Coordinates bias relevance toward the selected network; they do not impose a service boundary. Returns GeoJSON `FeatureCollection`, with Point coordinates **`[longitude, latitude]`**. Only valid named/address points become hints. |

```sh
# Through the local Worker; address text stays out of the browser request URL.
curl -fsS 'http://localhost:8787/api/places' \
  -H 'Content-Type: application/json' \
  --data '{"query":"Tate Student Center","lat":33.948,"lon":-83.377}'

# Same public upstream contract, directly:
curl -fsS 'https://photon.komoot.io/api/?q=Tate%20Student%20Center&lat=33.948&lon=-83.377&limit=5&lang=en'
```

The input waits **500 ms**, requires at least three characters for address requests, cancels superseded searches, and rejects stale replies. Two characters can show local stops. An exact local stop match or three or more local stop hits avoids an address request. At most five local and five provider candidates are considered, with eight displayed. A 50-entry, five-minute memory cache avoids repeated lookups in the current tab; queries/addresses are not written to localStorage or the transit snapshot store. Typing sends the query and the network center to Photon after the pause; selecting **My location** does not change that search bias. The Worker forwards no caller credentials, rejects redirects, caps upstream waits at six seconds and responses at 256 KiB, validates the JSON envelope, and returns `no-store` without edge caching. Upstream still receives the search text in its own query URL. The app does not log request bodies. Keyboard navigation, Escape/Tab dismissal and explicit selection keep text and coordinates consistent.

The UI credits Photon and OpenStreetMap. Photon's public demo permits reasonable use, may throttle/ban excessive use and has no availability guarantee; use a managed or self-hosted geocoder before substantial traffic. Local stop hints and map picking remain available during an address-service outage. See [Photon API documentation](https://github.com/komoot/photon/blob/master/docs/api-v1.md). OpenStreetMap's public Nominatim service is not used for autocomplete because its [usage policy forbids it](https://operations.osmfoundation.org/policies/nominatim/).

### Website costs

There is no map API key or paid map SDK in this implementation. As checked on November 13, 2026, [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) lists free unlimited static-asset requests and a free Worker quota of 100,000 requests/day with 10 ms CPU per invocation. Transit/address gateway calls consume Worker requests, including edge-cache hits. Low traffic can fit the free plan; polling, replicated feeds and full network crawls generate multiple calls per visitor. Workers Paid starts at $5/month, with additional usage charges above its allowances. A custom domain and a future managed/self-hosted geocoder may add costs. OSM tiles and Photon remain subject to their provider usage policies, so these limits do not promise free hosting at arbitrary traffic.

## Run locally

Use Node.js **22.12+** and npm; install the locked dependencies:

```sh
npm ci
npm run build
npm run dev:edge
```

Open Wrangler's URL, normally **http://localhost:8787**. It serves the production static build and API gateway. Rebuild after source edits. For hot reload, keep Wrangler running and start `npm run dev` in another terminal; Vite normally serves **http://localhost:5173** and proxies `/api` to port 8787. `npm run preview` alone does not supply the gateway.

## GitHub Actions → Cloudflare

[.github/workflows/deploy.yml](.github/workflows/deploy.yml) verifies pull requests and deploys successful pushes to `main`, or manual runs on `main`, to **Cloudflare Workers Static Assets**. Static files and the small read-only gateway deploy together; no database or SSR is required.

1. Configure a Cloudflare account and `workers.dev` subdomain.
2. Create an account-scoped **Edit Cloudflare Workers** API token.
3. Add GitHub Actions secrets **`CLOUDFLARE_API_TOKEN`** and **`CLOUDFLARE_ACCOUNT_ID`** to the repository or its `production` environment.
4. Push to `main`; inspect **Test and deploy to Cloudflare** and the successful Wrangler deployment URL.

CI runs types, deterministic tests, a production build, desktop/mobile browser checks and a Wrangler bundle dry run before the deployment job. Credentials belong in GitHub Actions secrets, never frontend variables or source files. The site is hosted at **[tranuga.tobias-seeanner.workers.dev](https://tranuga.tobias-seeanner.workers.dev)**. The baseline [GitHub Actions run](https://github.com/tobias50xd/tranuga/actions/runs/43353286621) completed both verification and deployment successfully. Check the latest action for the revision currently deployed; build/test/dry-run success alone does not establish publication.

[Deployment instructions](docs/deployment.md) cover account setup, gateway policy, headers, cache behavior, custom domains and rollback. See Cloudflare's [Static Assets](https://developers.cloudflare.com/workers/static-assets/) and [GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) documentation for the hosting/authentication model.

## Static frontend and restricted gateway

Vite produces `dist/` containing HTML, JavaScript, CSS, Leaflet and a self-hosted font. Maps, UI state and the independent journey algorithm run in the browser. The Worker serves a same-origin `/api?url={encodedUpstreamURL}` gateway because UGA/CloudFront omit browser CORS headers and the original agency directory uses HTTP.

The transit gateway permits the documented **GET** endpoints and narrowly defined **read-only Passio POST** bodies. A separate fixed-destination **POST `/api/places`** endpoint supplies address suggestions, as documented above. The transit gateway is not a general proxy: origins, paths, query keys, methods, system IDs and JSON body fields are validated against committed policy. Caller cookies/credentials are not forwarded, redirects are rejected, and arbitrary hosts, write actions, device registration, feedback and account APIs are excluded. Limits are 12 seconds upstream, 8 MiB response data and 8 KiB POST data. Successful JSON/KML is validated before use. Passio POST cache keys include a digest of the canonical validated body, keeping systems and actions separate.

The 73 reviewed InfoPoint roots are in [authorities.json](src/data/authorities.json); runtime discovery cannot grant a new host access. The legacy discovery hop remains HTTP because its HTTPS certificate failed validation during the original probe; TLS verification is never disabled. Browser-to-production requests remain HTTPS.

## Complete API inventory: 33 patterns

These are the **33 transit patterns**. The additional address-search request is fully specified in [Address search and maps](#address-search-and-maps), for **34 external API patterns in total**.

The original 22 bus-data patterns remain integrated; Passio adds 11 read-query patterns. Calls have actual catalog, map, stop, planning or provider-tool uses. They are selected by feature and network, not all issued at initial page load. No bus API key, login cookie or bearer token is required by the observed contracts. IDs are discovered from responses; the examples below are dated observations, not universal constants.

Bases and POST body templates:

- `U = https://my.uga.edu/v4_19/cache`; `S = https://d1dhvjc4b8xlgl.cloudfront.net/mobile-bus-data`.
- `D = http://mobilegateway.rideralerts.com/gateway/TransitAuthorities`.
- `I = {authority.RestUrl}`; Georgia example: `https://bustracker.accgov.com/InfoPoint/rest`; CATA example: `https://realtime.catabus.com/InfoPoint/rest`.
- `P` is one of the three fixed Passio HTTPS origins above; `sid` is string `5842` or `3994`.
- Passio `R = {"systemSelected0":"{sid}","amount":1}`; `B = {"s0":"{sid}","sA":1}`; `A = {"systemSelected0":"{sid}","amount":1,"routesAmount":0}`. These are JSON request bodies with `Content-Type: application/json`.

| # | Method | URL, query and body | Actual application use |
| --- | --- | --- | --- |
| 1 | GET | `U/Routes` | Complete UGA/county catalog, names, colors and reported current-service flags. |
| 2 | GET | `U/Buses` | Bus positions/headings, original update times, route association and refresh. |
| 3 | GET | `U/routeTracking_{routeId}` | Current ordered stops/directions, predictions and network planning. |
| 4 | GET | `U/stop_{stopId}` | Selected-stop arrivals; county IDs can have a `c` prefix. |
| 5 | GET | `S/version.json` | Static dataset version checking. |
| 6 | GET | `S/busData.json` | Static stops, route/trip mappings, road shapes and loop evidence. |
| 7 | GET | `D` | InfoPoint agency directory and selected `RestUrl`. |
| 8 | GET | `D/Locate?Lat={lat}&long={lon}` | Explicit nearby-agency lookup; lowercase `long`. |
| 9 | GET | `D/?includeHiddenPropertyCode=%40{code}` | Authority-code selector; not an authentication token. |
| 10 | GET | `I/TransitAuthorityConfig/Get` | Agency configuration and approved geometry location. |
| 11 | GET | `I/Routes/GetAllRoutes` | Full selected-agency catalog and embedded vehicles. |
| 12 | GET | `I/Routes/GetVisibleRoutes` | Publication/visibility set, embedded buses and route messages. |
| 13 | GET | `I/RouteDetails/Get/{routeId}` | Selected route, directions, stops, trace filename and vehicles. |
| 14 | GET | `I/RouteDetails/GetAllRouteDetails` | Full directed topology for network planning. |
| 15 | GET | `I/RouteDetails/GetDirectionsByRouteID/{routeId}` | Valid native direction codes. |
| 16 | GET | `I/RouteDetails/GetStopsForRouteDirection/?routeid={routeId}&direction={direction}&timepointsOnly=false` | Direction stop metadata; ordered `RouteStops.SortOrder` remains authoritative. |
| 17 | GET | `I/Stops/GetAllStops` | Network stop names/coordinates. |
| 18 | GET | `I/Stops/GetAllStopsForRoutes?routeIDs={commaSeparatedRouteIds}` | Selected route's served-stop set. |
| 19 | GET | `I/Stops/Get/{stopId}` | Current selected-stop details. |
| 20 | GET | `I/StopDepartures/Get/{stopId}` | ETA/EDT, schedule/run identity and original update times. |
| 21 | GET | `I/PublicMessages/GetCurrentMessages` | Public service notices as safely rendered text. |
| 22 | GET | `{config.BaseUrl}{config.KmlUrl}{encodedTraceFilename}` | Approved KML `LineString` road geometry. |
| 23 | POST | `P/mapGetData.php?getRoutes=1`; body `R` | Passio variants/catalog; explicit UGA group membership. |
| 24 | POST | `P/mapGetData.php?getStops=2&withOutdated=1&wBounds=1&showBusInOos=0`; body `B` | Ordered variant stops, return visits, groups and separate trace segments. |
| 25 | POST | `P/mapGetData.php?getBuses=1&speed=1`; body `B` | Public fleet bus IDs, positions/headings and lightweight refresh. |
| 26 | GET | `P/mapGetData.php?eta=3&stopIds={commaSeparatedStopIds}&userId={sid}` | Selected-stop/route arrivals and full-network batches, at most 40 stop IDs. Optional reviewed selectors: `routeId`, `position`. |
| 27 | POST | `P/goServices.php?getAlertMessages=1&alertCRC=na&noOptions=1`; body `A` | Public Passio service messages. |
| 28 | GET | `P/mapGetData.php?getSystems=2&sortMode=1&credentials=1&acronymId={sid}` | Provider information; only the verified agency's normalized metadata is exposed. |
| 29 | GET | `P/goServices.php?goWebVer=1` | Provider website software version. |
| 30 | POST | `P/mapGetData.php?getRoutes=2&sortMode=1&credentials=1`; body `R` | Provider route groups, names, variants and supplied stop counts. |
| 31 | GET | `P/mapGetData.php?schedule=4&routeId={variantId}&stopId={stopId}` | Explicit provider timetable with operator timezone and undated clock labels. |
| 32 | POST | `P/mapGetData.php?getBuses=2&search={encodedQuery}`; body `B` | Explicit bus-number/name lookup; 1–40 letters, digits, spaces, underscores or hyphens. |
| 33 | POST | `P/mapGetData.php?walk=2`; body `W` below | Explicit, separate operator transit comparison; never changes the local planner result. |

Body `W` contains exactly two points and the selected system:

```json
{"systems":{"systemSelected0":"5842","amount":1},"routes":{"amount":0},"points":[{"lat":39.295665,"lng":-82.11205},{"lat":39.325428,"lng":-82.101967}],"mode":"transit"}
```

The `credentials=1` selectors above are public query flags, not authorization credentials. Passio's native website uses a form field named `json`; direct probes also confirmed these minimal JSON POST bodies. The application and gateway use the validated JSON contracts.

[feature.md](feature.md) lists future possibilities for every pattern. [Original extraction evidence](docs/api-extraction.md) preserves the initial APK call-site/authentication findings; [Passio extraction and contracts](docs/passio-api.md) covers the public website requests. [API validation](docs/api-validation.md) separates dated live observations from deterministic test scope.

### Reproduce the original APIs

```sh
curl -fsS 'https://my.uga.edu/v4_19/cache/Routes'
curl -fsS 'https://my.uga.edu/v4_19/cache/Buses'
curl -fsS 'https://my.uga.edu/v4_19/cache/routeTracking_5750'
curl -fsS 'https://my.uga.edu/v4_19/cache/stop_155104'
curl -fsS 'https://d1dhvjc4b8xlgl.cloudfront.net/mobile-bus-data/version.json'
curl -fsS 'https://d1dhvjc4b8xlgl.cloudfront.net/mobile-bus-data/busData.json'
curl -fsS 'http://mobilegateway.rideralerts.com/gateway/TransitAuthorities'
curl -fsS 'http://mobilegateway.rideralerts.com/gateway/TransitAuthorities/Locate?Lat=33.95&long=-83.37'
curl -fsS 'http://mobilegateway.rideralerts.com/gateway/TransitAuthorities/?includeHiddenPropertyCode=%40CATA'

rest_base='https://realtime.catabus.com/InfoPoint/rest'
curl -fsS "$rest_base/TransitAuthorityConfig/Get"
curl -fsS "$rest_base/Routes/GetAllRoutes"
curl -fsS "$rest_base/Routes/GetVisibleRoutes"
curl -fsS "$rest_base/RouteDetails/Get/51"
curl -fsS "$rest_base/RouteDetails/GetAllRouteDetails"
curl -fsS "$rest_base/RouteDetails/GetDirectionsByRouteID/51"
curl -fsS "$rest_base/RouteDetails/GetStopsForRouteDirection/?routeid=51&direction=EB&timepointsOnly=false"
curl -fsS "$rest_base/Stops/GetAllStops"
curl -fsS "$rest_base/Stops/GetAllStopsForRoutes?routeIDs=51"
curl -fsS "$rest_base/Stops/Get/1"
curl -fsS "$rest_base/StopDepartures/Get/1"
curl -fsS "$rest_base/PublicMessages/GetCurrentMessages"
curl -fsS 'https://realtime.catabus.com/InfoPoint/Resources/Traces/Route51.kml'
```

### Reproduce all eleven Passio patterns

These examples use the observed Ohio system and public stop coordinates. Substitute `3994` and IDs discovered from its responses for UGA. Each request can use either replica origin instead of the primary.

```sh
passio_origin='https://passiogo.com'
curl -fsS "$passio_origin/mapGetData.php?getRoutes=1" \
  -H 'Content-Type: application/json' --data '{"systemSelected0":"5842","amount":1}'
curl -fsS "$passio_origin/mapGetData.php?getStops=2&withOutdated=1&wBounds=1&showBusInOos=0" \
  -H 'Content-Type: application/json' --data '{"s0":"5842","sA":1}'
curl -fsS "$passio_origin/mapGetData.php?getBuses=1&speed=1" \
  -H 'Content-Type: application/json' --data '{"s0":"5842","sA":1}'
curl -fsS "$passio_origin/mapGetData.php?eta=3&stopIds=190923%2C190985&userId=5842"
curl -fsS "$passio_origin/goServices.php?getAlertMessages=1&alertCRC=na&noOptions=1" \
  -H 'Content-Type: application/json' --data '{"systemSelected0":"5842","amount":1,"routesAmount":0}'
curl -fsS "$passio_origin/mapGetData.php?getSystems=2&sortMode=1&credentials=1&acronymId=5842"
curl -fsS "$passio_origin/goServices.php?goWebVer=1"
curl -fsS "$passio_origin/mapGetData.php?getRoutes=2&sortMode=1&credentials=1" \
  -H 'Content-Type: application/json' --data '{"systemSelected0":"5842","amount":1}'
curl -fsS "$passio_origin/mapGetData.php?schedule=4&routeId=66949&stopId=190923"
curl -fsS "$passio_origin/mapGetData.php?getBuses=2&search=2100" \
  -H 'Content-Type: application/json' --data '{"s0":"5842","sA":1}'
curl -fsS "$passio_origin/mapGetData.php?walk=2" \
  -H 'Content-Type: application/json' \
  --data '{"systems":{"systemSelected0":"5842","amount":1},"routes":{"amount":0},"points":[{"lat":39.295665,"lng":-82.11205},{"lat":39.325428,"lng":-82.101967}],"mode":"transit"}'
```

## Replication, caching and privacy

The browser coordinator fetches configured sources concurrently, validates normalized responses, merges reviewed identities and saves bounded last-good **public transit** snapshots. It uses pairwise-compatible groups, not transitive proximity chains. At most one row per source can vote. Fresh data takes precedence over saved snapshots; a cached majority cannot outvote a fresh survivor. On a three-node Passio network, vehicle output requires a fresh two-of-three location quorum; a lone or fully disputed position is omitted rather than rendered. Duplicate rows for one canonical bus collapse to one record, with `outdated=0` preferred over `outdated=1`, and the map has a final one-marker-per-bus guard. Selected values remain concrete source observations, with source/native-ID provenance and original timestamps—coordinates, headings and arrival times are not averaged.

| Comparison | Rule |
| --- | --- |
| Vehicle agreement | Same canonical fleet/route identity and position ≤100 m. When both reports have absolute measurement timestamps, they must be within 60 s. A vote needs either an original measurement no older than 120 s (and no more than 60 s in the future), or a fresh Passio response explicitly marked `outdated=0`; the latter can corroborate marker location but cannot establish current service for planning without an absolute update time. Passio display requires at least two of its three replicas. Headings do not decide the location quorum and the chosen source heading is not averaged. |
| Stop agreement | Reviewed identity and position within 50 m; a nearby unreviewed stop stays separate. |
| ETA/EDT agreement | Comparable stop/route/direction/run, each arrival and boarding/departure difference ≤90 s. Ambiguous unidentified predictions abstain in both directions. A known run's outlier remains disagreement on one departure, not an extra bus. |
| Topology agreement | Complete ordered canonical stop sequence and compatible loop evidence. Unknown closure abstains; conflicting known closure without a majority excludes that pattern from planning. Extra variants stay separate. |
| Current service | UGA current-service flags differ from InfoPoint/Passio publication flags. Visibility does not outvote current inactivity. A publication-only route enters planning only with a fresh vehicle or credible nonscheduled ETA carrying an original update time ≤180 s. |

The source bar reports health and corroborated/single-source/conflict/saved-backup states. Replica agreement can share one underlying error; it does not guarantee that a bus exists at the displayed coordinate.

| Layer/work | Retention and trigger |
| --- | --- |
| Client request cache | Coalesced identical requests; 15 s default, 15 s timeout; endpoint-specific longer TTLs. |
| Last-good snapshots | Browser localStorage key `tranuga.transit-replicas.v1`; at most 64 resource slots, a 2,000,000-character serialized persistence cap, and 24 h maximum static snapshot age. Unavailable/full storage falls back to memory. |
| Saved live eligibility | Cached active flags/predictions expire after 2 min; non-quorum provider positions can remain visible for at most 5 min, while three-node Passio positions still require a fresh two-replica quorum. Original measurement age still controls current-service eligibility. Original measurement times and selected `snapshotAt` survive nested replication. Static retention does not authorize stale service. |
| Visible-tab lightweight crawl | Every 60 s: catalogs, vehicles and alerts. Hidden tabs and overlapping crawls are skipped. |
| Open-route positions | Every 15 s while visible; overlapping polls are skipped. |
| Full network crawl | **Sync all sources** or planning; the adapter first loads the complete route catalog and ordered topology for every returned route, then fetches current vehicles and batched stop predictions. UGA tracking/InfoPoint departures and Passio ETA batches are capped at four concurrent requests; each Passio batch has at most 40 stops. The three mirror adapters run concurrently. |
| Edge response cache | Most live reads 10 s; Passio catalog 60 s; static/config/directory/topology/KML/provider metadata/timetable 1 h. Full per-layer policy is in [feature.md](feature.md). |

There is no server cron or crawl while the browser is closed. Local trip planning runs on the device. **Request provider comparison** explicitly forwards the two selected points to Passio; that request bypasses client/edge caches and localStorage snapshots, and coordinate bodies are not written to the request log. Geolocation otherwise runs only after the user requests it; nearby-network lookup also explicitly forwards a coordinate to discovery. No account, analytics SDK or continuous location tracking is implemented. Public map tiles still make ordinary requests to OpenStreetMap.

## How quickest-trip estimation works

[src/planner.ts](src/planner.ts) runs a time-dependent earliest-arrival search with a binary heap and nondominated arrival/transfer/walking labels. Planning follows this sequence:

1. Query the complete route catalog and retain every usable directed stop pattern instead of preselecting a single line.
2. Build the connection graph from ordered stops. Routes connect directly at the same canonical stop; an optional transfer edge may walk up to 300 m between distinct nearby stops.
3. Limit usable edges to current service. Catalog-active lines qualify directly; a line with a stale catalog flag may qualify from a fresh vehicle or a fresh nonscheduled ETA. Saved/stale observations do not establish service.
4. Rank every reachable one-line and multi-line journey by arrival time. Stop ETAs/EDTs provide run anchors. When an ETA is absent, a bus observed within 600 m of the directed stop chain can estimate when it reaches the boarding stop; buses that already passed a non-loop stop are ignored. The declared 7.5-minute service estimate remains the final fallback.

The search considers **all** reachable boarding and alighting stops, directed rides, same-stop/walking transfers, catchable predicted runs, recent vehicle positions and modeled following service. It requires at least one bus ride. Remaining on a bus does not add a second boarding wait; confirmed loops can wrap once. Conflicting topology and unconfirmed current service cannot supply planning edges. When a current route-stop request fails, a verified ordered static pattern can still supply topology, but its timing remains explicitly estimated or vehicle-assisted.

| Parameter | Default |
| --- | --- |
| Walking speed | 1.3 m/s; straight-line distances |
| Access/egress walk | 1,200 m each; UI offers 800 / 1,200 / 2,000 m |
| Transfer walk | 300 m; walks cannot chain to bypass access limits |
| Estimated bus movement | 5.6 m/s plus 20 s per stop |
| Estimated following service | 450 s after readiness or latest known departure, whichever is later |
| Transfer buffer | 45 s |
| Prediction age / search horizon | 180 s / 3 h |

Consistent route geometry estimates bus distance; otherwise stop distances are multiplied by 1.25. Actual run identity can anchor downstream arrivals and intermediate dwell. UGA stop prediction arrays do not identify every run, so matching array positions never prove the same bus. Expired/impossible predictions, old original update times, stale vehicle positions and stale network snapshots are ignored. Tests compare the search with an independent exhaustive-path oracle on 40 generated networks and separately cover vehicle-position timing.

The result is **quickest within this declared model**, with `estimated` or `live-assisted` confidence and visible assumptions. The feeds do not provide complete guaranteed timetables, a pedestrian street graph or accessible-path data. Provider timetable labels do not supply dates. Operator journey comparisons are separate suggestions, use only explicit numeric timing, exclude driving alternatives and do not become a quorum proof of the local algorithm. The result map draws only the selected boarding-to-alighting segments and transfer stops, as described below.

### Journey map, transfer stops and calculation progress

The planner records the exact directed pattern and boarding visit on each ride leg. [journey-map.ts](src/journey-map.ts) selects that variant and clips its trace to the ridden stop sequence. Unused route tails, other variants and unrelated lines are omitted. Ordered loop wrapping is supported, and multipart trace gaps remain separate polylines. Trace matching requires stops within 100 m and a consistent directed order/distance; missing, reversed, unrelated or ambiguous geometry falls back to **dashed connectors through only the used stops**. This remains a schematic display where road geometry is unavailable.

Each boarding after the first gets a numbered **purple ↔ transfer marker** and a “Change at” label in the itinerary. Shared-stop transfers use one marker; walking transfers mark the alighting and next boarding stops. Walking stays dashed. The camera fits the traveled segments and stops; a bus elsewhere on a selected line does not widen the view. Editing endpoints clears old trip lines, transfer markers and journey buses.

The calculate button shows **Calculating route…** and an accessible indeterminate loading bar while feeds load and the journey is calculated. It returns to normal on success/failure; navigation removes the old progress UI. No percentage is invented. Inputs remain disabled during calculation, and reduced-motion users get a static busy bar. Normal notes stay below maps in collapsed dropdowns; full assumptions are also collapsed.

### Bus marker interpolation and accuracy

[vehicle-motion.ts](src/vehicle-motion.ts) smooths **displayed markers between received observations**. It preserves original data for planning, replication, storage, popup update ages and service decisions. Route-detail and completed-journey maps refresh positions every 15 seconds while visible; geometry is not recalculated by a marker refresh.

| Guard | Display policy |
| --- | --- |
| Fresh, increasing observation times; same bus and route | Interpolate toward the accepted fix for at most **1.2 s**, with shortest-angle heading rotation. |
| Distance from the latest accepted GPS fix | At most **20 m** throughout the tween; larger moves first catch up to within that cap. |
| Observations more than 60 s apart, movement >120 m, or implied speed >25 m/s | Snap to the received position. |
| Unknown/stale time (>2 min), time >1 s in the future, saved fallback, or route reassignment | Snap; no invented motion. |
| Repeated cached fix / out-of-order timestamp | Keep the current tween / ignore the older fix. |
| Reduced motion / hidden page / removed map | Snap or finish at the known fix; cancel animation frames and listeners. |

There is **no extrapolation beyond the received fix**, and coordinates, headings and observation timestamps in the source data are not averaged or rewritten. The 20 m cap describes display lag relative to an accepted reported fix; provider GPS error, network delay and the bus's true current position remain unknown. Short straight-line tweening can cross a corner within that cap. This provides brief smoothing with bounded extra display error, rather than promising continuous measured motion between polls. Animation state is local to the map and is cleared on navigation/network changes.

## Tests and verification

```sh
npm run typecheck
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
npx wrangler deploy --dry-run --outdir /tmp/tranuga-worker
```

`npm run check` runs deterministic tests, the production build/types and browser tests. Browser tests use production `dist/` assets, realistic bounded fixtures, desktop/mobile viewports, rebased prediction times and blocked external map tiles. These tests prove behavior against captured contracts, not future operator uptime or a live deployment.

| Test file | Scope |
| --- | --- |
| [api.test.ts](tests/api.test.ts) | Original 22 endpoint workflows, schemas, timing, topology, fallbacks and client behavior. |
| [passio.test.ts](tests/passio.test.ts) | All 11 Passio patterns, both systems, mirrors, variants/geometry, prediction parsing and four provider tools. |
| [crosswalk.test.ts](tests/crosswalk.test.ts) | Reviewed route/stop/fleet aliases, operator boundaries and UGA `directionId` regression. |
| [replication-merge.test.ts](tests/replication-merge.test.ts) | Majority/outlier selection, provenance, freshness, ambiguous predictions, current service, loops, conflicts and nested-cache rules. |
| [replication-service.test.ts](tests/replication-service.test.ts) | Concurrent crawling, schema/storage guards, persistent fallback, bounded retention and nested coordinator health. |
| [planner.test.ts](tests/planner.test.ts) | Directed journeys, loops, transfers, ETA/EDT, arbitrary/geolocation coordinates, stale/unreachable cases and independent oracle. |
| [worker.test.ts](tests/worker.test.ts) | Approved GET/POST contracts, payload limits, system separation, origin/method validation, proxy/caching failures and comparison privacy. |
| [journey-map.test.ts](tests/journey-map.test.ts), [vehicle-motion.test.ts](tests/vehicle-motion.test.ts), [favorites.test.ts](tests/favorites.test.ts) | Partial/loop/multipart geometry, transfer identity, bounded interpolation/snap rules, favorite persistence and ordering. |
| [preferences.test.ts](tests/preferences.test.ts) | Preference defaults/restore/storage failure, local network eligibility, all reviewed stops in bounds, foreign-bus filtering and complete-pattern exclusion. |
| [ui.test.ts](tests/ui.test.ts), [presentation.test.ts](tests/presentation.test.ts), [browser tests](tests/e2e/app.spec.ts) | Rendering helpers, service ordering, note classes, place normalization/cache/privacy and desktop/mobile workflows, selection/race guards and failures. |

Provider probes are opt-in:

```sh
LIVE_TRANSIT=1 npx vitest run tests/api-live.test.ts
LIVE_PASSIO=1 npx vitest run tests/passio.test.ts
```

The latest November 13 acceptance run passed **417 deterministic tests and 78 browser tests**, plus TypeScript, production build and Wrangler dry run. Executed historical runs and exact live-check scope are recorded in [docs/verification.md](docs/verification.md); [docs/api-validation.md](docs/api-validation.md) states their precise live scope and transient failures. Do not infer a new final test count from older dated runs.

## Source map and maintenance

```text
src/main.ts                 UI, source status, network/provider tools and polling
src/map.ts                  Leaflet layers and responsive Athens map bounds
src/athens.ts               Shared Athens service area and data filtering
src/preferences.ts          Theme/area preference defaults and storage
public/theme.js             Early saved/system palette before app rendering
src/places.ts               Stop/address autocomplete and private query transport
src/notes.ts                Readable note classes, icons and source details
src/route-presentation.ts   Favorite/operator/service ordering and labels
src/favorites.ts            Bounded per-network local bus-line favorites
src/compact-note.ts         Conservative regex note fragments
src/journey-map.ts          Used ride geometry and transfer-stop extraction
src/vehicle-motion.ts       Bounded display interpolation of accepted GPS fixes
src/vehicle-selection.ts    One-marker-per-bus and current-over-outdated selection
src/planner.ts              Browser earliest-arrival estimator
src/api/                    Original adapters, Passio contracts and transport
src/replication/             Concurrent source coordinator, merge and snapshot store
src/data/athens-crosswalk.json  Reviewed Georgia aliases and evidence hashes
src/data/authorities.json    Reviewed InfoPoint metadata/gateway roots
worker/index.ts             Strict read-only gateway and static asset delegation
wrangler.jsonc              Cloudflare Worker/static configuration
.github/workflows/          Verify-and-deploy action
tests/                      Unit, contract, browser and opt-in live checks
docs/                       Deployment, extraction, replication and evidence
```

These are undocumented application APIs; paths, fields, service and IDs can change. Update the adapters, reviewed allowlist/crosswalk and meaningful regression tests together. `.gitignore` excludes dependencies, builds, secrets, local Cloudflare state, browser outputs, APK inputs and extraction output; the lockfile is tracked.

Map tiles/attribution use [OpenStreetMap](https://www.openstreetmap.org/copyright), subject to its [tile policy](https://operations.osmfoundation.org/policies/tiles/). Leaflet is bundled locally. Manrope is self-hosted under its [SIL Open Font License](public/fonts/OFL.txt). Code is covered by [LICENSE](LICENSE). This is an independent project, not an official transit-operator service.
