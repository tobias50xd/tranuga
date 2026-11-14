# Hourly trip-planning failures

This file is populated by the bounded hourly live monitor. Each entry contains the UTC crawl slot, the input coordinates, the independently expected reachability, the planner response, and enough route/stop context to reproduce the case manually.

## 2026-11-14T16:00:00.000Z — single-route case selection failure

The live snapshot had no active directed pattern with two distinct stops at least 500 m apart.

```json
{
  "slot": "2026-11-14T16:00:00.000Z",
  "routeCount": 35,
  "activeRoutes": [
    "1001",
    "1005",
    "1006",
    "1007",
    "1008",
    "1020",
    "1027"
  ],
  "patternCount": 15,
  "calls": [
    {
      "method": "GET",
      "url": "https://d1dhvjc4b8xlgl.cloudfront.net/mobile-bus-data/busData.json",
      "status": "ok",
      "duration": 529
    },
    {
      "method": "GET",
      "url": "https://d1dhvjc4b8xlgl.cloudfront.net/mobile-bus-data/version.json",
      "status": "ok",
      "duration": 315
    },
    {
      "method": "GET",
      "url": "https://my.uga.edu/v4_19/cache/Buses",
      "status": "ok",
      "duration": 263
    },
    {
      "method": "GET",
      "url": "https://my.uga.edu/v4_19/cache/Routes",
      "status": "ok",
      "duration": 304
    }
  ],
  "version": {
    "version": 1086
  }
}
```

## 2026-11-14T16:00:00.000Z — random-case selection failure

No independently reachable random pair was found in 240 bounded attempts.

```json
{
  "slot": "2026-11-14T16:00:00.000Z",
  "activeRoutes": [
    "1001",
    "1005",
    "1006",
    "1007",
    "1008",
    "1020",
    "1027"
  ],
  "usablePatterns": 0,
  "stops": 94,
  "calls": [
    {
      "method": "GET",
      "url": "https://d1dhvjc4b8xlgl.cloudfront.net/mobile-bus-data/busData.json",
      "status": "ok",
      "duration": 529
    },
    {
      "method": "GET",
      "url": "https://d1dhvjc4b8xlgl.cloudfront.net/mobile-bus-data/version.json",
      "status": "ok",
      "duration": 315
    },
    {
      "method": "GET",
      "url": "https://my.uga.edu/v4_19/cache/Buses",
      "status": "ok",
      "duration": 263
    },
    {
      "method": "GET",
      "url": "https://my.uga.edu/v4_19/cache/Routes",
      "status": "ok",
      "duration": 304
    }
  ],
  "version": {
    "version": 1086
  }
}
```
