# Replication and saved fallback

The application coordinates public transit sources in the browser. [service.ts](../src/replication/service.ts) performs concurrent source reads and schema validation; [merge.ts](../src/replication/merge.ts) reconciles reviewed identities; [store.ts](../src/replication/store.ts) retains bounded last-good snapshots. This is transport/data redundancy, not independent proof of a bus's physical state.

## Scope before comparison

| Selected network | Configured coordinator |
| --- | --- |
| Combined UGA + Athens, Georgia | UGA portal, Athens-Clarke County InfoPoint authority `58`, and a nested three-node UGA Passio `3994` coordinator. |
| UGA Passio `3994` | Primary, replica 2 and replica 3 for the same UGA system. |
| Athens Public Transit, Ohio `5842` | The same three fixed nodes, scoped to the Ohio system. |
| Another reviewed InfoPoint agency | Its selected feed, with saved fallback; no Georgia alias merge. |

The fixed nodes are `https://passiogo.com`, `https://replicated2of3.passiogo.com` and `https://replicated3of3.passiogo.com`. Ohio `5842` and Georgia `3994` use separate agency IDs, source scopes, map centers and snapshot keys. The [factory](../src/replication/index.ts) does not add Ohio or CATA as a vote for Georgia.

[athens-crosswalk.json](../src/data/athens-crosswalk.json) explicitly maps 35 reviewed routes, 608 stops and 19 observed fleet identities. Georgia campus UGA↔Passio and county UGA↔InfoPoint overlaps each supply at most two provider channels. Passio's three mirror responses become one provider contribution in the outer Georgia merge. Common upstream data is likely; neither mirror nor provider agreement establishes independent sensor measurements. [The evidence review](replication-evidence.md) records exact coverage and limits.

Unreviewed IDs retain source namespaces. Similar route names, nearest coordinates, equal numeric suffixes or the shared word “Athens” do not establish identity. Passio route `myid` is a variant; explicit `groupId` establishes UGA group membership. Additional variants retain their own ordered patterns.

## Crawling and health

The UI starts with the catalog and loads route/stop data on demand. **Sync all sources** performs a full selected-network crawl; a planner search also loads the current planning network. Adapters are called concurrently, with each adapter's internal fan-out capped at four requests for UGA tracking or InfoPoint departures and four Passio ETA batches of at most 40 stops. The three Passio mirror adapters run concurrently, so this is not a global four-request limit. It does not crawl every directory agency.

While the tab is visible, a lightweight 60-second crawl requests catalogs, vehicles and public messages. An open route refreshes positions every 15 seconds. Overlapping work and hidden-tab polls are skipped. There is **no server cron or browser-closed crawler**. Static topology/configuration and live requests still honor their endpoint cache TTLs.

Each result must pass normalized schema guards, including optional loop/timestamp/provenance fields. An invalid response is a source failure, not a successful empty substitute. Identical in-flight operations coalesce. On failure the coordinator tries that resource's validated saved response; if no configured source supplies fresh or valid saved data, the operation fails visibly.

Whole-source reads have a 30-second coordinator deadline; Passio backend reads use 20 seconds so the nested coordinator can return surviving mirrors before the outer deadline. A stalled source cannot indefinitely hold healthy responses. Its confirmed in-flight crawl is reused while still running, rather than restarted; a later validated completion can populate a last-good snapshot. A full network snapshot can also restore catalog, route and stop views when smaller resource entries have been evicted.

Source health distinguishes responding, partly available, saved-backup and unavailable states. Recent resource failures are retained rather than erased by a successful unrelated call. UGA's local empty-message placeholder does not count as evidence that its remote endpoints recovered. The source bar exposes errors, partial backend counts and the most recent merge's matching/disagreement/saved-record counts. A responding HTTP server can still return stale or inconsistent transit data.

## Selection and agreement

For each canonical entity, a source contributes at most one vote. The merger searches **pairwise-compatible groups**: A agreeing with B and B with C does not imply A agrees with C. A compatible pair or triple takes precedence over an outlier. Without such a group, the configured preferred surviving source supplies an explicitly labeled single-source/conflicting fallback.

