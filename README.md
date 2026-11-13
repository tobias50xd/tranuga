# tranuga

A static bus explorer and quickest-trip estimator, deployed with GitHub Actions to Cloudflare Workers Static Assets. The browser lists routes, maps current stops and reported bus positions/headings, and computes directed bus journeys between named stops, addresses, map points or your location. Its visual design is original; APK layouts, artwork, assets and embedded keys are not build inputs.

## Use the app

- **Routes:** browse every returned route with active service first and a light green tint; unavailable and unconfirmed service appears grey with a text label. Search names/numbers, filter service, and select a route for its road trace, stops, direction variants, bus headings and observation ages. Select a stop for arrivals or to start a journey there.
- **Plan a trip:** type a stop, place or address, then select an autocomplete hint with the pointer or arrow keys and Enter. You can also pick either point on the map, choose **My location** for the start, or enter decimal `latitude, longitude`. Editing a selected name clears its previous coordinates until you select again. Swap points, choose the access/egress walking limit, and get a bus-and-walk itinerary with waits, transfers and explicit timing assumptions.
- **Data reliability:** inspect responding sources, disagreements and saved-backup state. **Sync all sources** crawls the selected network's full route/stop/prediction data. One responding source can provide a labeled fallback; compatible reports from two replicas take precedence over an outlier.
- **Provider tools:** where Passio supplies them, open provider information/version/route groups, search for a specific bus, view a stop's provider timetable, or explicitly request a separate provider journey comparison.
- **Networks:** use the combined Georgia network, UGA's Passio network, the requested Athens Public Transit network in Ohio, or a reviewed InfoPoint agency. Search the directory, locate a nearby agency, or enter an authority code.

All clock times use the device timezone except provider timetable clock labels, which retain the operator's stated IANA timezone. Missing dates, route identities and durations remain unknown rather than being invented.

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

Notes use a consistent line icon, a short title, a plain-language explanation and, when needed, expandable **Source details** containing the original provider/diagnostic text. Repeated technical warnings of the same class share a card; distinct operator alerts remain distinct and retain their full wording. Error messages appear before warnings, then informational notes. Text labels convey meaning alongside color; icons are decorative to screen readers.

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

Informational cards use a quiet green tone, warnings amber, and action/request errors red with `role="alert"`. The mapping lives in [notes.ts](src/notes.ts); it organizes messages for display without changing source status, service availability or planner decisions. Operator alert text is escaped and never rendered as HTML. Service cards sort confirmed active routes first, then unconfirmed, then inactive; route numbers sort naturally within each group. Grey cards remain available for viewing route details, while the planner uses only eligible active service.

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

The browser coordinator fetches configured sources concurrently, validates normalized responses, merges reviewed identities and saves bounded last-good **public transit** snapshots. It uses pairwise-compatible groups, not transitive proximity chains. At most one row per source can vote. Fresh data takes precedence over saved snapshots; a cached majority cannot outvote a fresh survivor. Selected values remain concrete source observations, with source/native-ID provenance and original timestamps—coordinates, headings and arrival times are not averaged.

| Comparison | Rule |
| --- | --- |
| Vehicle agreement | Same reviewed fleet/route identity; position ≤100 m, circular heading difference ≤45°, measurement timestamps within 60 s. A vote needs an original measurement no older than 120 s and no more than 60 s in the future. Unknown-age/stale positions cannot vote. |
| Stop agreement | Reviewed identity and position within 50 m; a nearby unreviewed stop stays separate. |
| ETA/EDT agreement | Comparable stop/route/direction/run, each arrival and boarding/departure difference ≤90 s. Ambiguous unidentified predictions abstain in both directions. A known run's outlier remains disagreement on one departure, not an extra bus. |
| Topology agreement | Complete ordered canonical stop sequence and compatible loop evidence. Unknown closure abstains; conflicting known closure without a majority excludes that pattern from planning. Extra variants stay separate. |
| Current service | UGA current-service flags differ from InfoPoint/Passio publication flags. Visibility does not outvote current inactivity. A publication-only route enters planning only with a fresh vehicle or credible nonscheduled ETA carrying an original update time ≤180 s. |

The source bar reports health and corroborated/single-source/conflict/saved-backup states. Replica agreement can share one underlying error; it does not guarantee that a bus exists at the displayed coordinate.

