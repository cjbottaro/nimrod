#!/usr/bin/env bash
# GitHub-hosted, disposable macOS runners only. Never invoke on a developer Mac.
set -euo pipefail
[[ ${GITHUB_ACTIONS:-} == true && ${RUNNER_OS:-} == macOS ]] || { echo 'Signing setup requires a GitHub macOS runner.' >&2; exit 1; }
for name in APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD APPLE_SIGNING_IDENTITY APPLE_TEAM_ID APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_P8; do
  [[ -n ${!name:-} ]] || { echo "Missing release secret: $name" >&2; exit 1; }
done
[[ $APPLE_SIGNING_IDENTITY == 'Developer ID Application: '* ]] || { echo 'A Developer ID Application identity is required.' >&2; exit 1; }
umask 077
keychain=$RUNNER_TEMP/nimrod-signing.keychain-db
certificate=$RUNNER_TEMP/nimrod-signing.p12
api_key=$RUNNER_TEMP/nimrod-notarization.p8
password=$(openssl rand -hex 32)
printf '::add-mask::%s\n' "$password"
printf '%s' "$APPLE_CERTIFICATE" | /usr/bin/base64 -D > "$certificate"
printf '%s\n' "$APPLE_API_KEY_P8" > "$api_key"
security create-keychain -p "$password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$password" "$keychain"
security import "$certificate" -k "$keychain" -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$password" "$keychain" >/dev/null
security list-keychains -d user -s "$keychain" "$HOME/Library/Keychains/login.keychain-db"
security find-identity -v -p codesigning "$keychain" | grep -F -- "\"$APPLE_SIGNING_IDENTITY\"" >/dev/null
printf 'APPLE_API_KEY_PATH=%s\n' "$api_key" >> "$GITHUB_ENV"
rm -f "$certificate"
