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

## 2026-11-15T01:00:00.000Z — single-route case selection failure

The live snapshot had no active directed pattern with two distinct stops at least 500 m apart.

```json
{
  "slot": "2026-11-15T01:00:00.000Z",
  "routeCount": 35,
  "activeRoutes": [],
  "patternCount": 53,
  "calls": [
    {
      "method": "GET",
      "url": "https://d1dhvjc4b8xlgl.cloudfront.net/mobile-bus-data/busData.json",
      "status": "ok",
      "duration": 487
    },
    {
      "method": "GET",
      "url": "https://d1dhvjc4b8xlgl.cloudfront.net/mobile-bus-data/version.json",
      "status": "ok",
      "duration": 264
    },
    {
      "method": "GET",
      "url": "https://my.uga.edu/v4_19/cache/Buses",
      "status": "ok",
      "duration": 256
    },
    {
      "method": "GET",
      "url": "https://my.uga.edu/v4_19/cache/Routes",
      "status": "ok",
      "duration": 305
    }
  ],
  "version": {
    "version": 1086
  }
}
```

## 2026-11-15T01:00:00.000Z — random-case selection failure

No independently reachable random pair was found in 240 bounded attempts.

```json
{
  "slot": "2026-11-15T01:00:00.000Z",
  "activeRoutes": [],
  "usablePatterns": 0,
  "stops": 607,
  "calls": [
    {
      "method": "GET",
      "url": "https://d1dhvjc4b8xlgl.cloudfront.net/mobile-bus-data/busData.json",
      "status": "ok",
      "duration": 487
    },
    {
      "method": "GET",
      "url": "https://d1dhvjc4b8xlgl.cloudfront.net/mobile-bus-data/version.json",
      "status": "ok",
      "duration": 264
    },
    {
      "method": "GET",
      "url": "https://my.uga.edu/v4_19/cache/Buses",
      "status": "ok",
      "duration": 256
    },
    {
      "method": "GET",
      "url": "https://my.uga.edu/v4_19/cache/Routes",
      "status": "ok",
      "duration": 305
    }
  ],
  "version": {
    "version": 1086
  }
}
```

## 2026-11-15T03:00:00.000Z — single-route planning failure

The planner returned a journey that did not remain on the isolated route.

```json
{
  "slot": "2026-11-15T03:00:00.000Z",
  "origin": {
    "lat": 33.93378726972213,
    "lon": -83.37581018118648
  },
  "destination": {
    "lat": 33.94482547893452,
    "lon": -83.3768358892016
  },
  "routeId": "5743",
  "patternId": "uga:5743:0",
  "direction": "0",
  "fromStop": {
    "id": "155090",
    "name": "University Village Bldg G",
    "lat": 33.9339,
    "lon": -83.3759
  },
  "toStop": {
    "id": "198803",
    "name": "Myers/Snelling NB",
    "lat": 33.9449,
    "lon": -83.3767
  },
  "fromIndex": 12,
  "toIndex": 38,
  "result": {
    "durationSeconds": 3094.6455268554687,
    "walkingMeters": 737,
    "transfers": 2,
    "rides": [
      {
        "routeId": "5743",
        "direction": "0",
        "from": "155090",
        "to": "155099"
      },
      {
        "routeId": "5743",
        "direction": "0",
        "from": "155101",
        "to": "155094"
      },
      {
        "routeId": "5743",
        "direction": "0",
        "from": "155132",
        "to": "155106"
      }
    ]
  },
  "isolated": {
    "routes": [
      {
        "id": "5743",
        "agencyId": "uga",
        "operator": "uga",
        "name": "Weekender",
        "shortName": "WN",
        "color": "#9e8573",
        "active": true,
        "availability": "current"
      }
    ],
    "patterns": [
      {
        "id": "uga:5743:0",
        "direction": "0",
        "stops": [
          "175017",
          "155146",
          "175017",
          "155146",
          "177708",
          "155086",
          "177708",
          "155086",
          "175103",
          "155085",
          "175103",
          "155085",
          "155090",
          "155099",
          "155090",
          "155099",
          "155137",
          "155101",
          "155137",
          "155101",
          "155094",
          "155105",
          "155094",
          "155105",
          "155088",
          "155107",
          "155088",
          "155107",
          "155116",
          "155103",
          "155116",
          "155103",
          "155117",
          "155164",
          "155117",
          "155164",
          "198803",
          "155102",
          "198803",
          "155102",
          "155107",
          "177709",
          "155107",
          "177709",
          "155103",
          "155106",
          "155103",
          "155106",
          "155164",
          "155112",
          "155164",
          "155112",
          "155102",
          "155115",
          "155102",
          "155115",
          "177709",
          "155118",
          "177709",
          "155118",
          "155106",
          "155132",
          "155106",
          "155132",
          "155104",
          "155133",
          "155104",
          "155133",
          "155100",
          "155136",
          "155100",
          "155136",
          "155097",
          "175017",
          "155097",
          "175017",
          "155145",
          "155145",
          "155146",
          "155146"
        ],
        "loop": false
      }
    ]
  },
  "calls": [
    {
      "method": "GET",
      "url": "https://d1dhvjc4b8xlgl.cloudfront.net/mobile-bus-data/busData.json",
      "status": "ok",
      "duration": 565
    },
    {
      "method": "GET",
      "url": "https://d1dhvjc4b8xlgl.cloudfront.net/mobile-bus-data/version.json",
      "status": "ok",
      "duration": 291
    },
    {
      "method": "GET",
      "url": "https://my.uga.edu/v4_19/cache/Buses",
      "status": "ok",
      "duration": 267
    },
    {
      "method": "GET",
      "url": "https://my.uga.edu/v4_19/cache/Routes",
      "status": "ok",
      "duration": 586
    }
  ],
  "version": {
    "version": 1086
  }
}
```

