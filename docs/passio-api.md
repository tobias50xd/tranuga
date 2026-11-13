# Passio GO! API extraction and adapter

Validated **2026-11-13 UTC**, starting around 01:31 UTC, using public website scripts, a browser request capture, direct unauthenticated queries, and live adapter tests. These are observed application endpoints rather than a published compatibility contract.

## Two different places named Athens

The requested [athenstransit.passiogo.com](https://athenstransit.passiogo.com/) website selects Passio system **5842**, **Athens Public Transit in Ohio**. Its observed route center was approximately `39.33638, -82.12585`. Its routes include APT Line 3, Courtyard and OWL Summit. This is geographically separate from Athens-Clarke County and UGA in Georgia, around `33.95, -83.37`.

The official [UGA transit website](https://tps.uga.edu/transit/) links to [routes.uga.edu](https://routes.uga.edu/). That page and [uga.passiogo.com](https://uga.passiogo.com/) select Passio system **3994**, **University of Georgia**. This supplies a real UGA counterpart to the UGA portal feed; the Ohio feed cannot corroborate Georgia routes or positions.

The application exposes both as explicit networks. Ohio IDs are never treated as aliases of Georgia IDs merely because an agency name includes “Athens.”

## Extraction evidence

The Athens site's HTML bootstrap declared `acronymId=5842`. The UGA sites declared `acronymId=3994`. The inspected public [index.js](https://athenstransit.passiogo.com/index.js?1787294759) defined the route, topology, vehicle, ETA, schedule and alert requests. Its `myServer()` resolver used `https://passiogo.com/` for agency sites. Request capture confirmed the native methods, query flags and payloads.

The native website wraps JSON in a form field named `json`, using `application/x-www-form-urlencoded; charset=UTF-8`. Direct probes confirmed that the read queries below also accept a raw `application/json` body where they use POST. tranuga uses the simpler, strictly validated JSON form for POST requests.

No login, API key, device registration, push token, cookie, third-party map key, or user location is required for these queries. The native site's optional device/push registration, authentication, ride-request and notification actions are excluded from this adapter. No Passio page layout, image asset or visual design is imported.

## Validated backend mirrors

All five core read queries succeeded on each of these HTTPS origins for both allowed system IDs:

| Node | Origin | Evidence |
| --- | --- | --- |
| Primary | `https://passiogo.com` | Catalog, topology, vehicles, messages and complete served-stop ETA batches passed live adapter checks. |
| Replica 2 | `https://replicated2of3.passiogo.com` | Same contracts passed. Ohio catalog and topology matched the primary's route/stop structure; live vehicle values changed between reads. |
| Replica 3 | `https://replicated3of3.passiogo.com` | Same contracts passed, including full network loading. |

These are **backend mirrors of the same Passio provider**, not three independent transit operators. A two-of-three agreement can establish agreement among these replicas, subject to comparison rules and freshness checks. It does not establish independent measurements or guarantee that the underlying operator data is correct. Replicas can all expose the same source error or stale data. Sequential requests can legitimately differ while a bus moves or an ETA is recalculated.

The domain adapter represents one selected mirror. The application composes replication and fallback above it; it does not hide per-node retries inside normalization. [passio-endpoints.ts](../src/api/passio-endpoints.ts) restricts origins to the three observed hosts and system IDs to `5842` and `3994`. Runtime metadata cannot introduce a new upstream origin.

## Five core read queries

`{origin}` is one of the fixed origins above. `{systemId}` is the string `5842` or `3994`. All responses were JSON, although the upstream commonly labeled them `text/html; charset=UTF-8`. The gateway validates JSON and supplies an appropriate downstream content type.

### 1. Route catalog

```http
POST {origin}/mapGetData.php?getRoutes=1
Content-Type: application/json

{"systemSelected0":"5842","amount":1}
```

Observed response: a JSON array of route variant objects. Relevant fields include `myid`, `groupId`, `name`, `shortName`, `color`, `userId`, `mapApp`, `archive`, `outdated`, and `timezone`.

- **`myid` is the route variant ID.** The field named `id` in this response was a representative stop ID, not a route ID.
- For UGA system `3994`, `groupId` supplies a proven relationship to canonical UGA portal route IDs. For example, variant `44886` belonged to group `5750` (Central East); variants `73969` and `73970` belonged to group `5746` (Eastside Limited).
- The adapter groups UGA catalog variants by this explicit group ID, with the group active if any constituent variant is active. It preserves individual variants in route patterns.
- Ohio variants remain separately addressable. They are not merged into a Georgia route namespace.
- The adapter's `active` field reflects the publication flags: not archived, not outdated, and enabled in the map app. Every Passio catalog route is explicitly marked `availability: 'published'`; these flags do not establish current operation and abstain from votes about current service. Planning eligibility requires separate credible current evidence, rather than publication alone.

The initial snapshot had **20 Ohio variants** and **24 UGA variants in 20 UGA groups**. These are observations, not hardcoded application counts.

### 2. Stops, ordered patterns and road geometry

```http
POST {origin}/mapGetData.php?getStops=2&withOutdated=1&wBounds=1&showBusInOos=0
Content-Type: application/json

{"s0":"5842","sA":1}
```

Observed top-level fields: `stops`, `routes`, `routePoints`, `groupRoutes`, `routeShortNames`, `routeSchedules`, `routesRR`, `excludedRoutesID`, `stopsRR`, and `center`.

- `stops` is keyed by values such as `ID190923`; stop objects carry `stopId`, `name`, coordinates and `userId`.
- `routes[variantId]` is a compact array: `[name, color, outdated, [sequence, stopId, returnVisit], ...]`. Sequence values define order. Return visits and repeated interior stops remain in the pattern. A repeated terminal proves loop closure; without it, closure is unknown rather than a proven non-loop. The marker-only stop set is deduplicated separately.
- `groupRoutes[systemId][variantId]` supplies the group relationship used for UGA route identity.
- `routePoints[variantId]` contains **separate geometry segments**, generally arrays of `{lat,lng}` points. Public script support also exists for encoded-polyline strings inside segments. The adapter preserves segments and does not draw a fabricated road connection between disconnected pieces.
- A pattern referencing a stop with missing or invalid coordinates is excluded rather than connecting the surrounding stops across an unknown gap.
- `center` contains map center/bounds metadata. The application's fixed network centers keep Ohio and Georgia distinct.

The initial Ohio topology contained **115 stops**. One observed variant, `63701`, had an empty road trace. Such routes retain their ordered stops and a warning; approximate stop connectors are labeled. Route stops and trace data are cached for five minutes in the browser.

### 3. Vehicle positions

```http
POST {origin}/mapGetData.php?getBuses=1&speed=1
Content-Type: application/json

{"s0":"5842","sA":1}
```

Observed response: `{buses, excludedRoutes, time, debug}`. `buses` is keyed by a device identifier; each value is an array whose first entry is the current reported bus row.

Relevant fields include `busId`, `busName`, `userId`, `routeId`, `tripId`, `latitude`, `longitude`, `calculatedCourse`, `course`, `outOfService`, `outdated`, `created`, `createdTime`, and sometimes `speed` or occupancy values.

The adapter uses the public **bus ID**, not the device key, for vehicle identity. UGA bus IDs such as `14247` were also present in the UGA portal feed; route variants map through explicit UGA group membership. Reported heading is normalized into `0 ≤ heading < 360`. Out-of-service rows and invalid coordinates are excluded.

The checked vehicle rows contained a **local 12-hour clock label without an absolute date or offset**. Neither that label nor the fetch time proves GPS freshness. The adapter therefore leaves the absolute update timestamp unknown for these rows, and the UI warns about unknown freshness. A newly fetched response is not relabeled as a newly measured vehicle position.

`speed` values were present inconsistently, and their unit was not established by the checked contract. The adapter does not invent a conversion or use them as a guaranteed routing speed. Raw occupancy fields are documented as potential future features and are not used to claim capacity availability.

The public script also supports `getBuses=2` for later polls and an optional search query. The implemented adapter uses the validated initial/full query consistently; the gateway accepts only its reviewed read schemas.

### 4. Stop arrival predictions

```http
GET {origin}/mapGetData.php?eta=3&stopIds=190923%2C190985&userId=5842
```

Observed response: `{ETAs, time, ...timing/debug fields}`. `ETAs` maps each stop ID to an array of predictions. Comma-separated stop IDs were confirmed live. The adapter batches **at most 40 stop IDs**, with at most four simultaneous batches. Each planning search loads predictions for stops served by the active directed network; route views load their served stops and a selected stop can be refreshed separately.

Two observed response forms are normalized:

| Form | Relevant fields | Conversion |
| --- | --- | --- |
| Live prediction row | `arrivalTimestamp` / `etaUtc`, `routeId`, `routeGroupId`, `busId`, `tripId`, `theStop`, `outdated`, `outOfService` / `OOS` | `arrivalTimestamp` and `etaUtc` were **Unix epoch seconds**, converted to milliseconds. Explicit route/run identities are preserved. |
| Solid prediction | `solidEta.arrivalUtc`, `updatedUtc`, `routeId`, `routeGroupId`, `busId`, `tripId`, `scheduledArrivalUtc`, `scheduledDepartureUtc` | Fields ending in `Utc` explicitly establish UTC despite values such as `2026-11-13 01:47:00` omitting a `Z`. The adapter converts these to absolute UTC milliseconds. |

Route-specific requests were also confirmed:

```http
GET {origin}/mapGetData.php?eta=3&stopIds=190923&routeId=66949&userId=5842
```

The native script can add `position={sequence}` to distinguish visits. The adapter's batch mode does not request historical timeline, debug or forced-ETA variants. It does not turn a relative label such as “14 min” or an unqualified local clock string into a fabricated absolute prediction.

UGA departures use canonical group route IDs and keep the raw variant as `direction`, so two variants in one group are never interleaved into one stop sequence. `tripId` and `vehicleId` can connect downstream predictions from the same run. Explicit `solidEta.updatedUtc` or prediction-row `updatedUtc` is preserved as `Departure.updatedAt` and takes precedence over local fields.

The raw batch form also contains a complete local `created` date/time. This is converted only with that exact variant's explicit, validated catalog IANA timezone. Both checked catalogs specified `America/New_York`. Concurrent live checks at 02:25:13–14 UTC compared five matching UGA bus/trip identities: the converted Passio observation times differed from the corresponding UGA portal `lastUpdate` by −2.316 to +2.684 seconds. The sanitized [timestamp evidence fixture](../tests/fixtures/passio-extras.json) preserves those exact inputs for regression tests. Conversion uses `Intl` round trips and accepts exactly one matching instant; ambiguous fall-back times, nonexistent spring-forward times, invalid dates and missing zones remain unknown. It never assumes an unqualified date is UTC or substitutes request time. Clock-only vehicle labels remain unknown and are never stamped from a different ETA row.

`scheduledDepartureUtc` is timetable metadata, not proof of a live departure or dwell interval. It is **not** assigned to `departureTime`. No actual departure timestamp was established in the recovered contract, so that field stays absent for Passio predictions. Out-of-service, outdated and explicit error predictions are excluded.

### 5. Public service messages

```http
POST {origin}/goServices.php?getAlertMessages=1&alertCRC=na&noOptions=1
Content-Type: application/json

{"systemSelected0":"5842","amount":1,"routesAmount":0}
```

Observed response: `{error, msgs, debug, alertCRC}`. Public message entries can contain `name`, `html`, route/group IDs, archive/importance flags, validity flags, dates and GTFS alert fields.

The adapter uses plain message text from `name` or an alert-header fallback, filters agency/archive/validity flags, and deduplicates text. It does not render provider HTML or persist author/contact fields. `noOptions=1` requests messages without the native client's broader UI/account-option payload. Service messages are loaded on route views and planning, with a one-minute client cache.

## Six additional read queries used by the application

These were found in public scripts or browser capture and are implemented as provider information, bus lookup, a timetable view, and an operator journey comparison. They complement the five core queries above rather than changing the independent planner's result.

| Method and path | Evidence and purpose | Runtime use |
| --- | --- | --- |
| `GET {origin}/mapGetData.php?getSystems=2&sortMode=1&credentials=1&acronymId={systemId}` | HTTP 200 probe and native request capture; `{all, lat, lng, IPcoords, debug}` agency metadata/directory response. `credentials=1` is a query selector, not an authorization header. The same query worked on all three fixed origins without credentials. | `getSystemInfo()` selects the verified agency record and exposes its name; it does not expose unrelated directory contacts or requester IP/location metadata. |
| `GET {origin}/goServices.php?goWebVer=1` | HTTP 200 and native capture; `{ver:110}` during validation. This is the website software version, not the transit dataset version. | `getSystemInfo()` exposes the provider software version. |
| `POST {origin}/mapGetData.php?getRoutes=2&sortMode=1&credentials=1` with `{"systemSelected0":"5842","amount":1}` | HTTP 200 and native capture; `{all:[...]}` grouped route chooser with route/stops-count metadata. | `getSystemInfo()` exposes actual provider route groups, representative variants, names, colors and supplied stop counts. |
| `GET {origin}/mapGetData.php?schedule=4&routeId=66949&stopId=190923` | HTTP 200 probe and script evidence; route/stop timetable object with `timepoints.past` / `timepoints.next` clock labels. | `getTimetable(stopId, routeId?)` selects an actual variant serving the stop and displays next scheduled clock labels with the catalog's IANA timezone. It does not invent dates or confuse schedule labels with live predictions. |
| `POST {origin}/mapGetData.php?getBuses=2&search=2100` with `{"s0":"5842","sA":1}` | HTTP 200 probe and script evidence; public bus-search result plus normal vehicle data. | `searchBuses(query)` returns only the explicitly identified found bus. An empty result remains empty. Queries accept up to 40 letters, digits, spaces, underscores or hyphens. |
| `POST {origin}/mapGetData.php?walk=2` | HTTP 200 probe and script evidence; `{bestPath, paths, paths2}` navigation alternatives. Exact checked payload below. HTTP success does not guarantee a usable route. | `compareJourney(from, to)` returns the operator's separate bus-and-walk alternatives. It preserves explicit stop IDs and duration values; driving/third-party alternatives are excluded. |

The checked native navigation payload used two public Ohio stop coordinates, not a user's location:

```json
{
  "systems": {"systemSelected0": "5842", "amount": 1},
  "routes": {"amount": 0},
  "points": [
    {"lat": 39.295665, "lng": -82.11205},
    {"lat": 39.325428, "lng": -82.101967}
  ],
  "mode": "transit"
}
```

The exact host is selected from the three reviewed origins, and the agency is restricted to `5842` or `3994`. The native agency-host directory URL also worked; the application uses the fixed mirror hosts consistently. All six additional read queries in this table returned HTTP 200 over HTTPS during validation.

`compareJourney` sends the selected coordinates only when explicitly invoked. Its request is not cached by the browser client, its coordinates/body are not stored in the client's request log, and the gateway bypasses edge caching for this query. The client can log ordinary URL/method/status metadata. The returned comparison contains normalized stop/route labels and reported timing, not the submitted coordinates or provider HTML. The local planner remains separate: the application does not average its result with the operator's result or treat operator alternatives as a three-provider vote.

Only explicit numeric `duration.value` fields are used for comparison timing. The adapter sums a complete set of leg durations, or a complete set of step durations when leg totals are absent; otherwise total duration stays unknown. It does not parse a string such as “~0.1h” into a made-up numeric total. The observed native alternative supplied a 360-second numeric transit step and boarding/alighting stop IDs, but no actual route ID; the missing route identity remains absent. Third-party driving alternatives in `paths2` are not eligible bus journeys.

Native scripts append optional device IDs, build numbers, location coordinates, CRC hints and debug/timeline selectors. The minimal requests above demonstrate that these are unnecessary for the implemented public transit queries. Authentication, mobile login, feedback, ride-request, push registration and subscription calls are outside this read-only transit integration and are not enabled in the gateway.

## Reproduce a read-only request

This example uses the Ohio agency; replace `5842` with `3994` for UGA:

```sh
curl --fail --silent --show-error \
  --header 'Content-Type: application/json' \
  --data '{"systemSelected0":"5842","amount":1}' \
  'https://passiogo.com/mapGetData.php?getRoutes=1'
```

No cookies or secret headers are required. Use one of the fixed mirror origins to compare the same query. Polling frequently does not make upstream position timestamps newer.

## Implementation and tests

- [passio.ts](../src/api/passio.ts) normalizes the contracts and exposes catalog/route/stop/network/vehicle/message operations plus `getSystemInfo`, `searchBuses`, `getTimetable` and `compareJourney`.
- [passio-endpoints.ts](../src/api/passio-endpoints.ts) centralizes reviewed origins, agencies, exact query strings and payloads.
- [passio.test.ts](../tests/passio.test.ts) uses sanitized, bounded real-contract fixtures for Ohio and UGA. Fixtures exclude authors, contact information, application keys, design assets and unrelated account configuration.

Deterministic verification:

```sh
npx vitest run tests/passio.test.ts
npm run typecheck
```

**24 deterministic tests passed** during implementation. They cover all eleven used read-query patterns, all three mirror origins, agency separation, correct route identity, group/variant preservation, return visits/loops, disconnected geometry, invalid-stop exclusion, headings, unknown vehicle timestamps, epoch-second/UTC ETA parsing, messages, safe batching, transport payloads and partial-outage warnings. Additional feature checks prove selected-agency metadata/version/groups, explicit bus-search matches, variant-specific timetable labels/timezone, bus-and-walk-only operator alternatives, unknown durations/identities, coordinate validation and uncached comparison requests without coordinates in the client log. Freshness tests preserve original UTC or proven catalog-zone observation times, reject DST gaps/folds and missing-zone guesses, and prove that scheduled departures never become live dwell.

Explicit live verification:

```sh
LIVE_PASSIO=1 npx vitest run tests/passio.test.ts
```

At 01:41 UTC on 2026-11-13, the initial core-feed suite passed **all six live cases**: three origins × two agency IDs, including full served-stop prediction batches. That initial run had 16 deterministic cases plus six live cases, all passing in 9.80 seconds.

The expanded live cases additionally exercise provider metadata, version, groups, bus search, timetable and operator comparison. At 01:53 UTC, four expanded cases passed; UGA selected-stop ETA requests on replica 2 and replica 3 returned HTTP 403. Immediate direct checks of those exact URLs returned HTTP 200. A targeted repeat of the two affected complete expanded cases passed at 01:55 UTC (**2 passed in 4.32 seconds**). All six expanded cases have therefore passed against their mirror/agency pairs, with intermittent provider rejection recorded rather than hidden. This evidence does not promise that a fresh live run will succeed continuously.

Live tests are skipped by default so ordinary CI does not depend on external transit servers. Each enabled case checks catalog, route map data, stop predictions, the complete active planning network and all four additional feature methods. No test changes a failed request into a successful one or silently substitutes a different host.

This proves observed behavior at that validation time. It does not prove continuous availability, future schema stability, fresh GPS timestamps, independent operator consensus, a guaranteed timetable, or a production deployment. See the repository README and replication documentation for application-level source selection, quorum comparison and fallback behavior.
