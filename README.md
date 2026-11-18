# TranUGA

TranUGA shows live buses, stop arrivals, and estimated transit trips. One React app in [app/](app/) runs on the web through React DOM and React Native Web, and on Android and iOS through React Native.

## Use the app

- **Routes** shows the network catalog, active-service filters, favorites, stops, arrivals, and live buses. The map shows each bus's heading inside a route-colored badge and uses grey for last-known positions.
- **Plan** accepts stop names, addresses, decimal coordinates, map points, or your device location. Results include walking, waits, transfers, the ridden route segments, and estimated timing.
- **Networks** lets you switch providers, search the agency directory, look up an authority code, and find nearby networks. It also contains Dark mode, data-source health, manual sync, and available provider details.
- **Map controls** center on your device location on request. Route lock fits the selected route or journey and keeps part of it in view while you pan or zoom.

Live route maps check eligible feeds before a 15-second update and display one endpoint's fleet per route. The planner uses the shared directed transit graph, current predictions, and explicitly labeled estimates. [Feed selection and fallbacks](docs/replication.md)

## Run and test

Use Node.js 22 or newer and install both locked packages.

```sh
npm ci
npm ci --prefix app
npm run dev                 # Build the website and serve it with the local gateway
npm --prefix app run android
npm --prefix app run ios    # macOS with Xcode and CocoaPods
```

```sh
npx playwright install chromium
npm run check
```

The browser checks run against the exported shared app with mocked transit providers. The native workflow builds the same screens into Android and iOS packages. [Deploy, download, and sign builds](docs/deployment.md)

## Where to make changes

| Path | Owns |
| --- | --- |
| [app/src/app/](app/src/app/) | Shared screens and navigation |
| [app/src/components/](app/src/components/) | Shared UI, theme, map annotations, and the map renderer for each platform |
| [src/](src/) | Transit APIs, feed selection, topology, and trip calculations |
| [worker/](worker/) | Cloudflare gateway, including upstream request policy and caching |
| [tests/](tests/) | Planner, provider, gateway, and browser tests |

Change shared screens and components for features and visual updates. Keep platform code in the map renderers and device integration where the browser and native APIs differ. The web URLs are `/routes`, `/routes/{routeId}`, `/plan`, and `/networks`.

[Provider contracts](docs/api-extraction.md) · [Passio contracts](docs/passio-api.md) · [API validation](docs/api-validation.md)

Map data copyright belongs to [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). TranUGA is an independent app. [Code license](LICENSE)
