# Cloudflare deployment

The client is a static Vite build in `dist/`. Cloudflare Workers Static Assets serves those files. A small Worker handles only `/api?url=...`, forwarding the documented public GET endpoints; all route planning and UI rendering run in the browser. There is no application database, server-rendered page, login, or transit API credential.

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

- Only GET requests to the documented endpoint paths are accepted. IDs, route lists, coordinates, directions, property codes, and parameter names are validated. Browser requests from a different Origin are rejected.
- Approved UGA/CloudFront/discovery hosts and the committed `src/data/authorities.json` roots form the complete allowlist. Runtime discovery cannot add a proxy destination. This finite registry was captured from the public authority list on 2026-11-12; updating it is an explicit source change, followed by a test/build/deployment.
- Most authority requests use HTTPS. Discovery uses the original HTTP endpoint: its HTTPS certificate was expired during validation on 2026-11-12. The legacy IndyGo root advertised by that discovery response also uses HTTP. The browser-to-app connection remains HTTPS, but these particular provider-side connections do not have TLS integrity. Metadata from discovery cannot expand the gateway allowlist. TLS certificate validation is never disabled.
- KML is allowed only under an approved agency origin's `Resources/Traces/` directory, with a `.kml` filename. Config responses cannot authorize another host. An agency that moves geometry to a different host needs an explicit policy update; stop geometry remains available when trace loading fails.
- Redirects are rejected, preventing a permitted endpoint from forwarding the gateway to another destination. Caller cookies, Authorization headers, and provider cookies are not forwarded. No arbitrary proxy path, feedback endpoint, ticketing integration, or private address is exposed.
- Responses have a 12-second timeout and an 8 MiB body limit, including streamed bodies. JSON/KML is validated before serving. Provider 401, 403, 404, and 429 statuses remain actionable; redirects, malformed data, and other upstream failures produce controlled errors. Errors are never cached.
- Live route, vehicle, ETA, and message data is cached at the edge for 10 seconds. Stops, direction stop lists, static topology, configuration, discovery, and KML are cached for an hour. The provider's Date is retained as `X-Upstream-Date`; caching never changes vehicle observation times. `X-Transit-Cache` reports HIT or MISS. Local Wrangler cache behavior can differ from production.
- Static responses use `public/_headers` for browser security headers. The CSP permits only same-origin scripts/API calls and OpenStreetMap image tiles; any map-provider change must update that policy. Cloudflare documents the [static `_headers` format](https://developers.cloudflare.com/workers/static-assets/headers/).
- Deployment sets no billing or request-rate promises. Cache reduces provider load; apply account-level Cloudflare rate limiting if traffic needs tighter limits. Provider outages and undocumented API changes must remain visible in the app.

## Maintenance and rollback

When an authority endpoint changes, inspect its official transit site, verify the public endpoint, update the committed registry or path policy, add a regression test, and redeploy. Never accept a URL from unverified discovery into the allowlist automatically.

Production logs and deployment history are available under the Worker in Cloudflare. Do not add query payloads or user coordinates to logs. Revert the application commit and let GitHub Actions deploy it, or select a previous deployment in Cloudflare's deployment history. The static client and Worker must be rolled back together.

A custom domain is optional and outside the default deployment. Add it in the Worker's **Settings → Domains & Routes** and follow Cloudflare's DNS setup. Only then add any zone permissions required for future domain changes.
