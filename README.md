# tranuga

A static transit webapp for UGA and Athens, with live route maps and a browser-based quickest-trip estimator. It also supports agencies discovered through myStop / Avail InfoPoint. Its visual design is original; no APK layouts, artwork, embedded keys, or app assets are used.

## What you can do

- Browse **every route** returned by the selected network, including clearly labeled inactive routes. Search routes, filter active service, and refresh the catalog.
- Select a route to see its road trace, current ordered stops, direction selector, bus positions, heading arrows, and observation timestamps. Positions refresh every 15 seconds while the route is open and the tab is visible. Positions older than two minutes are labeled as last known locations.
- Select a stop in the list or on the map for its upcoming predicted/scheduled arrivals, then start a trip there.
- Choose start and destination by clicking any point on the map, entering decimal `latitude, longitude`, or using browser geolocation for the start. Swap endpoints and set walking limits.
- Get the quickest estimated bus connection in the available network, including access/egress walking, waits, directed rides, and transfers. The map and step list show the result and its timing assumptions.
- Open **Networks** to discover InfoPoint agencies, search names, find one near your location, or enter an authority code. Agency route messages and public service alerts appear in route and trip views.
- Use the same interface on desktop or mobile, with keyboard-accessible controls, labels, visible focus, reduced-motion support, and announced loading/error states.

No login or bus API key is required. Location is requested only when you choose a location feature; there is no account, analytics SDK, saved trip database, or background tracking.

## Run locally

Use **Node.js 22.12+** (Node 24 also works) and npm. Install the exact dependencies from the lockfile:

```sh
npm ci
npm run build
npm run dev:edge
```

Open the URL printed by Wrangler, normally **http://localhost:8787**. This is the production static build plus its live API gateway. Rebuild after editing source to update this preview.

For Vite hot reload, keep Wrangler running and use another terminal:

```sh
npm run dev
```

Open Vite's printed URL, normally **http://localhost:5173**. Vite proxies `/api` to Wrangler on port 8787. `npm run preview` alone serves static files and does not provide the gateway.

## GitHub Actions → Cloudflare

The tracked [.github/workflows/deploy.yml](.github/workflows/deploy.yml) verifies pull requests and deploys successful pushes to `main`, or manual runs on `main`, to **Cloudflare Workers Static Assets**. The static app and its small API gateway deploy together. No database, SSR, or transit credential is needed.

Before the first deployment:

1. Initialize your Cloudflare account's `workers.dev` subdomain.
2. Create an account-scoped **Edit Cloudflare Workers** API token.
3. Add GitHub Actions secrets **`CLOUDFLARE_API_TOKEN`** and **`CLOUDFLARE_ACCOUNT_ID`** to this repository or its `production` environment.
4. Push to `main`, then inspect **Test and deploy to Cloudflare** in GitHub Actions. Read the deployed URL from its successful Wrangler output.

The workflow gates deployment on type checks, deterministic tests, a production build, desktop/mobile Chromium feature tests, and a Wrangler bundle dry run. The deploy job targets the `production` environment. No Cloudflare credentials belong in frontend variables or source control. A local dry run does not prove a live deployment.