Fresh observations outrank saved values, including nested coordinator results that already came from saved data. For vehicles, actual fresh measurement times take precedence over unknown/stale measurement times; among fresh measurements the newer report is preferred, then configured priority. A cached majority cannot outvote a fresh survivor.

Selected coordinates, headings and timing remain a **concrete source observation**. Values are never averaged into a location, time or heading that no source reported. All source/native-ID references remain available, including disagreeing and cached inputs. The selected record's `snapshotAt` remains separate from the full provenance list; a more recent disagreeing reference does not make an older selected body fresh.

| Entity/field | Comparison and eligibility |
| --- | --- |
| Route current state | Explicit current-service reports decide current operation. InfoPoint visibility and Passio archive/outdated/map flags are publication metadata and abstain from voting against current-service reports. |
| Stop position | Reviewed stop identity, at most 50 m between reports. Nearby unreviewed stops remain separate. |
| Vehicle report | Same canonical fleet and route; at most 100 m position difference, at most 45° circular heading difference, and original measurement times within 60 seconds. A voting measurement must be no older than 120 seconds and no more than 60 seconds in the future. Unknown/stale/future measurements cannot create a quorum. |
| Arrival/boarding | Same canonical stop/route/direction and comparable run identity where available; arrival differences at most 90 seconds and departure/boarding differences at most 90 seconds. Known original prediction updates older than 180 seconds or more than 60 seconds in the future are excluded. |
| Directed pattern | Entire ordered canonical stop sequence, with loop evidence treated separately. A shared stop set or spatially similar trace does not prove order. |
| Loop closure | Unknown closure abstains. Known consistent evidence is preserved; two known opposing values without a majority mark the pattern disputed. An unknown third record cannot break that tie. |

### Predicted runs and ambiguity

A proved common trip ID identifies one run even if one replica's ETA is far outside tolerance. That outlier remains a disagreement on one departure rather than becoming an extra bus. A shared fleet ID alone cannot collapse widely separated visits of the same bus. Repeated visits in one source are not extra votes.

Without comparable run identity, prediction matching must be unique in **both directions across the original source group**. Matching after an earlier ambiguous candidate was removed would manufacture agreement; those cases remain separate. Trip IDs from unrelated namespaces are not inferred to be equivalent. Scheduled times do not corroborate live predictions merely because their values are close. When a proved run includes both, actual nonscheduled reports drive the selected live value and the schedule disagreement remains visible; two agreeing live reports can still corroborate it.

InfoPoint arrival ETA and departure EDT are separate. Passio's `scheduledDepartureUtc` is not a proven live departure/dwell field and is not promoted to `departureTime`. UTC/epoch prediction fields are parsed as documented; unqualified local bus clock labels do not become fabricated absolute measurements.

### Publication is not operation

A catalog route can be visible while its day service is stopped. UGA current-state flags are not equivalent to InfoPoint `IsVisible` or Passio publication flags. A publication-only planning route is enabled only when it is published and has either:

- a reported vehicle with a valid original measurement no older than 120 seconds; or
- a nonscheduled arrival within the three-hour planning horizon, carrying a valid original update no older than 180 seconds.

The same 60-second future-clock allowance applies. A timetable clock label, unknown-age ETA, unknown-age position or recently downloaded catalog alone cannot enable a phantom bus. Such routes remain available for catalog/map inspection but have unknown current operation and are excluded from planning. Consequently a provider outage can preserve useful map/catalog backup while leaving no sufficiently confirmed journey.

### Topology and geometry

The Georgia crosswalk preserves native direction aliases based on complete ordered stops, not labels: reviewed county UGA direction `1` corresponds to InfoPoint `O` and direction `0` to InfoPoint `I`. Thirty-two city direction pairs and 17 campus pairs matched exactly during the evidence review; four city pairs differed. Differences in terminal/variant order are not unioned into invented edges.

