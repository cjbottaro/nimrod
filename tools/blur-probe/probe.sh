#!/bin/bash
# Explicit native-only diagnostic; never builds or launches Nimrod.
set -euo pipefail
cd "$(dirname "$0")/../.."
root="$PWD"
app="$root/tmp/blur-probe/Nimrod Blur Probe.app"
case "${1:-}" in
  build)
    mkdir -p "$app/Contents/MacOS"
    cp tools/blur-probe/Info.plist "$app/Contents/Info.plist"
    xcrun clang -fobjc-arc -O1 -Wall tools/blur-probe/main.m \
      -o "$app/Contents/MacOS/probe" \
      -framework Cocoa -framework WebKit -framework ScreenCaptureKit \
      -framework QuartzCore -framework CoreMedia -framework CoreVideo -framework ImageIO
    # Stable diagnostic-only identity, not Nimrod's signing configuration.
    # Use it before the first TCC grant; toggling an older cdhash-based grant
    # does not update that grant's stored requirement.
    codesign --force --sign - --requirements '=designated => identifier "dev.nimrod.blur-probe"' "$app"
    ;;
  run)
    output="${2:?Usage: probe.sh run OUTPUT_DIRECTORY [batch|plain] [style0]}"
    mkdir -p "$output"
    output="$(cd "$output" && pwd)"
    if [[ -e "$output/frames.csv" ]]; then echo 'Choose a fresh capture directory.' >&2; exit 2; fi
    # LaunchServices gives the probe its own TCC attribution rather than using
    # the terminal/Nimrod process that happens to host the coding session.
    open -W -n --stdout "$output/stdout.log" --stderr "$output/probe.log" \
      "$app" --args "$output" "${3:-plain}" "${4:-standard}"
    grep -q 'COMPLETE .* error=(null)' "$output/probe.log" || {
      echo "Probe did not complete; inspect $output/probe.log (first run may need Screen Recording approval)." >&2
      exit 1
    }
    ;;
  *) echo 'Usage: tools/blur-probe/probe.sh build | run OUTPUT_DIRECTORY [batch|plain] [style0]' >&2; exit 2 ;;
esac
