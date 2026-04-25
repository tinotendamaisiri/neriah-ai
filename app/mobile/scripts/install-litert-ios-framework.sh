#!/usr/bin/env bash
# install-litert-ios-framework.sh
#
# Copies the vendored LiteRT-LM iOS XCFramework from this repo into the
# react-native-litert-lm node_modules folder where CocoaPods expects it.
#
# Why this script exists: the upstream package has a postinstall that
# tries to download a prebuilt XCFramework from
# `github.com/hung-yueh/react-native-litert-lm/releases/download/vX.Y.Z/`,
# but no version 0.1.0 through 0.3.4 has ever published that asset
# (HTTP 404 confirmed Apr 2026). Without the framework, iOS builds link
# nothing and the LiteRT-LM Nitro module fails to resolve at runtime.
#
# So we keep our own prebuilt XCFramework in `vendor/litert-ios/`,
# committed to git, and copy it into node_modules on every `npm install`
# (chained from package.json's postinstall hook).
#
# This script is a no-op on non-macOS hosts because the upstream package
# only ships iOS native code on darwin anyway.

set -euo pipefail

if [ "$(uname)" != "Darwin" ]; then
  echo "[litert-ios] non-macOS host, skipping iOS framework install."
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VENDORED="$PROJECT_ROOT/vendor/litert-ios/LiteRTLM.xcframework"
DEST_DIR="$PROJECT_ROOT/node_modules/react-native-litert-lm/ios/Frameworks"

if [ ! -d "$VENDORED" ]; then
  echo "[litert-ios] No vendored XCFramework at $VENDORED — skipping (run scripts/build-ios-engine.sh in node_modules to build one and commit it)."
  exit 0
fi

if [ ! -d "$PROJECT_ROOT/node_modules/react-native-litert-lm" ]; then
  echo "[litert-ios] react-native-litert-lm not in node_modules — skipping."
  exit 0
fi

mkdir -p "$DEST_DIR"

# Skip the copy if the destination already has the same XCFramework.
# Cheap check: just compare the Info.plist file's modification time
# proxy via cmp.
if [ -d "$DEST_DIR/LiteRTLM.xcframework" ] && \
   cmp -s "$VENDORED/Info.plist" "$DEST_DIR/LiteRTLM.xcframework/Info.plist"; then
  echo "[litert-ios] XCFramework already in place, skipping copy."
  exit 0
fi

echo "[litert-ios] Copying LiteRTLM.xcframework into node_modules..."
rm -rf "$DEST_DIR/LiteRTLM.xcframework"
cp -R "$VENDORED" "$DEST_DIR/LiteRTLM.xcframework"
echo "[litert-ios] ✅ XCFramework installed. Run \`npx pod-install ios\` next."
