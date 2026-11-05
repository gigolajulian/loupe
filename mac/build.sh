#!/bin/sh
# builds mac/bin/menubar (universal) for electron-builder's mac extraResources
set -e
cd "$(dirname "$0")"
mkdir -p bin
swiftc -O -target arm64-apple-macos12 menubar.swift -o bin/menubar-arm64
swiftc -O -target x86_64-apple-macos12 menubar.swift -o bin/menubar-x64
lipo -create bin/menubar-arm64 bin/menubar-x64 -output bin/menubar
rm bin/menubar-arm64 bin/menubar-x64
codesign --force --sign - bin/menubar
