# Acceptance evidence

Verified on **2026-11-12 UTC** from the application worktree. This records executed checks, not only planned validation.

| Requirement | Authoritative evidence |
| --- | --- |
| Static webapp with GitHub → Cloudflare deployment | Vite production build and Wrangler deploy dry run passed. The tracked workflow verifies before deploying `main` to Workers Static Assets. A successful live GitHub deployment is a separate external gate. |
| First page lists available routes | Desktop/mobile browser tests cover every fixture route, active filter, search and refresh. Live edge/browser check rendered 35 UGA/Athens catalog entries. |
| Route map and current stops | Browser tests verify route paths, 19 current fixture stops, direction selection and selected-stop arrival calls. Live route `5750` rendered its road trace and 19 stops using actual data. |
| Bus position and direction | Browser tests verify heading, marker placement, stale/empty states and a subsequent polling request. Live route check rendered 5 vehicle markers with heading arrows and observation ages. Counts are observations, not constants. |
| Arbitrary start/goal and current location | Desktop/mobile tests cover coordinate input, map clicks, swapping, geolocation success/denial, invalid points, no connection, and endpoint consistency during delayed searches. |
| Quickest available directed bus trip | 42 planner tests include transfers, loops, active filters, ETA/EDT/dwell, stale data, closest-versus-fastest, reachability, tie-breaking and an exhaustive oracle across 40 generated directed networks. Live browser planning returned an estimated connection in 1.36 seconds for a campus trip, with visible assumptions and no JavaScript errors. |
| Every API in source notes used | 13 deterministic API tests execute all 22 API patterns through real service workflows. Two opt-in provider tests passed in 3.60 seconds at 22:45 UTC, covering UGA and representative CATA/discovery/KML calls. See [API validation](api-validation.md) for exact scope. |
| Independent design | Source uses custom HTML/CSS, bundled Leaflet and a licensed self-hosted font. APKs are ignored and are not build inputs. |
| Documentation and ignore rules | README documents behavior, architecture, commands, model, tests, deployment and limitations; feature.md maps all 22 calls to shipped/future features. Original notes are preserved in api-extraction.md, avoiding two filenames differing only by case. Relative documentation links and Git whitespace checks passed. |
| Meaningful tests for features | **122 deterministic tests passed**, plus **30 production-build browser tests passed** across desktop/mobile Chromium, including rapid map navigation. Live checks are opt-in and skipped in normal CI. |

Additional local edge checks against Wrangler verified successful `/`, UGA routes/tracking, CloudFront topology, directory, CATA config and KML; a repeated request returned cache HIT; a private metadata target returned 403. Real static responses included the CSP, geolocation policy, framing and content-type headers. Live desktop/mobile screenshots were inspected: map tiles loaded, no horizontal overflow was observed, and no browser JavaScript errors occurred.

Reproduce the required checks using the commands in [README](../README.md). Browser tests use the production build with deterministic transit fixtures and blocked external tiles. Live provider and local-runtime observations do not establish future availability, all-agency compatibility, guaranteed travel times, or a deployed production URL.
