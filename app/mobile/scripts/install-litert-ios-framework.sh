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

# Skip the XCFramework copy if the destination already has it (large
# directory copy — only worth doing when there's a real change).
if [ -d "$DEST_DIR/LiteRTLM.xcframework" ] && \
   cmp -s "$VENDORED/Info.plist" "$DEST_DIR/LiteRTLM.xcframework/Info.plist"; then
  echo "[litert-ios] XCFramework already in place, skipping copy."
else
  echo "[litert-ios] Copying LiteRTLM.xcframework into node_modules..."
  rm -rf "$DEST_DIR/LiteRTLM.xcframework"
  cp -R "$VENDORED" "$DEST_DIR/LiteRTLM.xcframework"
fi

# Vendored Hybrid wrapper patches:
#   - tryCreateEngine accepts a third audioBackend arg and we call it with
#     nullptr, nullptr for vision and audio. Skips multimodal executor
#     init that crashes on iOS because the Bazel-built XCFramework lacks
#     vision and audio ops. Text-only inference works after the patch.
#   - Three calls to litert_lm_get_last_error() commented out (symbol not
#     in our XCFramework export list).
# We vendor the whole HybridLiteRTLM.cpp (small file, ~24 KB) instead of
# carrying a patch, because patch-package failed to parse the diff for
# this version of the package.
PATCHED_CPP="$PROJECT_ROOT/vendor/litert-cpp/HybridLiteRTLM.cpp"
DEST_CPP="$PROJECT_ROOT/node_modules/react-native-litert-lm/cpp/HybridLiteRTLM.cpp"
if [ -f "$PATCHED_CPP" ] && [ -d "$(dirname "$DEST_CPP")" ]; then
  cp "$PATCHED_CPP" "$DEST_CPP"
  echo "[litert-ios] Replaced HybridLiteRTLM.cpp with vendored patched copy."
fi

echo "[litert-ios] ✅ XCFramework + wrapper installed. Run \`npx pod-install ios\` next."