A majority complete pattern can provide planning topology despite an outlier. Without a comparable majority, conflicting order or known loop closure excludes that pattern from the planning network; a route detail can still show a labeled preferred source view. A compatible source with a usable road trace can supply geometry. Passio's disconnected trace segments remain separate rather than receiving fabricated road links.

## Last-good snapshots

Snapshots contain normalized **public transit** resources. Local trip origins, destinations and geolocation are not snapshot values or keys. Provider comparison requests bypass this store. Resource keys include selected agency, source and operation; Ohio/Georgia and distinct mirrors cannot overwrite one another.

| Limit | Actual behavior |
| --- | --- |
| Storage key | `tranuga.transit-replicas.v1` in browser localStorage. |
| Slots | At most 64 resource entries, evicting older insertion order. |
| Persistence cap | Serialized data at most 2,000,000 characters; this is a string-length cap, not a promise about encoded byte size. An oversized single entry is not persisted. |
| Static snapshot age | At most 24 hours; newer data can evict earlier resources. |
| Active/prediction fallback | Cached current-service flags and predictions cease to establish current planning after 2 minutes. |
| Cached vehicle display | At most 5 minutes of saved-snapshot age; original measurement age still determines whether it could establish current service. |
| Invalid/full storage | Reject invalid/expired entries; continue with memory when persistence is unavailable. |

Nested saved results propagate their original resource time and cached state. Selected records preserve `snapshotAt`; old data is not refreshed merely by recrawling a saved child result. Vehicle `updatedAt` and prediction `updatedAt` remain original measurement/update times, distinct from fetching and from snapshot age.

Static 24-hour retention does not authorize 24-hour-old buses or active service. A saved snapshot is not a complete offline transit pack: slot/size eviction and prior feature usage determine which resources are available.

## Provider tools and location privacy

Provider information, bus search and timetable use the supported Passio nodes and normalized public data. Utility values use matching read responses where possible, otherwise a labeled surviving result. Timetable labels retain the operator timezone and do not invent dates.

The independent local planner processes points in the browser. **Request provider comparison** explicitly sends the two points to Passio, using the strict two-point transit payload. This action is not part of the automatic crawl, does not write a snapshot, and uses zero client/edge cache TTL. Request-log metadata does not include coordinate bodies. The normalized comparison excludes driving alternatives/provider HTML and preserves unknown route identity or duration. It is displayed separately, not mixed into or used as a vote for the local quickest-trip result.

**Find nearby** also explicitly sends the selected geolocation to the discovery endpoint. Ordinary geolocation is requested only after the user selects a location feature. Public OpenStreetMap tiles make normal third-party tile requests. There is no user account, analytics SDK or continuous location tracking.

## Gateway boundary

The Worker accepts only approved GET requests and the 11 Passio read-query contracts' exact POST schemas where applicable. It restricts Passio to two reviewed systems and three fixed origins, canonicalizes JSON fields, limits body/response sizes, rejects redirects and strips caller credentials. POST cache keys include action, canonical URL and body digest. Operator-comparison responses bypass edge caching with `no-store`.

See the [complete request inventory and curl examples](../README.md#complete-api-inventory-33-patterns), [per-layer TTLs](../feature.md#request-cache-and-crawl-policy), and [deployment policy](deployment.md). Source policy is committed code; a discovered URL or provider config cannot expand it.

## Verification

[replication-merge.test.ts](../tests/replication-merge.test.ts) covers majority/outlier selection, single backup, nonaveraging, identity boundaries, freshness, current service, ETA/EDT ambiguity, directed topology, loop abstention and nested cache semantics. [replication-service.test.ts](../tests/replication-service.test.ts) covers coordinator/storage behavior; [crosswalk.test.ts](../tests/crosswalk.test.ts) covers captured identity evidence. Browser tests cover the visible workflows. The final executed acceptance state belongs in [verification.md](verification.md); source-level descriptions alone are not evidence that a live deployment succeeded.
