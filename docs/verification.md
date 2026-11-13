# Acceptance evidence

The November 13 local acceptance run passed **353 deterministic tests and 40 production-build desktop/mobile browser tests**, including TypeScript and the production build through `npm run check`. A final Wrangler bundle dry run passed. Production publication remains a separate external gate.

A production Cloudflare deployment remains an external gate: the workflow is present, but no production deployment URL has been verified and the required deployment credentials are unavailable in the current environment.

## Current extension gates

| Requirement | Evidence to inspect | Final November 13 status |
| --- | --- | --- |
| Static frontend and GitHub→Cloudflare deployment | `npm run build`; `.github/workflows/deploy.yml`; Wrangler bundle dry run; authenticated GitHub deployment result for actual publication. | Build and dry run passed; production deployment not verified. |
| Complete first-page catalog and route maps | Production-build desktop/mobile browser tests for merged catalogs, all stops, trace segments, direction variants and vehicle headings. | 40 desktop/mobile browser tests passed. |
| Arbitrary map/current-location journey | Browser coordinate/map/geolocation success/denial/race tests, plus pure planner tests and exhaustive-path oracle. | 40 browser tests and 44 planner cases passed. |
| All 33 patterns have useful application actions | Original API and Passio adapter tests; endpoint inventory; provider information/search/timetable/comparison browser tests; gateway schemas. | 353 deterministic and 40 browser tests passed; all 33 inventory rows verified. |
| Ohio `5842` versus Georgia `3994` and InfoPoint scope | Factory/service tests, crosswalk tests, explicit network selection and scoped snapshot keys. | Crosswalk/merge/browser tests passed; dated identity review completed. |
| Three-node Passio and single-source fallback | Merge/service tests for two-of-three outliers, one surviving node, partial failure, saved fallback and health recovery. | Final deterministic and browser regressions passed. |
| Correct current-service semantics | Tests proving publication cannot outvote current inactivity or create day buses; fresh original-time evidence can enable a fallback route. | Final deterministic and browser regressions passed. |
| Freshness/provenance and identity | Tests for original times, unknown/stale GPS abstention, nonaveraging, explicit aliases, route assignment conflicts and nested-cache age. | Final deterministic and browser regressions passed. |
| Directed topology and ETA identity | Tests for whole-pattern majority, disputed-order exclusion, loop abstention, variants, known-run outliers, bidirectional ambiguity and separate ETA/EDT. | Final deterministic and browser regressions passed. |
| Bounded persistent public-data crawl | Snapshot/coordinator tests for 64 slots, 2,000,000-character persistence cap, 24-hour static age, short live eligibility, corrupt/full storage, coalescing and visible-tab behavior. | Final deterministic and browser regressions passed. |
| Safe read-only gateway and comparison privacy | Worker tests and real local edge checks covering exact GET/POST methods/bodies, origins/system IDs, body hashing, no-store comparison, limits, redirects and malformed data. | 193 worker tests passed; live gateway and browser checks described below passed. |
| Original design and repository artifacts | Current HTML/CSS/assets, `.gitignore`, lockfile, README/feature inventory and source/extraction documentation. | All relative links and numbered 1–33 inventories verified; Git whitespace check passed. |

## Executed scoped November 13 evidence

These dated checks establish their own scope; they are not a final full-application result.

- Around 01:31–01:37 UTC, read-only Georgia identity probes compared all 35 UGA current tracking responses with Athens InfoPoint and UGA Passio. The committed review contains 35 route aliases, 608 stop aliases, 19 observed vehicle aliases, 49 exact direction-pair matches and four conflicting city patterns. See [replication-evidence.md](replication-evidence.md).
- At 02:07:58 UTC, `npx vitest run tests/replication-merge.test.ts tests/crosswalk.test.ts` passed 49 + 9 tests, and `npm run typecheck` passed. Later code changes require another final run.
- The Passio adapter recorded 24 deterministic tests, including verified timezone freshness and DST boundaries. All six expanded mirror/system live cases have passed, with a documented transient HTTP 403 failure in two cases and successful targeted repeats; it was not one uninterrupted all-green expanded run. See [passio-api.md](passio-api.md).

Live local gateway checks returned HTTP 200 for the five core queries and six additional reads across all three Passio origins. Both approved agency IDs were exercised. Operator comparison returned `no-store`; metadata/timetable used the documented static TTL; search used a short TTL. County `stop_c1` and `stop_c243` also succeeded after the gateway prefix fix. The deterministic worker suite then passed all 193 cases.

## Commands for final recording

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
npx wrangler deploy --dry-run --outdir /tmp/tranuga-worker
```

Live probes remain explicit opt-in and can legitimately fail when undocumented providers reject requests or are unavailable:

```sh
LIVE_TRANSIT=1 npx vitest run tests/api-live.test.ts
LIVE_PASSIO=1 npx vitest run tests/passio.test.ts
```

| Final command/check | Executed result |
| --- | --- |
| TypeScript | Passed in `npm run check` / production build. |
| Deterministic suite | 353 passed; 8 opt-in live cases skipped in normal CI. |
| Production build | Passed; static Vite output generated. |
| Desktop/mobile browser suite | 40 passed in 19.2 seconds against production assets. |
| Wrangler dry run | Passed with `ASSETS` binding; no deployment credential used. |
| Local runtime/API/privacy checks | Actual edge/browser loaded 40 merged Georgia routes and 20 Ohio routes; Ohio route 66949 rendered 36 stops and one bus. Desktop/mobile tiles loaded; no browser JavaScript errors or horizontal overflow observed. Counts are snapshots. |
| Git/documentation checks | Whitespace and all relative documentation links passed; README and feature inventories each contain exactly rows 1–33. |
| Production deployment | Not verified; Cloudflare account/token setup required. |

Browser tests serve production `dist/` assets, intercept transit calls with bounded captured-schema fixtures, rebase predictions to test time, and block external tiles. They prove feature behavior against those contracts. Live checks prove the observed provider response at that moment. Neither establishes future uptime, guaranteed travel times, all-agency compatibility, independent physical measurement agreement or production publication.

## Preserved November 12 baseline

The original application acceptance run on **2026-11-12 UTC** passed 122 deterministic tests, 30 production-build browser tests and two opt-in UGA/CATA live tests. A build and Wrangler dry run passed. Local edge/browser checks observed 35 UGA/county catalog routes, route `5750` with 19 stops and five vehicle markers, a campus itinerary with visible assumptions, static security headers, successful gateway cache reuse and rejection of a private metadata target.

Those are historical observations for the original 22-pattern implementation, not new Passio/replication acceptance counts. The [API validation record](api-validation.md) preserves exact scope and initial schema findings. The implementation's original design used custom HTML/CSS, bundled Leaflet and a licensed self-hosted font; APK inputs were excluded from the build.
