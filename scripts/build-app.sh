#!/bin/bash
# 編譯並打包成 顧店.app（需要 Xcode 26 以上、macOS 26 以上、Apple 晶片）
set -euo pipefail
cd "$(dirname "$0")/.."

APP_NAME="顧店"
BUNDLE_ID="tw.gudian.app"
VERSION="${VERSION:-0.1.0}"
OUT="build/${APP_NAME}.app"

echo "▶︎ 編譯中…"
swift build -c release --arch arm64
BIN="$(swift build -c release --arch arm64 --show-bin-path)/GuDian"

echo "▶︎ 打包 ${OUT}"
rm -rf "$OUT"
mkdir -p "$OUT/Contents/MacOS" "$OUT/Contents/Resources"
cp "$BIN" "$OUT/Contents/MacOS/GuDian"

cat > "$OUT/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key><string>${APP_NAME}</string>
    <key>CFBundleDisplayName</key><string>${APP_NAME}</string>
    <key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
    <key>CFBundleExecutable</key><string>GuDian</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>${VERSION}</string>
    <key>CFBundleVersion</key><string>1</string>
    <key>CFBundleDevelopmentRegion</key><string>zh_TW</string>
    <key>LSMinimumSystemVersion</key><string>26.0</string>
    <key>LSApplicationCategoryType</key><string>public.app-category.business</string>
    <key>NSHighResolutionCapable</key><true/>
    <key>NSHumanReadableCopyright</key><string>顧店 Beta</string>
</dict>
</plist>
PLIST

echo "▶︎ Ad-hoc 簽章"
codesign --force --deep --sign - "$OUT"

echo "✅ 完成：$OUT"
echo "   打開：open \"$OUT\""
echo "   安裝：cp -R \"$OUT\" /Applications/"