### Resolution

The planner did find a journey, and every ride leg used route 5743, but it boarded that route three times because the live static pattern was malformed. The static rows for several same-direction variants had been merged into an alternating 80-stop sequence instead of the reviewed 42-stop Weekender order, making transfer walks and reboarding appear faster than remaining aboard.

The hourly topology selector now accepts a current static pattern only when its ordered stop IDs match the reviewed crosswalk. A mismatched pattern falls back to the reviewed UGA/Passio sequence and discards geometry whose alignment is no longer trustworthy. An offline regression reproduces an interleaved pattern and verifies that the two locations are connected by one continuous ride with zero transfers.

## 2026-11-15T04:00:00.000Z — single-route planning failure

The planner returned a journey that did not remain on the isolated route.

```json
{
  "slot": "2026-11-15T04:00:00.000Z",
  "origin": {
    "lat": 33.92372618927476,
    "lon": -83.34018934244651
  },
  "destination": {
    "lat": 33.9392773826834,
    "lon": -83.37633153288328
  },
  "routeId": "5740",
  "patternId": "reviewed:5740:0",
  "direction": "0",
  "fromStop": {
    "id": "221031",
    "name": "Barnett Shoals Rd. at Green Acres Northbound",
    "lat": 33.923669387,
    "lon": -83.340337113
  },
  "toStop": {
    "id": "155121",
    "name": "Driftmier Center Southbound",
    "lat": 33.9394,
    "lon": -83.3764
  },
  "fromIndex": 2,
  "toIndex": 15,
  "result": {
    "durationSeconds": 10299.250270019531,
    "walkingMeters": 316,
    "transfers": 2,
    "rides": [
      {
        "routeId": "5740",
        "direction": "0",
        "from": "221031",
        "to": "221035"
      },
      {
        "routeId": "5740",
        "direction": "0",
        "from": "221036",
        "to": "221037"
      },
      {
        "routeId": "5740",
        "direction": "0",
        "from": "155149",
        "to": "155121"
      }
    ]
  },
  "isolated": {
    "routes": [
      {
        "id": "5740",
        "agencyId": "uga",
        "operator": "uga",
        "name": "V | Vet Med",
        "shortName": "V|VM",
        "color": "#8582e1",
        "active": true,
        "availability": "current"
      }
    ],
    "patterns": [
      {
        "id": "reviewed:5740:0",
        "direction": "0",
        "stops": [
          "221039",
          "221028",
          "221031",
          "221030",
          "221034",
          "221035",
          "221036",
          "221037",
          "155149",
          "155156",
          "155158",
          "155094",
          "155088",
          "155116",
          "155119",
          "155121",
          "155137",
          "155134",
          "155160",
          "155150",
          "155159",
          "221026",
          "221027",
          "221038"
        ],
        "loop": true
      }
    ]
  },
  "calls": [
    {
      "method": "GET",
      "url": "https://d1dhvjc4b8xlgl.cloudfront.net/mobile-bus-data/busData.json",
      "status": "ok",
      "duration": 525
    },
    {
      "method": "GET",
      "url": "https://d1dhvjc4b8xlgl.cloudfront.net/mobile-bus-data/version.json",
      "status": "ok",
      "duration": 281
    },
    {
      "method": "GET",
      "url": "https://my.uga.edu/v4_19/cache/Buses",
      "status": "ok",
      "duration": 261
    },
    {
      "method": "GET",
      "url": "https://my.uga.edu/v4_19/cache/Routes",
      "status": "ok",
      "duration": 302
    }
  ],
  "version": {
    "version": 1086
  }
}
```

### Resolution

This was a monitor-contract failure, not a planner failure. The isolated network contained only route 5740 and every returned ride leg used route 5740, so the planner satisfied the requested one-route case. The monitor nevertheless failed because it allowed 300 m transfer walks and then required zero transfers; the fastest modeled journey legitimately walked between nearby stops and reboarded the same winding route.

The single-route check now disables transfer walking and continues to require one continuous ride. A regression using the exact 04:00 origin, destination, and reviewed Vet Med topology verifies that the planner returns route 5740 with zero transfers.
