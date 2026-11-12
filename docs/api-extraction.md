# Bus API extraction notes

This document records the bus-information APIs used by the two supplied APK sets, how they were recovered, and whether the requests are authenticated. The results are based on static call-site analysis plus read-only requests made on **2026-11-12 UTC**.

## APKs examined

| App | Package | Version | Input SHA-256 |
|---|---|---:|---|
| UGA | `edu.uga.eits.portal.mobiledev` | 7.8.10 | `5006bc7db132237da3eb36196977d15c14e7492e1d9b71d6766459067c9d0104` (`UGA-7.8.10-arm64.apks`) |
| myStop | `com.AvailTec.MyStop` | 4.31.8 | `c2640ec2afc29c1eaa56d584b9abafbe2f1c38cec4838352bb14b4ea0c32556b` (`myStop-4.31.8-arm64.apks`) |

An `.apks` file is a ZIP containing a base APK and device-specific splits. The relevant UGA Kotlin bytecode is in `base.apk`. The myStop `base.apk` contains the React Native bundle; its ARM64 split mostly contains the Hermes/React Native native libraries.

## Result in brief

The bus-information APIs in both apps are public GET endpoints. The recovered bus call sites do not attach a bearer token, API key, Basic credentials, or a custom authentication header. Direct requests without credentials returned HTTP 200.

This conclusion is specifically about bus data. Other, unrelated features in the same apps do use authentication or API keys:

- UGA student/eLC requests use bearer tokens, but the bus Retrofit methods do not declare an `Authorization` header.
- myStop's optional Token Transit ticket-purchasing integration uses a bearer token, an API-key header, an API-version header, and a device ID. Those headers are not used by the InfoPoint bus-data calls.
- Both apps contain third-party configuration for services such as Google Maps and Firebase. It is not required for the bus endpoints below.

No embedded third-party key value is reproduced in this document.

## UGA API

### Live and ETA data

Base URL: `https://my.uga.edu/`

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `v4_19/cache/Buses` | Current vehicles. Includes vehicle/route/trip/stop IDs, coordinates, speed, heading, passenger load, next stops, and update timestamps. |
| GET | `v4_19/cache/Routes` | Route IDs, names, colors, active state, and UGA/Athens classification. |
| GET | `v4_19/cache/routeTracking_{routeId}` | Ordered stops and predicted epoch-millisecond arrival times for a route. `busLocations` relates active buses to positions in the returned stop sequence. |
| GET | `v4_19/cache/stop_{stopId}` | Predicted times at a stop, grouped by route/direction. |

Example identifiers observed during validation were route `5750` and stop `155104`; identifiers and live data can change.

```sh
curl -sS 'https://my.uga.edu/v4_19/cache/Buses'
curl -sS 'https://my.uga.edu/v4_19/cache/Routes'
curl -sS 'https://my.uga.edu/v4_19/cache/routeTracking_5750'
curl -sS 'https://my.uga.edu/v4_19/cache/stop_155104'
```

### Static network/topology data

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `https://d1dhvjc4b8xlgl.cloudfront.net/mobile-bus-data/version.json` | Version number for the static bus dataset. |
| GET | `https://d1dhvjc4b8xlgl.cloudfront.net/mobile-bus-data/busData.json` | Static topology: trip-to-route mappings, stop sequences, shapes, stops, route-stop relations, and routes. |

The APK also includes `res/raw/bus_data.json`, `res/raw/route_shapes_encoded_v4_01.json`, and related resources as local data/fallbacks; these are assets, not network APIs.

### UGA authentication evidence

- `Restapi.getBuses`, `getRoutes`, `getRoutestops`, and `getStopEtas` have only `@GET` and path annotations. They have no `@Header` parameter and no static `@Headers` authentication value.
- The shared OkHttp client has a cookie jar, but its `TokenInterceptor` only observes a `401` response and clears shared app auth state. It does not add or modify any request header.
- The two CloudFront calls only add `Cache-Control: no-cache` in the app.
- All six endpoints above returned HTTP 200 in direct requests with no token, API key, Authorization header, or pre-existing cookie.

Therefore the UGA bus API does **not** require the app's login token. A cookie may be accepted by the shared HTTP stack, but it was not needed in validation and is not added specifically by the bus methods.

## myStop / Avail InfoPoint API

myStop is a multi-agency client. It first discovers an authority, stores the selected authority object under the misleading name `TransitAuth`, and then uses that object's `RestUrl`. `TransitAuth` is agency configuration, not an authentication credential.

### Authority discovery

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `http://mobilegateway.rideralerts.com/gateway/TransitAuthorities` | List authorities and each authority's `RestUrl`, map center, logo, mobile URL, and SMS settings. |
| GET | `http://mobilegateway.rideralerts.com/gateway/TransitAuthorities/Locate?Lat={lat}&long={lon}` | Find an authority near a coordinate. The app uses lowercase `long`. |
| GET | `http://mobilegateway.rideralerts.com/gateway/TransitAuthorities/?includeHiddenPropertyCode=@{code}` | Look up an authority by the user-entered authority/property code. The code is a selector, not a bearer token. |

The app explicitly uses cleartext HTTP for discovery and permits cleartext traffic in its Android manifest. The discovery server set an `ARRAffinity` load-balancer cookie during validation; that cookie is routing affinity, not authentication. A request with no prior cookie or credentials succeeded.

### Per-authority endpoints

Set `{restBase}` to the discovered `RestUrl`. For example, the discovery response returned `https://realtime.catabus.com/InfoPoint/rest` for CATA.

