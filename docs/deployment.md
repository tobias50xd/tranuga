# Deploy TranUGA

The Expo project in [app/](../app/) produces the React website and the React Native binaries. All three builds use the same commit and app lockfile. [GitHub Actions workflow](../.github/workflows/mobile.yml)

## Website

GitHub Actions tests the shared app on code changes and saves the tested website as an artifact. A version tag publishes the native packages and deploys the web artifact from that run. Set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the repository or its `production` environment. The token needs access to deploy the Worker in that account. If the environment restricts deploys by branch or tag, allow the `mobile-v*` release tags.

```sh
npm ci
npm ci --prefix app
npm run build
npx wrangler deploy --dry-run --outdir /tmp/tranuga-worker
```

The Expo export writes a single-page app to `dist/`. Cloudflare serves deep links through the SPA fallback, and the Worker handles `/api` and `/api/places` on the same origin. The [static headers](../app/public/_headers) travel with the export. For an integrated local preview, run `npm run dev:edge` after building. The production address is printed by the deploy job.

The gateway accepts reviewed public transit requests and explicit address searches. It enforces upstream origins, methods, and argument shapes, and caches public feed reads according to the provider endpoint. [Gateway policy](../worker/index.ts) · [Snapshot retention](replication.md)

## Android and iOS

The shared workflow produces two native GitHub Actions artifacts on app changes. Download the outer artifact archive, then install the package inside.

| Artifact | Package and installation |
| --- | --- |
| `tranuga-android` | Open the preview APK on Android or use `adb install`. Signed release builds use the configured Android distribution key. |
| `tranuga-ios-simulator` | Unzip the app on a Mac with an iOS Simulator, then run `xcrun simctl install booted TranUGA.app`. |
| `tranuga-ios-device` | Install the signed ad hoc IPA on a device listed in the provisioning profile. This artifact requires Apple signing credentials. |

Push a `mobile-v` tag matching [app/package.json](../app/package.json) to ship the web build and the native downloads together. Both native builds and the web checks must pass before the workflow publishes a release. Incomplete distribution signing produces a prerelease with the available packages. CI uses the run number as the native build number.

| Platform | Optional GitHub Actions secrets for distribution |
| --- | --- |
| Android | `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` |
| iOS | `IOS_CERTIFICATE_BASE64`, `IOS_CERTIFICATE_PASSWORD`, `IOS_PROFILE_BASE64` |

Keep the Android signing key for future upgrades. For iOS, use a password-protected Apple Distribution PKCS#12 export and an ad hoc profile for `com.tranuga.app`. Store the keystore, certificate, and profile as Base64 in the designated secrets. Use the Actions variable `MOBILE_TRANSIT_URL` to point a native build at a different HTTPS TranUGA gateway. [GitHub Apple signing guide](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications)
