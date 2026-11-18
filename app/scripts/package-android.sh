#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p build/artifacts
apk=android/app/build/outputs/apk/release/app-release.apk
test -f "$apk"

sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:?Set ANDROID_HOME to the Android SDK}}
build_tools=$(find "$sdk/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)
signer="$build_tools/apksigner"

if [[ -n ${ANDROID_KEYSTORE_BASE64:-}${ANDROID_KEYSTORE_PASSWORD:-}${ANDROID_KEY_ALIAS:-}${ANDROID_KEY_PASSWORD:-} ]]; then
  : "${ANDROID_KEYSTORE_BASE64:?Missing Android signing keystore}"
  : "${ANDROID_KEYSTORE_PASSWORD:?Missing Android signing store password}"
  : "${ANDROID_KEY_ALIAS:?Missing Android signing key alias}"
  : "${ANDROID_KEY_PASSWORD:?Missing Android signing key password}"
  keystore=$(mktemp "${RUNNER_TEMP:-/tmp}/tranuga-android.XXXXXX")
  trap 'rm -f "$keystore"' EXIT
  printf '%s' "$ANDROID_KEYSTORE_BASE64" | base64 --decode > "$keystore"
  output=build/artifacts/TranUGA-Android.apk
  "$signer" sign --ks "$keystore" --ks-key-alias "$ANDROID_KEY_ALIAS" \
    --ks-pass env:ANDROID_KEYSTORE_PASSWORD --key-pass env:ANDROID_KEY_PASSWORD \
    --out "$output" "$apk"
else
  output=build/artifacts/TranUGA-Android-preview.apk
  cp "$apk" "$output"
fi

"$signer" verify --print-certs "$output"