| Layer/work | Retention and trigger |
| --- | --- |
| Client request cache | Coalesced identical requests; 15 s default, 15 s timeout; endpoint-specific longer TTLs. |
| Last-good snapshots | Browser localStorage key `tranuga.transit-replicas.v1`; at most 64 resource slots, a 2,000,000-character serialized persistence cap, and 24 h maximum static snapshot age. Unavailable/full storage falls back to memory. |
| Saved live eligibility | Cached active flags/predictions expire after 2 min; cached positions can remain visible for at most 5 min; original measurement age still controls current-service eligibility. Original measurement times and selected `snapshotAt` survive nested replication. Static retention does not authorize stale service. |
| Visible-tab lightweight crawl | Every 60 s: catalogs, vehicles and alerts. Hidden tabs and overlapping crawls are skipped. |
| Open-route positions | Every 15 s while visible; overlapping polls are skipped. |
| Full network crawl | **Sync all sources** or planning; Each adapter caps UGA tracking/InfoPoint departures or Passio ETA batches at four concurrent requests; each Passio batch has at most 40 stops. The three mirror adapters run concurrently. |
| Edge response cache | Most live reads 10 s; Passio catalog 60 s; static/config/directory/topology/KML/provider metadata/timetable 1 h. Full per-layer policy is in [feature.md](feature.md). |

There is no server cron or crawl while the browser is closed. Local trip planning runs on the device. **Request provider comparison** explicitly forwards the two selected points to Passio; that request bypasses client/edge caches and localStorage snapshots, and coordinate bodies are not written to the request log. Geolocation otherwise runs only after the user requests it; nearby-network lookup also explicitly forwards a coordinate to discovery. No account, analytics SDK or continuous location tracking is implemented. Public map tiles still make ordinary requests to OpenStreetMap.

## How quickest-trip estimation works

[src/planner.ts](src/planner.ts) runs a time-dependent earliest-arrival search with a binary heap and nondominated arrival/transfer/walking labels. It considers **all** reachable boarding and alighting stops, directed rides, same-stop/walking transfers, catchable predicted runs and modeled following service. It requires at least one bus ride. Remaining on a bus does not add a second boarding wait; confirmed loops can wrap once. Disputed topology and unconfirmed current service cannot supply planning edges.

| Parameter | Default |
| --- | --- |
| Walking speed | 1.3 m/s; straight-line distances |
| Access/egress walk | 1,200 m each; UI offers 800 / 1,200 / 2,000 m |
| Transfer walk | 300 m; walks cannot chain to bypass access limits |
| Estimated bus movement | 5.6 m/s plus 20 s per stop |
| Estimated following service | 450 s after readiness or latest known departure, whichever is later |
| Transfer buffer | 45 s |
| Prediction age / search horizon | 180 s / 3 h |

Consistent route geometry estimates bus distance; otherwise stop distances are multiplied by 1.25. Actual run identity can anchor downstream arrivals and intermediate dwell. UGA stop prediction arrays do not identify every run, so matching array positions never prove the same bus. Expired/impossible predictions, old original update times and stale network snapshots are ignored. Tests compare the search with an independent exhaustive-path oracle on 40 generated networks.

The result is **quickest within this declared model**, with `estimated` or `live-assisted` confidence and visible assumptions. The feeds do not provide complete guaranteed timetables, a pedestrian street graph or accessible-path data. Provider timetable labels do not supply dates. Operator journey comparisons are separate suggestions, use only explicit numeric timing, exclude driving alternatives and do not become a quorum proof of the local algorithm. Walking lines and journey stop connectors are schematic; route-detail maps show supplied road traces/segments.

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
| [ui.test.ts](tests/ui.test.ts), [presentation.test.ts](tests/presentation.test.ts), [browser tests](tests/e2e/app.spec.ts) | Rendering helpers, service ordering, note classes, place normalization/cache/privacy and desktop/mobile workflows, selection/race guards and failures. |

Provider probes are opt-in:

```sh
LIVE_TRANSIT=1 npx vitest run tests/api-live.test.ts
LIVE_PASSIO=1 npx vitest run tests/passio.test.ts
```

The November 13 UI refactor acceptance run passed **385 deterministic tests and 50 browser tests**, plus TypeScript, production build and Wrangler dry run. It used an isolated checkout to preserve concurrent planner edits in the shared workspace. Executed historical runs and exact live-check scope are recorded in [docs/verification.md](docs/verification.md); [docs/api-validation.md](docs/api-validation.md) states their precise live scope and transient failures. Do not infer a new final test count from older dated runs.

## Source map and maintenance

```text
src/main.ts                 UI, source status, network/provider tools and polling
src/map.ts                  Leaflet route, stop, bus and journey layers
src/places.ts               Stop/address autocomplete and private query transport
src/notes.ts                Readable note classes, icons and source details
src/route-presentation.ts   Confirmed service ordering and labels
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
