#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")" && pwd)"
output_directory="${1:-$repo_root/dist/whisper-macos-universal}"
source_archive="${2:-}"
model_path="${3:-}"
revision="371b5a7561823ab2bb32142d2751e35e7534727b"
model_hash="c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d"
source_url="https://codeload.github.com/ggml-org/whisper.cpp/zip/$revision"
model_url="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin"
download_cache="${ELP_DOWNLOAD_CACHE:-$HOME/Library/Caches/EnglishLearnPath-build}"

if [[ -e "$output_directory" ]]; then
  echo "Output directory already exists; choose a fresh directory. No files have been removed." >&2
  exit 1
fi
for command_name in cmake curl ditto lipo otool shasum; do
  command -v "$command_name" >/dev/null || { echo "$command_name is required" >&2; exit 1; }
done

mkdir -p "$(dirname "$output_directory")" "$output_directory" "$download_cache"
work_directory="$(mktemp -d "${TMPDIR:-/tmp}/elp-whisper.XXXXXX")"
trap 'rm -rf "$work_directory"' EXIT
archive="$work_directory/whisper-source.zip"

if [[ -n "$source_archive" ]]; then
  cp "$source_archive" "$archive"
else
  cached_archive="$download_cache/whisper.cpp-$revision.zip"
  if [[ ! -s "$cached_archive" ]]; then
    temporary_archive="$cached_archive.download"
    curl --fail --location --retry 3 --output "$temporary_archive" "$source_url"
    mv "$temporary_archive" "$cached_archive"
  fi
  cp "$cached_archive" "$archive"
fi

ditto -x -k "$archive" "$work_directory"
source_directory="$work_directory/whisper.cpp-$revision"
build_directory="$work_directory/build"
cmake -S "$source_directory" -B "$build_directory" \
  -DCMAKE_BUILD_TYPE=Release \
  '-DCMAKE_OSX_ARCHITECTURES=arm64;x86_64' \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=12.0 \
  -DBUILD_SHARED_LIBS=OFF \
  -DGGML_NATIVE=OFF \
  -DGGML_OPENMP=OFF \
  -DWHISPER_BUILD_TESTS=OFF \
  -DWHISPER_BUILD_SERVER=OFF
cmake --build "$build_directory" --config Release --target whisper-cli --parallel 4

engine_source="$(find "$build_directory" -type f -name whisper-cli | head -n 1)"
if [[ -z "$engine_source" ]]; then
  echo "whisper-cli was not produced" >&2
  exit 1
fi
engine_architectures="$(lipo -archs "$engine_source")"
for required_architecture in arm64 x86_64; do
  [[ " $engine_architectures " == *" $required_architecture "* ]] || { echo "whisper-cli is missing $required_architecture" >&2; exit 1; }
done
if otool -L "$engine_source" | awk '/^[[:space:]]/{print $1}' | grep -Ev '^(/usr/lib/|/System/Library/)' | grep -q .; then
  echo "whisper-cli has a non-system dynamic library dependency" >&2
  otool -L "$engine_source" >&2
  exit 1
fi
cp "$engine_source" "$output_directory/whisper-cli"
chmod 0755 "$output_directory/whisper-cli"

model="$output_directory/ggml-small.en.bin"
if [[ -n "$model_path" ]]; then
  cp "$model_path" "$model"
else
  cached_model="$download_cache/ggml-small.en-$model_hash.bin"
  if [[ ! -s "$cached_model" ]]; then
    temporary_model="$cached_model.download"
    curl --fail --location --retry 3 --output "$temporary_model" "$model_url"
    mv "$temporary_model" "$cached_model"
  fi
  cp "$cached_model" "$model"
fi
actual_model_hash="$(shasum -a 256 "$model" | awk '{print $1}')"
if [[ "$actual_model_hash" != "$model_hash" ]]; then
  echo "Whisper model SHA256 mismatch; bundle rejected" >&2
  exit 1
fi

cp "$source_directory/LICENSE" "$output_directory/LICENSE-whisper.cpp.txt"
cp "$repo_root/third-party/LICENSE-Whisper.txt" "$output_directory/LICENSE-Whisper.txt"
cp "$archive" "$output_directory/whisper.cpp-source.zip"
engine_hash="$(shasum -a 256 "$output_directory/whisper-cli" | awk '{print $1}')"
printf '%s\n' \
  '{' \
  '  "engine": "whisper.cpp",' \
  "  \"revision\": \"$revision\"," \
  "  \"source\": \"$source_url\"," \
  '  "model": "small.en",' \
  "  \"modelSource\": \"$model_url\"," \
  "  \"modelSHA256\": \"$model_hash\"," \
  "  \"engineSHA256\": \"$engine_hash\"," \
  '  "runtime": "macOS universal arm64+x86_64, CPU, system libraries only"' \
  '}' > "$output_directory/manifest.json"

echo "WHISPER_BUNDLE=$output_directory"