| Method | Endpoint relative to `{restBase}` | Purpose |
|---|---|---|
| GET | `/TransitAuthorityConfig/Get` | Authority configuration, including base/KML URLs, map bounds, capabilities, and refresh interval. |
| GET | `/Routes/GetAllRoutes` | Routes and their current `Vehicles`. Vehicle objects include position, heading, speed, route/trip/vehicle IDs, destination, occupancy, deviation, and update time. |
| GET | `/Routes/GetVisibleRoutes` | Visible routes, current vehicles, and route messages. |
| GET | `/RouteDetails/Get/{routeId}` | One route with directions, stops, route-stop relations, messages, trace filename, and vehicles. |
| GET | `/RouteDetails/GetAllRouteDetails` | Detailed data for all routes. |
| GET | `/RouteDetails/GetDirectionsByRouteID/{routeId}` | Directions available for a route. |
| GET | `/RouteDetails/GetStopsForRouteDirection/?routeid={routeId}&direction={direction}&timepointsOnly=false` | Ordered stops for one route direction. |
| GET | `/Stops/GetAllStops` | All stops with names and coordinates. |
| GET | `/Stops/GetAllStopsForRoutes?routeIDs={routeIds}` | Stops served by the supplied route ID or ID list. |
| GET | `/Stops/Get/{stopId}` | Details for one stop. |
| GET | `/StopDepartures/Get/{stopId}` | Real-time/scheduled departures, ETA/EDT values, route directions, trip data, and update time. |
| GET | `/PublicMessages/GetCurrentMessages` | Current public/service messages. |

There is no separate vehicle endpoint in this client: live vehicles are embedded in the route responses.

Route geometry is fetched outside `RestUrl` as:

```text
{config.BaseUrl}{config.KmlUrl}{urlEncodedRouteTraceFilename}
```

For the validated CATA example, `.../Resources/Traces/Route51.kml` returned KML without credentials.

Example requests:

```sh
curl -sS 'http://mobilegateway.rideralerts.com/gateway/TransitAuthorities'

rest_base='https://realtime.catabus.com/InfoPoint/rest'
curl -sS "$rest_base/Routes/GetVisibleRoutes"
curl -sS "$rest_base/RouteDetails/Get/51"
curl -sS "$rest_base/Stops/GetAllStops"
curl -sS "$rest_base/StopDepartures/Get/1"
```

Agency support and IDs vary. Discover the authority and read its config/routes before substituting IDs.

### myStop authentication evidence

- Every recovered bus-information call invokes `fetch(url)` with no request-options object. No headers are supplied.
- The discovery calls are also bare `fetch(url)` requests.
- The CATA authority config returned empty `ApiKey` and `ApiKeyHeader` fields.
- Discovery, config, routes/vehicles, stops, stop departures, route directions, and KML all returned HTTP 200 without credentials or a prior cookie.
- The bundle's `Authorization: Bearer`, Token Transit API headers, and device-ID logic occur in the separate fare/ticketing module and target `https://api.tokentransit.com`, not the InfoPoint endpoints.

Therefore the extracted myStop bus-information API does **not** use a token or other client authentication in this app. A particular authority could change its server policy independently, so callers should handle `401`, `403`, and endpoint changes.

## Extraction approach

1. Preserved the inputs and calculated SHA-256 hashes so findings can be tied to exact APK versions.
2. Listed the `.apks` ZIP members and identified the base and configuration splits.
3. Decoded both manifests to establish package/version information, network permissions, and cleartext policy.
4. Decompiled UGA's DEX files with JADX 1.5.6. The relevant evidence is in:
   - `edu.uga.eits.android.api.Restapi` for Retrofit endpoint declarations;
   - `edu.uga.eits.android.model.Constants` for the Retrofit base URL;
   - `edu.uga.eits.android.model.ModelExtensionKt` and `TokenInterceptor` for client/interceptor behavior.
5. Extracted `assets/index.android.bundle` from myStop. It is Hermes bytecode version 96, so ordinary Java decompilation cannot recover its API module. Parsed, disassembled, and decompiled it with `hermes-dec` 0.1.8, then traced the API wrapper's `fetch` calls, URL construction, and request options.
6. Searched authentication-relevant call sites for `Authorization`, `Bearer`, token/API-key names, interceptors, cookies, and request headers. This separated bus-data calls from login, maps, analytics, and ticket-purchasing integrations.
7. Sent read-only, unauthenticated GET requests to representative discovered endpoints and checked status, content type, and response shape. No writes, subscriptions, feedback submissions, ticket purchases, or login attempts were made.

Representative reproduction commands:

```sh
sha256sum apks/*.apks apks/*/base.apk
unzip -l apks/myStop-4.31.8-arm64/base.apk

jadx -d out/uga apks/UGA-7.8.10-arm64/base.apk
rg -n '@GET|@Header|baseUrl|Authorization|TokenInterceptor' out/uga/sources/edu/uga/eits/android

unzip -p apks/myStop-4.31.8-arm64/base.apk \
  assets/index.android.bundle > index.android.bundle
hbc-file-parser index.android.bundle > myStop-hbc.txt
hbc-disassembler index.android.bundle myStop.hasm
hbc-decompiler index.android.bundle myStop.js
rg -n 'Routes/Get|Stops/Get|StopDepartures|Authorization|Bearer|Api-Key' \
  myStop.js myStop-hbc.txt
```

## Operational cautions

These appear to be app-internal, undocumented APIs rather than a published compatibility contract. Paths, versions, fields, and availability may change without notice. Cache politely, follow each operator's terms, avoid high-frequency polling, and prefer an official GTFS/GTFS-Realtime feed when an operator publishes one. The myStop discovery URL is cleartext HTTP, so its response can be observed or modified in transit; do not treat authority metadata from that connection as security-sensitive or trusted without independent verification.
