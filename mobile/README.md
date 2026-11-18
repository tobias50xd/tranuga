# TranUGA for iOS and Android

TranUGA Mobile uses React Native with Expo Router and MapLibre. It shares the web app's transit adapters, route feed selector, and trip-planning algorithm. Browse and favorite routes, inspect live buses and stop arrivals, switch between the configured Georgia and Ohio networks, and plan trips from stop names, addresses, coordinates, your location, or a point on the map.

## Run locally

Use Node.js 22. Install Android Studio and JDK 17 for Android development, or Xcode 26.2 and CocoaPods on macOS for iOS.

```sh
cd mobile
npm ci
npm run android
# On macOS, for iOS
npm run ios
```

The commands generate the native projects and launch a development build. MapLibre requires a native build. For subsequent JavaScript changes, run `npm start` and open the installed development build.

The app defaults to the production TranUGA gateway and OpenStreetMap tiles. Copy `.env.example` to `.env.local` to replace the public endpoint or MapLibre style URL. A physical device must be able to reach the configured gateway. The Actions variables `MOBILE_TRANSIT_URL` and `MOBILE_MAP_STYLE_URL` apply these overrides to CI bundles. The existing gateway handles transit requests and address lookups. You can choose a different tile service by supplying a compatible MapLibre style URL.

```sh
npm run typecheck
npm run lint
```

## Download builds from GitHub Actions

Open a successful **Build and release mobile apps** workflow run. Download the relevant artifact and unzip the outer artifact archive.

| Artifact | Package | How to run |
| --- | --- | --- |
| `tranuga-android` | `TranUGA-Android-preview.apk` for regular CI runs, or `TranUGA-Android.apk` for signed releases | Open the APK on Android or run `adb install path/to/TranUGA-Android-preview.apk`. |
| `tranuga-ios-simulator` | `TranUGA-iOS-Simulator.zip` | On a Mac, boot an iOS Simulator, unzip the app, then run `xcrun simctl install booted TranUGA.app` and `xcrun simctl launch booted com.tranuga.app`. |
| `tranuga-ios-device` | `TranUGA-iOS-AdHoc.ipa` from a configured signed release | Install with Xcode's Devices and Simulators window or Apple Configurator on a device registered in the provisioning profile. |

The preview APK uses Expo's debug signing key. Use a dedicated release key for public Android distribution and upgrades. Switching between preview and release keys on the same device requires uninstalling the existing app first. The iOS Simulator app requires a Mac with a compatible simulator runtime.

## Publish release assets

Both builds run on incoming mobile or shared transit changes. A pushed tag matching the version in `mobile/package.json`, such as `mobile-v1.0.0`, publishes the APK and simulator zip to a GitHub Release after both builds pass. The workflow includes the signed iOS package when Apple signing is configured. A release without both production signing configurations is marked as a prerelease. The workflow uses the GitHub run number as the native build number. Publishing to Google Play or TestFlight uses the respective store's submission process.

| Platform | GitHub Actions secrets for release signing |
| --- | --- |
| Android | `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` |
| iOS | `IOS_CERTIFICATE_BASE64`, `IOS_CERTIFICATE_PASSWORD`, `IOS_PROFILE_BASE64` |

Use the same Android keystore and alias for successive releases. For iOS, export the Apple Distribution certificate and private key as a password-protected PKCS#12 file. Create an Apple **Ad Hoc** provisioning profile for bundle ID `com.tranuga.app` with the destination device IDs registered. Base64-encode the binary keystore, certificate, and profile before saving the corresponding secrets. Leave all signing secrets for a platform unset to use its preview or simulator build. A partial signing configuration fails the corresponding release job. [GitHub's Apple signing guide](https://docs.github.com/en/actions/how-tos/deploy/deploy-to-third-party-platforms/sign-xcode-applications)