[Deployment instructions](docs/deployment.md) cover exact account setup, authentication, local edge preview, allowlist maintenance, security headers, caching, custom domains, and rollback. [Cloudflare's static asset documentation](https://developers.cloudflare.com/workers/static-assets/) describes the hosting model; [its GitHub Actions guide](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) describes CI authentication.

## Why a static app includes a gateway

Vite builds `index.html`, JavaScript, CSS, Leaflet, and a self-hosted font into `dist/`. All UI and journey computation happen in the browser. A minimal Worker serves only a restricted `/api?url=...` GET gateway alongside the static assets. The UGA/CloudFront feeds omit browser CORS headers, and the original agency discovery endpoint is HTTP; a browser-only fetch implementation cannot reliably use them from an HTTPS site.

The Worker accepts only documented paths on reviewed transit origins. It validates parameters, rejects redirects/private destinations, strips caller credentials, limits time/body size, validates JSON/KML, and caches successful GETs. Discovery cannot grant access to a new host. Its 73 reviewed agency roots live in `src/data/authorities.json`; not all agencies have been individually tested. A moved/new host needs a reviewed registry update.

The legacy discovery request remains HTTP between the gateway and provider because the provider's HTTPS certificate was expired during validation. TLS validation is never bypassed. The browser-to-production connection stays HTTPS. See the deployment documentation for the precise policy and limits.

## APIs and data behavior

All **22 documented API patterns** are integrated into real workflows: 6 UGA APIs, 3 discovery selectors, 12 per-authority InfoPoint endpoints, and KML trace retrieval. They are called on demand for the selected network and feature, rather than contacting every agency at startup.

| Data | Where it is used |
| --- | --- |
| UGA `Routes`, `Buses` | Catalog, active state, vehicle positions/heading, refresh |
| UGA `routeTracking_{routeId}`, `stop_{stopId}` | Current ordered stops, route predictions, stop arrivals, planning |
| CloudFront `version.json`, `busData.json` | Static topology version, shape decoding, stop/route/trip mappings |
| Discovery all / Locate / authority code | Networks directory and selectors |
| InfoPoint config, all/visible routes | Network settings, route catalog and vehicles |
| InfoPoint route detail, all details, directions, direction stops | Route map, ordered directed topology, planning |
| InfoPoint all stops, route stops, individual stop, departures | Stop map/list, details, predicted/scheduled timing |
| InfoPoint public messages, KML | Service alerts and road traces |

The full endpoint-by-endpoint inventory, shipped uses, and possible future features are in **[feature.md](feature.md)**. Original API extraction/authentication evidence is preserved in **[API extraction notes](docs/api-extraction.md)**. Live probe findings and test scope are recorded in **[docs/api-validation.md](docs/api-validation.md)**.

UGA current stop order comes from `routeTracking`; static data supplies road geometry and confirms loops. If tracking fails, the route view labels any static fallback and planning excludes that unconfirmed route. If static data fails, usable live stops remain available with an explicit geometry/loop warning. Missing road traces are drawn as dashed stop connectors. InfoPoint stop order uses `RouteStops.SortOrder` per direction, because its direction-stop array is not consistently ordered. A route without a proven sequence is excluded from planning.

API client calls coalesce concurrent requests and cache successful data in memory. Most reads use 15 seconds; static/config/direction data uses longer TTLs. The edge caches live responses for 10 seconds and static/config/directory/KML data for one hour. See [feature.md](feature.md) for exact per-layer TTLs. Cached responses preserve vehicle observation timestamps. Failed requests show a visible error, warning, or explicitly labeled fallback; the application never substitutes simulated live buses.

## How quickest-trip estimation works

`src/planner.ts` runs a time-dependent earliest-arrival search with a binary heap. It considers **all** stops within the origin and destination walking limits, every available directed pattern, same-stop and nearby-stop transfers, and all usable live runs. It does not greedily select only the nearest stop. Boarding-to-downstream-stop edges keep staying on a bus free of extra boarding waits, preserve direction, and allow one wrap on confirmed loops. At least one bus ride is required, so it does not return a walking-only trip.

Default model:

| Parameter | Default |
| --- | --- |
| Walking speed | 1.3 m/s; straight-line distances |
| Access/egress walking limit | 1,200 m each; UI offers 800 / 1,200 / 2,000 m |
| Walking transfer limit | 300 m per transfer; walks cannot chain to bypass limits |
| Bus speed for unpredicted travel | 5.6 m/s plus 20 s dwell per stop |
| Unpredicted wait | 450 s after readiness or last known departure, whichever is later |
| Transfer buffer | 45 s |
| Prediction freshness / search horizon | 180 s / 3 hours |

Consistent route geometry estimates ride distance; otherwise straight-line stop distances are multiplied by 1.25. Predicted boarding times and explicit departure times are honored. When trip/vehicle identity proves two observations belong to the same run, downstream arrival anchors and intermediate dwell refine the ride timing. UGA does not supply trip identity with its stop predictions, so those improve boarding waits while downstream travel remains estimated. Past/impossible predictions and stale network snapshots are ignored. Tests compare the search against an independent exhaustive-path oracle on generated directed networks.

**These APIs do not provide complete timetables, pedestrian paths, or guaranteed future service.** The result is quickest within this declared model, with `estimated` or `live-assisted` confidence and visible assumptions. An active route flag does not guarantee that another bus will depart. Walking lines are straight estimates, not accessible walking directions; journey bus lines connect the used stops, while the route-detail map shows the provider's road trace. Planning stays within one selected agency and does not join independent agencies into a cross-network itinerary. All displayed clock times use your device's timezone.

## Tests and validation

```sh
npm run typecheck
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
npx wrangler deploy --dry-run --outdir /tmp/tranuga-worker
```

After installing the browser once, `npm run check` runs the unit suite, production build (including types), and browser suite. Browser tests serve the **production `dist/` assets**, intercept transit requests with realistic captured contract fixtures, and run on desktop and mobile viewports. Public map tiles are blocked in deterministic tests. Fixture predictions are rebased to test time; tests never depend on an actual bus arriving.

| Suite | Evidence |
| --- | --- |
| `tests/api.test.ts` | Response normalization, all 22 endpoint workflows, timestamps, directed ordering, geometry, caches, timeout/invalid/error responses and fallback exclusion |
| `tests/planner.test.ts` | Directed rides, loops, transfers, arbitrary coordinates, waits, ETA/EDT, stale/unreachable/invalid data, fastest-versus-nearest cases, independent oracle |
| `tests/worker.test.ts` | Every approved endpoint family, URL/query restrictions, SSRF/redirect protection, HTTP failures, timeouts, body limits, cache behavior and static asset delegation |
| `tests/ui.test.ts` | Escaping, safe colors, arrival labels, heading and stale-age formatting |
| `tests/e2e/app.spec.ts` | Catalog/search/filter, mapped stops and vehicles, live polling, stop arrivals, trip planning, map picks, geolocation/denial, networks/code/nearby/alerts, failure states and mobile layout |

Opt-in read-only live provider checks are deliberately excluded from normal CI because undocumented upstream services can change or go offline:

```sh
LIVE_TRANSIT=1 npx vitest run tests/api-live.test.ts
```

This exercises the UGA active network and a representative CATA agency, including every documented API pattern and KML. Live runtime probes through Wrangler additionally verify the gateway, actual static security headers, caching, and rejection behavior. Neither fixture tests nor a successful local edge preview imply a production deployment.

The implementation acceptance run passed **122 deterministic tests, 30 browser tests, and 2 opt-in live tests**. [Verification evidence](docs/verification.md) maps the requested features to those checks and live runtime observations.

## Source map and maintenance

```text
src/main.ts                UI, navigation, refresh and async view state
src/map.ts                 Leaflet route, stop, vehicle and journey layers
src/planner.ts             Pure browser journey algorithm
src/api/                   Endpoint builders, normalization, topology, service and transport
src/data/authorities.json  Reviewed agency metadata / gateway roots
src/types.ts               Shared normalized domain types
worker/index.ts            Restricted read-only gateway and static asset delegation
wrangler.jsonc             Cloudflare Worker/static assets configuration
.github/workflows/         Verify and deploy action
tests/                     Deterministic contracts, planner, gateway, UI, browser and live tests
docs/                      Deployment instructions and live API validation evidence
```

The public APIs are undocumented application endpoints and may change. Validate upstream schema changes against the recorded fixtures, add a meaningful regression case, and run the checks before deploying. New authority hosts require manual review. InfoPoint planning reads departures at served stops with concurrency capped at four; large networks can take longer. Polling pauses in hidden tabs and stops after leaving a route. No offline/live-data guarantee or street-based pedestrian routing is implemented.

`.gitignore` excludes dependencies, builds, local Cloudflare state, secrets, browser outputs, APK inputs, and extraction outputs. The original APKs remain outside the web build and source deliverables. `package-lock.json` is committed for repeatable installs.

Map tiles and attribution come from [OpenStreetMap](https://www.openstreetmap.org/copyright); production use must respect the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/). Leaflet is bundled locally. The Manrope font is self-hosted with its [SIL Open Font License](public/fonts/OFL.txt). Application code is covered by [LICENSE](LICENSE). This is an independent project, not an official UGA or transit-operator service.
