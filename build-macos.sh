#!/usr/bin/env bash
set -euo pipefail

version="${1:-dev}"
whisper_bundle_directory="${2:-}"
repo_root="$(cd "$(dirname "$0")" && pwd)"
bundle_version="${version#v}"
if [[ ! "$bundle_version" =~ ^[0-9]+([.][0-9]+){0,2}$ ]]; then
  bundle_version="0.0.0"
fi
mkdir -p "$repo_root/dist"
output_root="$(mktemp -d "$repo_root/dist/build-macos-XXXXXX")"
package_root="$output_root/EnglishLearnPath-macOS-Universal"
app_bundle="$package_root/English Learning Path.app"
stop_bundle="$package_root/结束学习中心.app"

for command_name in go lipo codesign ditto plutil; do
  command -v "$command_name" >/dev/null || { echo "$command_name is required" >&2; exit 1; }
done

mkdir -p "$app_bundle/Contents/MacOS" "$app_bundle/Contents/Resources" "$stop_bundle/Contents/MacOS"
build_root="$output_root/native-binaries"
mkdir -p "$build_root"

pushd "$repo_root/launcher" >/dev/null
for go_architecture in arm64 amd64; do
  CGO_ENABLED=0 GOOS=darwin GOARCH="$go_architecture" go build -trimpath -ldflags "-s -w -X main.appVersion=$version" -o "$build_root/EnglishLearnPath-$go_architecture" .
  CGO_ENABLED=0 GOOS=darwin GOARCH="$go_architecture" go build -trimpath -ldflags "-s -w" -o "$build_root/EnglishLearnPathStopper-$go_architecture" ./cmd/stopper
done
popd >/dev/null
lipo -create "$build_root/EnglishLearnPath-arm64" "$build_root/EnglishLearnPath-amd64" -output "$app_bundle/Contents/MacOS/EnglishLearnPath"
lipo -create "$build_root/EnglishLearnPathStopper-arm64" "$build_root/EnglishLearnPathStopper-amd64" -output "$stop_bundle/Contents/MacOS/EnglishLearnPathStopper"
chmod 0755 "$app_bundle/Contents/MacOS/EnglishLearnPath" "$stop_bundle/Contents/MacOS/EnglishLearnPathStopper"

cp -R "$repo_root/app" "$app_bundle/Contents/Resources/app"
cp -R "$repo_root/docs" "$app_bundle/Contents/Resources/docs"
cp "$repo_root/README.md" "$repo_root/LICENSE" "$repo_root/THIRD_PARTY_NOTICES.md" "$app_bundle/Contents/Resources/"
cp -R "$repo_root/third-party" "$app_bundle/Contents/Resources/third-party"

if [[ -z "$whisper_bundle_directory" ]]; then
  whisper_bundle_directory="$output_root/whisper-bundle"
  "$repo_root/build-whisper-macos.sh" "$whisper_bundle_directory"
fi
for required_file in whisper-cli ggml-small.en.bin LICENSE-whisper.cpp.txt LICENSE-Whisper.txt manifest.json whisper.cpp-source.zip; do
  [[ -s "$whisper_bundle_directory/$required_file" ]] || { echo "macOS package is missing $required_file" >&2; exit 1; }
done
whisper_architectures="$(lipo -archs "$whisper_bundle_directory/whisper-cli")"
for required_architecture in arm64 x86_64; do
  [[ " $whisper_architectures " == *" $required_architecture "* ]] || { echo "whisper-cli is missing $required_architecture" >&2; exit 1; }
done
cp -R "$whisper_bundle_directory" "$app_bundle/Contents/Resources/whisper"
chmod 0755 "$app_bundle/Contents/Resources/whisper/whisper-cli"

printf '%s\n' \
  '<?xml version="1.0" encoding="UTF-8"?>' \
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">' \
  '<plist version="1.0"><dict>' \
  '<key>CFBundleDevelopmentRegion</key><string>zh_CN</string>' \
  '<key>CFBundleDisplayName</key><string>English Learning Path</string>' \
  '<key>CFBundleExecutable</key><string>EnglishLearnPath</string>' \
  '<key>CFBundleIdentifier</key><string>io.github.duweiyu97.EnglishLearnPath</string>' \
  '<key>CFBundleInfoDictionaryVersion</key><string>6.0</string>' \
  '<key>CFBundleName</key><string>English Learning Path</string>' \
  '<key>CFBundlePackageType</key><string>APPL</string>' \
  "<key>CFBundleShortVersionString</key><string>$bundle_version</string>" \
  '<key>LSMinimumSystemVersion</key><string>12.0</string>' \
  '<key>LSUIElement</key><true/>' \
  '</dict></plist>' > "$app_bundle/Contents/Info.plist"

printf '%s\n' \
  '<?xml version="1.0" encoding="UTF-8"?>' \
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">' \
  '<plist version="1.0"><dict>' \
  '<key>CFBundleDevelopmentRegion</key><string>zh_CN</string>' \
  '<key>CFBundleDisplayName</key><string>结束学习中心</string>' \
  '<key>CFBundleExecutable</key><string>EnglishLearnPathStopper</string>' \
  '<key>CFBundleIdentifier</key><string>io.github.duweiyu97.EnglishLearnPath.stopper</string>' \
  '<key>CFBundleInfoDictionaryVersion</key><string>6.0</string>' \
  '<key>CFBundleName</key><string>结束学习中心</string>' \
  '<key>CFBundlePackageType</key><string>APPL</string>' \
  "<key>CFBundleShortVersionString</key><string>$bundle_version</string>" \
  '<key>LSMinimumSystemVersion</key><string>12.0</string>' \
  '<key>LSUIElement</key><true/>' \
  '</dict></plist>' > "$stop_bundle/Contents/Info.plist"

cp "$repo_root/README.md" "$repo_root/LICENSE" "$repo_root/THIRD_PARTY_NOTICES.md" "$package_root/"
cp -R "$repo_root/third-party" "$package_root/third-party"

if find "$package_root" -type f \( -name config.json -o -name 'EnglishLearnPath-data*.json' -o -name '*.dpapi' -o -name '*.secure' -o -name '.ai-credential-*' \) | grep -q .; then
  echo "macOS package contains private runtime data; build rejected" >&2
  exit 1
fi
if find "$package_root" -type f \( -name '*.md' -o -name '*.html' -o -name '*.css' -o -name '*.js' -o -name '*.json' -o -name '*.txt' -o -name '*.plist' \) -print0 | xargs -0 grep -EI '[A-Z]:\\(Users|summary)\\' >/dev/null; then
  echo "macOS package contains a developer-machine absolute path; build rejected" >&2
  exit 1
fi

codesign --force --deep --sign - "$app_bundle"
codesign --force --deep --sign - "$stop_bundle"
plutil -lint "$app_bundle/Contents/Info.plist" "$stop_bundle/Contents/Info.plist"
codesign --verify --deep --strict "$app_bundle"
codesign --verify --deep --strict "$stop_bundle"

zip_path="$repo_root/dist/EnglishLearnPath-macOS-Universal-Full-$version.zip"
if [[ -e "$zip_path" ]]; then
  zip_path="$repo_root/dist/EnglishLearnPath-macOS-Universal-Full-$version-$(date +%Y%m%d-%H%M%S).zip"
fi
ditto -c -k --sequesterRsrc --keepParent "$package_root" "$zip_path"
echo "$zip_path"
