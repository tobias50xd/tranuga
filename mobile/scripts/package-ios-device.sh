#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z ${IOS_CERTIFICATE_BASE64:-}${IOS_CERTIFICATE_PASSWORD:-}${IOS_PROFILE_BASE64:-} ]]; then
  printf '%s\n' 'No Apple signing credentials configured. The iOS Simulator build is available.'
  exit 0
fi
: "${IOS_CERTIFICATE_BASE64:?Missing Apple signing certificate}"
: "${IOS_CERTIFICATE_PASSWORD:?Missing Apple signing certificate password}"
: "${IOS_PROFILE_BASE64:?Missing Apple ad hoc provisioning profile}"

temp=$(mktemp -d "${RUNNER_TEMP:?Use a GitHub Actions macOS runner}/tranuga-ios.XXXXXX")
keychain="$temp/signing.keychain-db"
keychain_password=$(openssl rand -hex 24)
profile_location=
original_keychains=()
while IFS= read -r path; do original_keychains+=("$path"); done < <(security list-keychains -d user | sed -E 's/^[[:space:]]*"(.+)"$/\1/')

cleanup() {
  if [[ ${#original_keychains[@]} -gt 0 ]]; then security list-keychains -d user -s "${original_keychains[@]}"; fi
  security delete-keychain "$keychain" 2>/dev/null || true
  if [[ -n "$profile_location" ]]; then rm -f "$profile_location"; fi
  rm -rf "$temp"
}
trap cleanup EXIT

printf '%s' "$IOS_CERTIFICATE_BASE64" | base64 -D > "$temp/certificate.p12"
printf '%s' "$IOS_PROFILE_BASE64" | base64 -D > "$temp/device.mobileprovision"
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 3600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
security list-keychains -d user -s "$keychain" "${original_keychains[@]}"
security import "$temp/certificate.p12" -P "$IOS_CERTIFICATE_PASSWORD" -A -t cert -f pkcs12 -k "$keychain"
security set-key-partition-list -S apple-tool:,apple: -s -k "$keychain_password" "$keychain"

security cms -D -i "$temp/device.mobileprovision" > "$temp/profile.plist"
plist=/usr/libexec/PlistBuddy
team=$("$plist" -c 'Print TeamIdentifier:0' "$temp/profile.plist")
uuid=$("$plist" -c 'Print UUID' "$temp/profile.plist")
profile_name=$("$plist" -c 'Print Name' "$temp/profile.plist")
app_id=$("$plist" -c 'Print Entitlements:application-identifier' "$temp/profile.plist")
if [[ "$app_id" != "$team.com.tranuga.app" ]] || ! "$plist" -c 'Print ProvisionedDevices:0' "$temp/profile.plist" >/dev/null || \
   [[ $("$plist" -c 'Print Entitlements:get-task-allow' "$temp/profile.plist") != false ]]; then
  printf '%s\n' 'An ad hoc distribution profile for com.tranuga.app with at least one registered device is required.' >&2
  exit 1
fi

profiles="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
mkdir -p "$profiles"
profile_location="$profiles/$uuid.mobileprovision"
cp "$temp/device.mobileprovision" "$profile_location"

ruby -rxcodeproj - ios/TranUGA.xcodeproj "$team" "$profile_name" "$temp/ExportOptions.plist" <<'RUBY'
project = Xcodeproj::Project.open(ARGV.fetch(0))
app = project.targets.find { |target| target.name == 'TranUGA' }
abort 'TranUGA app target is missing' unless app
app.build_configurations.each do |configuration|
  next unless configuration.name == 'Release'
  configuration.build_settings.merge!(
    'CODE_SIGN_STYLE' => 'Manual',
    'DEVELOPMENT_TEAM' => ARGV.fetch(1),
    'CODE_SIGN_IDENTITY' => 'Apple Distribution',
    'PROVISIONING_PROFILE_SPECIFIER' => ARGV.fetch(2)
  )
end
project.save
options = {
  'method' => 'release-testing', 'signingStyle' => 'manual', 'teamID' => ARGV.fetch(1),
  'signingCertificate' => 'Apple Distribution',
  'provisioningProfiles' => { 'com.tranuga.app' => ARGV.fetch(2) }
}
Xcodeproj::Plist.write_to_path(options, ARGV.fetch(3))
RUBY

xcodebuild archive -workspace ios/TranUGA.xcworkspace -scheme TranUGA -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$temp/TranUGA.xcarchive" -quiet
xcodebuild -exportArchive -archivePath "$temp/TranUGA.xcarchive" -exportPath "$temp/export" \
  -exportOptionsPlist "$temp/ExportOptions.plist" -quiet
mkdir -p build/artifacts
cp "$temp/export/TranUGA.ipa" build/artifacts/TranUGA-iOS-AdHoc.ipa
