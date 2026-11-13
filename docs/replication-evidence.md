# Provider identity and replication evidence

This is a dated identity review, **2026-11-13, approximately 01:31–01:37 UTC**, based on public, read-only operator responses. The committed [crosswalk](../src/data/athens-crosswalk.json) records reviewed aliases and SHA-256 response hashes. IDs, service, and coordinates can change; this is evidence for conservative normalization, not an operator compatibility contract or a claim that replicas are independent measurements.

## Three clients do not cover the same three networks

The official [UGA Transit page](https://tps.uga.edu/transit/) links live tracking at [routes.uga.edu](https://routes.uga.edu/), which serves the Passio GO bootstrap for `acronymId=3994`, `goSubdomain="uga"`. [uga.passiogo.com](https://uga.passiogo.com/) returns the same UGA identity. The county's [transit services page](https://www.accgov.com/1771/Services) links the [Athens-Clarke County InfoPoint](https://bustracker.accgov.com/InfoPoint/). The reviewed InfoPoint authority directory also identifies this as authority `58`.

The Passio page for `acronymId=5842` is **Athens Public Transit, Ohio**, around latitude `39.32`, longitude `-82.10`. Its routes include APT and Ohio University services. It is not Athens-Clarke County, Georgia, around `33.96, -83.37`. A common city name cannot establish a replica relationship.

| Actual operator | UGA portal | InfoPoint authority 58 | Passio system 3994 | Passio system 5842 |
| --- | --- | --- | --- | --- |
| UGA campus, Georgia | 17 catalog routes observed | No campus coverage established | Explicit UGA route groups and variants | Different operator and state |
| Athens-Clarke County, Georgia | 18 city routes observed | Same 18 passenger route identities | No city coverage established | Different operator and state |
| Athens Public Transit, Ohio | No coverage established | Different operator and state | Different operator and state | Correct Ohio operator |

Thus three provider integrations do not create three comparable votes for every Georgia route. Each reviewed Georgia route has two overlapping channels. A source that does not cover that operator abstains; it is not a vote that a route or bus is absent. Passio host mirrors may provide three transport replicas for one system, but their shared backend cannot establish independent agreement about physical bus location. The exact shared current stops and campus route groups strongly suggest common upstream data between the UGA portal and its underlying providers; independence was not established.

## Routes and variants

The UGA catalog returned 35 routes: 17 campus and 18 marked `isAthensBus=true`. Athens InfoPoint returned 20 rows including 18 corresponding passenger routes plus `Deadhead` and `Fireworks Show`. All 18 passenger aliases had the same route number and long name, corroborated by current stop topology. Their reviewed UGA IDs are `1001,1002,1003,1005,1006,1007,1008,1009,1012,1014,1020,1021,1022,1024,1025,1026,1027,1030`; corresponding InfoPoint IDs are explicitly stored in the crosswalk. The application must not generalize an arithmetic rule to unreviewed IDs.

Passio system 3994 supplies explicit `groupId` / `groupRoutes.routeGroupId` values equal to the reviewed UGA campus route IDs. For example, Passio variant `44886` belongs to UGA group `5750` (Central East), `64253` to `5741` (Milledge Night), and `74411` to `6747` (Riverbend). This is stronger than matching similar route names. Campus Riverbend `6747` and county Riverbend `1012` / `12` remain different routes.

All 17 current campus tracking sequences exactly matched one corresponding Passio variant after normalizing an explicitly repeated loop terminal. Two groups also include additional Passio variants: Health Science `5739` has variants `64252` and `74415`; Eastside Limited `5746` has `73969` and `73970`. Only the matching variant maps to the UGA tracking direction. Additional variants remain distinct patterns; collapsing a route group into one stop sequence would invent topology.

## City directions: use ordered stops, not labels

Current UGA city `routeTracking_{id}` responses use `directionId`, while campus tracking and `stop_{id}` responses can use `direction`. Both fields must be parsed. Previously assuming only `direction` merged inbound and outbound stop lists; regression tests now prevent that.

The current UGA city direction names are misleading relative to InfoPoint topology. **UGA `directionId="1"`, labeled “Inbound”, corresponds to InfoPoint `O`; UGA `"0"`, labeled “Outbound”, corresponds to InfoPoint `I`.** This was established by actual ordered stop IDs, not by guessing a numeric convention. The crosswalk preserves the raw source IDs and maps only reviewed aliases.

Of 36 city route/direction pairs, **32 had identical complete stop order** under this mapping. Four differed:

| UGA route / direction | InfoPoint route / direction | Observed sequence sizes | Result |
| --- | --- | --- | --- |
| `1001 / 1` | `1 / O` | 20 vs 25 | Common beginning, different terminal/variant order |
| `1008 / 1` | `8 / O` | 39 vs 43 | UGA order is a subsequence; omitted stops remain a difference |
| `1008 / 0` | `8 / I` | 22 vs 29 | Different variant/order |
| `1025 / 0` | `25 / I` | 29 vs 43 | Different variant/order |

The JSON records both ordered lists and marks these four as `topologyAgreement: "conflict"`; the other 49 reviewed pairs (32 city plus 17 campus) are marked `exact`. Agreement on route identity does not establish agreement on every direction variant. A merge must not combine conflicting stop lists into new directed edges. Preserve a clearly labeled source view for inspection; exclude disputed topology from a corroborated planning graph unless another comparable replica proves it.

## Stops

The review used nested stops from all 35 **current route-tracking responses**, rather than trusting the older CloudFront dataset for alias coordinates.

- **494 city stops** had UGA identity `c{InfoPoint StopId}` and identical current coordinates in both channels. Names matched exactly at 493 stops; the remaining difference was punctuation/spacing. The full source identity, compatible name, route membership, and exact position together establish these reviewed aliases.
- **114 campus stops** had the same current ID and exact coordinates in UGA tracking and Passio topology. Names matched exactly at 111 stops. UGA adds a call-ahead phone annotation to UGArden, Engineering Research and Education Center, and State Botanical Gardens; the base location and source identity remain the same. These differences are retained in the crosswalk's `names` fields.

All 608 reviewed stop aliases are stored explicitly. Missing aliases must retain their source namespace; arbitrary nearby stops can be opposite sides of a road or different terminal bays.

The older static UGA dataset illustrates why proximity cannot be assumed from a shared numeric suffix: `c243` had latitude and longitude both `33.94535`, placing its longitude in the wrong hemisphere; current UGA tracking and InfoPoint agree on `33.945346, -83.371062`. Static `c10549` differed from the current county coordinate by approximately 11 km. Some static campus coordinates also differed by more than 100 m, while their current tracking coordinates matched Passio exactly. The crosswalk uses the current shared coordinates and does not silently average these discrepancies.

## Vehicles and trips

All eight observed campus vehicle IDs matched UGA `id` to Passio **`busId`**, with the same fleet label. For example, UGA `14247`, fleet name `95129`, matched Passio `busId=14247`, `busName="95129"`. Passio `deviceId=430126` is a different identity and must not be used as the fleet ID. The portal and Passio trip IDs differed, so trip correlation was not inferred from route identity or list position.

All 11 observed city vehicle IDs matched UGA `id` to InfoPoint **`VehicleId`**, with the same fleet name. Fleet IDs `122` and `123` are valid examples, as are `746,750,751,753,758,760,765,767,769`. These 19 observed vehicle aliases are explicitly recorded; no blanket namespace rule is inferred for unseen vehicles.

Identity is separate from agreement about a field. Across the initial closely timed snapshots, some corresponding city positions were within 0–73 m, but others differed by 142–361 m and headings changed. Vehicle `760` had UGA route `1014` versus InfoPoint route `12`, despite positions about 43 m apart. It remains the same fleet identity, but route assignment is a conflict. A merger must preserve that disagreement rather than manufacture a combined route/position record. UGA `tripId` uses a GTFS-style string such as `t7DF-bC9-sl2`; InfoPoint's vehicle `TripId` is a numeric internal ID. InfoPoint departure `Trip.GtfsTripId`, when present, is a potentially comparable field; the internal numeric ID is not interchangeable.

UGA and InfoPoint provide absolute vehicle update timestamps. The observed Passio bus payload also contained display times such as `08:33 PM`, which alone do not prove a date, timezone offset, or absolute measurement time. Retrieval time must remain distinct from measurement time, and a successful request is not proof that the GPS report is fresh.

## Conservative merge checks

These are implementation review criteria; the running merge's actual thresholds and fallback behavior are defined by its code and tests.

1. Establish operator, route/variant, directed stop, and vehicle identity before comparing values. A nearest bus, similar route name, same numeric ID from another operator, or common city name is insufficient.
2. Treat each field separately. Suggested initial agreement bounds are 100 m for corresponding fresh vehicle positions, circular heading difference at most 45°, and 90 seconds for comparable arrival predictions. These are declared tolerances, not guarantees of transit accuracy.
3. ETA comparison requires the same canonical stop, route, direction and run where run identity exists. Predicted arrival, scheduled arrival, and departure after dwell are distinct fields; two values for different trips are not corroboration.
4. Preserve original timestamps and provenance. A local cache hit or request time must not make an old GPS report fresh. Reject future/impossible measurement times and identify unknown freshness explicitly.
5. For topology, compare full directed stop order and loop closure within a matched variant. A stop set or unordered nearest-stop match does not prove ride order. Trace vertex density can differ even for equivalent paths, so geometry selection requires its own policy.
6. Use an agreeing pair only within a valid comparison group. Keep a concrete source observation and its provenance rather than averaging conflicting coordinates, times, headings or route assignments. Threshold agreement is not transitive: A↔B and B↔C do not imply A↔C.
7. Mark single-source fallback, conflict and missing coverage. A common-backend mirror majority is transport corroboration, not independent confirmation of the bus's true location.

## Reproduction and verification

Representative unauthenticated requests (all returned HTTP 200 during the review):

```sh
curl -fsS 'https://my.uga.edu/v4_19/cache/Routes'
curl -fsS 'https://my.uga.edu/v4_19/cache/Buses'
curl -fsS 'https://my.uga.edu/v4_19/cache/routeTracking_1001'
curl -fsS 'https://my.uga.edu/v4_19/cache/routeTracking_5750'
curl -fsS 'https://bustracker.accgov.com/InfoPoint/rest/Routes/GetAllRoutes'
curl -fsS 'https://bustracker.accgov.com/InfoPoint/rest/RouteDetails/GetAllRouteDetails'
curl -fsS 'https://bustracker.accgov.com/InfoPoint/rest/Stops/GetAllStops'
curl -fsS 'https://passiogo.com/mapGetData.php?getRoutes=1' \
  -H 'Content-Type: application/json' --data '{"systemSelected0":"3994","amount":1}'
curl -fsS 'https://passiogo.com/mapGetData.php?getStops=2&withOutdated=1&wBounds=1&showBusInOos=0' \
  -H 'Content-Type: application/json' --data '{"s0":"3994","sA":1}'
curl -fsS 'https://passiogo.com/mapGetData.php?getBuses=1&speed=1' \
  -H 'Content-Type: application/json' --data '{"s0":"3994","sA":1}'
```

The Passio POST actions above are read-only data queries. No login, bearer token, embedded map key, account write, or tracking-device identifier was needed. All 35 UGA tracking endpoints were queried with concurrency four. Source hashes in the JSON identify the observed raw responses; hashes are identity evidence, not an archive from which the entire response can be recovered. Raw driver names and unrelated provider configuration were not committed.

```sh
npx vitest run tests/crosswalk.test.ts tests/api.test.ts
npm run typecheck
```

The crosswalk suite checks provider/operator boundaries, reviewed source-ID uniqueness, known name collisions, all 608 stop aliases, direction-order agreement and conflicts, additional variants, fleet versus device identities, evidence hashes, and the actual UGA `directionId` regression. Deterministic tests validate this captured evidence and the transformations; they do not prove future provider availability or current physical bus positions.
