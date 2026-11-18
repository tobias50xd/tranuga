# Speed up trip planning in TranUGA

## Summary

Start loading transit data while the rider chooses their destination, and shorten the wait when they tap **Find quickest bus trip** before that data is ready. Keep the same route coverage, transfer rules, and live-data freshness checks.

The first place to optimize is data loading. Today, the button waits for `getNetwork()` to finish collecting route and arrival data across providers before the browser searches for an itinerary. UGA fetches tracking data in groups of four, InfoPoint fetches predictions stop by stop, and Passio waits for vehicles and notices before starting its ETA batches. These are code-based findings. The first implementation step is to measure how much each stage contributes.

## Implementation

1. **Measure the wait.** Add local browser timings for button click to itinerary paint, with separate timings for network collection, itinerary search, and map drawing. Record request counts and compare median and 95th-percentile times for first and repeat searches. Keep coordinates out of the measurements.
2. **Give the data load a head start.** Once the first valid trip point is selected, start one background network load for the selected agency. On submit, join that load if it is still running or reuse its successful, non-degraded result for up to **10 seconds** after completion. Otherwise, start a fresh load. Preserve the original data timestamps and existing planner freshness checks. Invalidate the prepared result on agency change or manual sync, and guard against late responses updating the wrong page.
3. **Shorten the cold path.** Start the route catalog, static topology, vehicles, and notices concurrently wherever their inputs allow. For UGA, begin fetching tracking data as soon as route IDs are known, then normalize it when topology is ready. For Passio and InfoPoint, start ETA requests as soon as the required route, stop, and variant mappings are ready. Keep existing request concurrency limits, replica merging, and fallback behavior.
4. **Paint the itinerary before drawing the map.** Display the summary and legs, allow a browser paint, then draw the journey on the map. Guard the delayed draw so it cannot restore an old trip after an edit or navigation. If traces still show searches blocking the main thread for more than **50 ms at the 95th percentile** on the mobile test profile, move the existing search into a Web Worker and keep the same inputs and result shape. Public APIs and stored data formats stay the same.

## Verification and targets

- Compare cold, preloaded, and repeat searches using fixed provider fixtures with simulated mobile latency. Target **under 500 ms from tap to itinerary paint** when a usable snapshot is ready and **at least 25% lower cold-search p95** than baseline. Report cold results per provider so a faster UGA path cannot hide slower InfoPoint or Passio searches.
- With fixed inputs and time, verify that fresh loads produce the same itinerary, transfers, and timing labels. Cover expired predictions, provider failures, manual sync, overlapping loads, and navigation before completion.
- Verify that a warm submit issues zero additional network-crawl requests, a cold submit still works without preloading, and a delayed map draw cannot overwrite a newer result.

The 10-second reuse window and performance targets are starting defaults. Build on the existing in-progress planner, styles, and end-to-end test changes in the workspace.
