#!/usr/bin/env bash
# Verifies without launching Nimrod, Pi or the packaged compiler.
set -euo pipefail
[[ $# -eq 2 ]] || { echo 'Usage: verify-release-macos.sh TARGET ARCH' >&2; exit 1; }
target=$1
arch=$2
case $arch in arm64) cpu=arm64 ;; x64) cpu=x86_64 ;; *) exit 1 ;; esac
: "${APPLE_TEAM_ID:?}" "${APPLE_API_KEY_PATH:?}" "${APPLE_API_KEY:?}" "${APPLE_API_ISSUER:?}"
bundle=src-tauri/target/$target/release/bundle
app=$bundle/macos/Nimrod.app
npm run verify:bundle -- "$app"
codesign --verify --deep --strict --verbose=2 "$app"
for binary in "$app" "$app/Contents/MacOS/esbuild"; do
  details=$(codesign -dv --verbose=4 "$binary" 2>&1)
  grep -Fx "TeamIdentifier=$APPLE_TEAM_ID" <<< "$details" >/dev/null
  grep -E '^Authority=Developer ID Application:' <<< "$details" >/dev/null
  grep -E '^CodeDirectory .*flags=.*runtime' <<< "$details" >/dev/null
done
for binary in nimrod esbuild; do
  [[ $(lipo -archs "$app/Contents/MacOS/$binary") == "$cpu" ]] || { echo "Wrong architecture: $binary" >&2; exit 1; }
done
[[ -x $app/Contents/Resources/bin/nimrod ]]
cmp bin/nimrod "$app/Contents/Resources/bin/nimrod"
xcrun stapler validate "$app"
spctl --assess --type execute --verbose=4 "$app"

# Tauri notarizes/staples the app, but only signs the containing DMG.
# Submit/staple the final DMG too; checksums must be taken AFTER stapling.
shopt -s nullglob
dmgs=("$bundle"/dmg/*.dmg)
[[ ${#dmgs[@]} -eq 1 ]] || { echo 'Expected exactly one DMG.' >&2; exit 1; }
dmg=${dmgs[0]}
codesign --verify --strict --verbose=2 "$dmg"
details=$(codesign -dv --verbose=4 "$dmg" 2>&1)
grep -Fx "TeamIdentifier=$APPLE_TEAM_ID" <<< "$details" >/dev/null
if ! xcrun notarytool submit "$dmg" --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" --wait --timeout 30m --output-format json > "$RUNNER_TEMP/nimrod-notary-result.json"; then
  cat "$RUNNER_TEMP/nimrod-notary-result.json"
  exit 1
fi
node --input-type=module -e '
  import { readFileSync } from "node:fs";
  const result = JSON.parse(readFileSync(process.argv[1], "utf8"));
  console.log("DMG notarization:", result.status, result.id);
  if (result.status !== "Accepted") process.exit(1);
' "$RUNNER_TEMP/nimrod-notary-result.json"
xcrun stapler staple "$dmg"
xcrun stapler validate "$dmg"
spctl --assess --type open --context context:primary-signature --verbose=4 "$dmg"
