# Cloudflare deployment

The client is a static Vite build in `dist/`. Cloudflare Workers Static Assets serves those files. A small Worker handles only `/api?url=...`, forwarding the documented public GET endpoints and the specifically approved Passio read queries that use POST; all route planning and UI rendering run in the browser. There is no application database, server-rendered page, login, or transit API credential.

The gateway is necessary because UGA and CloudFront responses currently omit browser CORS headers, and the original myStop discovery endpoint is HTTP. Hosting the files without the gateway will load the interface but cannot reliably load live transit data. See [Cloudflare's static assets configuration](https://developers.cloudflare.com/workers/static-assets/binding/) for how `ASSETS` and `run_worker_first` are configured.

## First deployment

1. Use Node.js 22. Create or select a Cloudflare account and initialize its Workers `workers.dev` subdomain in the Cloudflare dashboard if this is the account's first Worker.
2. Create a [Cloudflare API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/) with the **Edit Cloudflare Workers** template, scoped to the deployment account. This deployment uses `workers.dev`, so it does not need permission to edit your DNS zones. Copy the account ID from the Cloudflare dashboard.
3. In the GitHub repository, open **Settings → Secrets and variables → Actions**. Add repository secrets named `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Alternatively, place both in a GitHub environment named `production`; the deploy job targets that environment. Configure any desired environment reviewers there.
4. Keep `name: "tranuga"` in `wrangler.jsonc`, or choose another Worker name before the first deployment. No account-specific identifier or token belongs in source files or `VITE_*` variables.
5. Push the application to `main`. The **Test and deploy to Cloudflare** workflow checks types, runs the unit/integration suite, builds the static assets, runs browser feature tests in Chromium, validates the Worker bundle with a dry run, and deploys on success. Pull requests execute verification without using deployment secrets. The workflow can also be run manually from GitHub's Actions tab on `main`.
6. Read the literal deployment URL from Wrangler's job output, normally `https://tranuga.<your-subdomain>.workers.dev`. Open that URL, select a route, inspect bus and stop details, and plan a trip. A successful local build or dry run is not proof of a deployed URL; the GitHub deployment job must succeed.

This repository prepares deployment; it does not supply a Cloudflare account or token. No production deployment is claimed until a real action or Wrangler deployment succeeds.

The workflow uses the exact Wrangler dependency from `package-lock.json` rather than installing a moving CLI release. See [Cloudflare's GitHub Actions guidance](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) for authentication and account scoping.

## Local edge preview and manual deployment

```sh
npm ci
npm run build
npm run dev:edge
```

Open the local URL Wrangler prints (normally `http://localhost:8787`). This serves the production static build with the same gateway. A Vite-only preview does not supply `/api` unless separately proxied to Wrangler.

To deploy manually after verification, authenticate interactively with `npx wrangler login`, then run:

```sh
npm run typecheck
npm test
npm run deploy
```

For noninteractive use, supply `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` through the environment or a secret manager. Do not paste tokens into command arguments or commit local credential files. The manual path is optional; GitHub Actions remains the normal deployment path.

An offline packaging check needs no Cloudflare credential:

```sh
npm run build
npx wrangler deploy --dry-run --outdir /tmp/tranuga-worker
```

## Gateway policy and operation

- GET requests are accepted only for the documented endpoint paths. Transit POST is accepted only for the Passio read queries described below. The separate `/api/places` endpoint accepts only the fixed Photon address-search contract, also described below. Each endpoint enforces its own HTTP method. IDs, route lists, coordinates, directions, property codes, and parameter names are validated. UGA stop IDs accept the numeric campus form and the canonical city form with one lowercase `c` prefix (for example, `stop_c1` and `stop_c243`); route-tracking IDs remain numeric. Browser requests from a different Origin are rejected.
- Approved UGA/CloudFront/discovery hosts, the three fixed Passio origins below, and the committed `src/data/authorities.json` roots form the transit allowlist. The dedicated address endpoint has one separate fixed destination, `https://photon.komoot.io/api/`; it cannot be requested through the general transit gateway. Runtime discovery cannot add a proxy destination. The InfoPoint registry was captured from the public authority list on 2026-11-12; updating it is an explicit source change, followed by a test/build/deployment.
- Most authority requests use HTTPS. Discovery uses the original HTTP endpoint: its HTTPS certificate was expired during validation on 2026-11-12. The legacy IndyGo root advertised by that discovery response also uses HTTP. The browser-to-app connection remains HTTPS, but these particular provider-side connections do not have TLS integrity. Metadata from discovery cannot expand the gateway allowlist. TLS certificate validation is never disabled.
- KML is allowed only under an approved agency origin's `Resources/Traces/` directory, with a `.kml` filename. Config responses cannot authorize another host. An agency that moves geometry to a different host needs an explicit policy update; stop geometry remains available when trace loading fails.
- Redirects are rejected, preventing a permitted endpoint from forwarding the gateway to another destination. Caller cookies, Authorization headers, and provider cookies are not forwarded. No arbitrary proxy path, feedback endpoint, ticketing integration, or private address is exposed.
- Responses have a 12-second timeout and an 8 MiB body limit, including streamed bodies. Passio POST uploads are limited to 8 KiB and require a JSON object with the exact approved fields and types. JSON/KML is validated before serving. Provider 401, 403, 404, and 429 statuses remain actionable; redirects, malformed data, and other upstream failures produce controlled errors. Errors are never cached.
- Live route, vehicle, ETA, message, and bus-search data is cached at the edge for 10 seconds. Passio variant catalogs are cached for 60 seconds. Stops, direction stop lists, static topology, configuration, discovery, KML, and Passio software-version/grouped-catalog/timetable metadata are cached for an hour. Operator-plan comparisons contain caller-selected coordinates, bypass the edge cache and return `Cache-Control: no-store`. The provider's Date is retained as `X-Upstream-Date`; caching never changes vehicle observation times. `X-Transit-Cache` reports HIT or MISS. Local Wrangler cache behavior can differ from production.
- Static responses use `public/_headers` for browser security headers. The CSP permits only same-origin scripts/API calls and OpenStreetMap image tiles; any map-provider change must update that policy. Cloudflare documents the [static `_headers` format](https://developers.cloudflare.com/workers/static-assets/headers/).
- Deployment sets no billing or request-rate promises. Cache reduces provider load; apply account-level Cloudflare rate limiting if traffic needs tighter limits. Provider outages and undocumented API changes must remain visible in the app.

### Passio read queries

The approved HTTPS origins are exactly `https://passiogo.com`, `https://replicated2of3.passiogo.com`, and `https://replicated3of3.passiogo.com`. Both replica hosts were verified with real read requests on 2026-11-13. They are mirrors of the same provider; allowing them does not make them independent transit authorities. The browser service controls fallback and comparison; the gateway enforces the same policy for every mirror.

The only approved agency IDs are strings `"3994"` (University of Georgia) and `"5842"` (Athens Transit, **Ohio**). The agency at `athenstransit.passiogo.com` is not Athens, Georgia. An agency or replica cannot be added by supplying another URL or payload.

The gateway accepts `POST /api?url=<encoded absolute URL>` with `Content-Type: application/json` for these read-only operations. It forwards fresh canonical JSON and no caller headers beyond the fixed Accept and Content-Type values:

| Upstream path/query | Exact JSON object (`agencyId` is one of the two approved strings) |
| --- | --- |
| `/mapGetData.php?getRoutes=1` | `{ "systemSelected0": agencyId, "amount": 1 }` |
| `/mapGetData.php?getRoutes=2&sortMode=1&credentials=1` | `{ "systemSelected0": agencyId, "amount": 1 }` |
| `/mapGetData.php?getStops=2&withOutdated=1&wBounds=1&showBusInOos=0` | `{ "s0": agencyId, "sA": 1 }` |
| `/mapGetData.php?getBuses=1&speed=1` or `/mapGetData.php?getBuses=2` | `{ "s0": agencyId, "sA": 1 }` |
| `/mapGetData.php?getBuses=2&search=<query>` | `{ "s0": agencyId, "sA": 1 }` |
| `/goServices.php?getAlertMessages=1&alertCRC=na&noOptions=1` | `{ "systemSelected0": agencyId, "amount": 1, "routesAmount": 0 }` |
| `/mapGetData.php?walk=2` | `{ "systems": { "systemSelected0": agencyId, "amount": 1 }, "routes": { "amount": 0 }, "points": [{ "lat": number, "lng": number }, { "lat": number, "lng": number }], "mode": "transit" }` |

Bus query versions 1 and 2 both accept the optional fixed `speed=1` flag. The separate search form requires `getBuses=2` and a nonblank query of at most 40 ASCII letters, digits, spaces, underscores or hyphens. Stop predictions use GET `/mapGetData.php?eta=3&stopIds=<IDs>&userId=<agencyId>`, optionally with numeric `routeId` and a positive numeric `position`. `stopIds` is a comma-separated list of at most 40 numeric stop IDs.

Additional GET reads are `/mapGetData.php?getSystems=2&sortMode=1&credentials=1&acronymId=<agencyId>`, `/goServices.php?goWebVer=1`, and `/mapGetData.php?schedule=4&routeId=<numeric variant>&stopId=<numeric stop>`. The directory request works on the fixed backend origins, so an agency homepage cannot expand the allowlist. `credentials=1` is an observed metadata selector; no authentication header or cookie is supplied.

The operator-plan body accepts exactly two `{lat,lng}` points with finite numeric latitude in `[-90,90]` and longitude in `[-180,180]`. The caller must request the operator comparison explicitly before these selected coordinates are sent. The gateway does not log the body, echo coordinates into headers, or cache its response. No background tracking coordinates, device ID, debug/timeline flag, account credential, write action, ride request, or extra field is permitted.

Other POST responses are stored under a synthetic GET cache key containing the upstream origin, canonical query string, method, and SHA-256 digest of the canonical JSON body. Different agencies and replica origins cannot share a cache entry; equivalent JSON field/query order does share one. The worker test suite proves those cases, method restrictions, body validation, upload limits, unknown-action rejection, coordinate bounds, nested operator-plan schemas, no-store behavior, and credential stripping. See [the Passio extraction notes](passio-api.md) for observed upstream response contracts and their limits.

### Address-search read query

`POST /api/places` accepts only `application/json` with exactly `{"query":string,"lat":number,"lon":number}`. Query length is 3–120 with no control characters; finite numeric coordinates use the usual latitude/longitude bounds. No URL parameters or cross-origin browser requests are accepted. Uploads are bounded at 1 KiB. The Worker sends a GET to the fixed `https://photon.komoot.io/api/` with `q`, `lat`, `lon`, `limit=5`, `lang=en`; no caller credentials are forwarded and redirects are rejected. Upstream timeout is six seconds and the response limit is 256 KiB. Only a JSON GeoJSON FeatureCollection envelope is served; the client further validates points/labels. Every response uses `Cache-Control: no-store` and bypasses the transit edge cache and snapshot store. Do not log address request bodies. Search text is still visible to the upstream Photon service.

The browser debounces address requests, aborts stale ones and keeps only a bounded five-minute memory cache. The public Photon demo is for reasonable use with no availability guarantee. Assess rate limits or a managed/self-hosted instance before high traffic. No additional secret or map SDK is needed; the existing Leaflet/OpenStreetMap map and CSP remain in use. Contracts, reproduction requests, attribution and current cost limits are bundled in [the README](../README.md#address-search-and-maps).

## Maintenance and rollback

When an authority endpoint changes, inspect its official transit site, verify the public endpoint, update the committed registry or path policy, add a regression test, and redeploy. Never accept a URL from unverified discovery into the allowlist automatically.

Production logs and deployment history are available under the Worker in Cloudflare. Do not add query payloads or user coordinates to logs. Revert the application commit and let GitHub Actions deploy it, or select a previous deployment in Cloudflare's deployment history. The static client and Worker must be rolled back together.

A custom domain is optional and outside the default deployment. Add it in the Worker's **Settings → Domains & Routes** and follow Cloudflare's DNS setup. Only then add any zone permissions required for future domain changes.
