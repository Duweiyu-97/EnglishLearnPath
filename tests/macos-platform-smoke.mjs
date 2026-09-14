import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const build = await readFile(new URL("../build-macos.sh", import.meta.url), "utf8");
const whisper = await readFile(new URL("../build-whisper-macos.sh", import.meta.url), "utf8");
const picker = await readFile(new URL("../launcher/directory_picker_darwin.go", import.meta.url), "utf8");
const credentials = await readFile(new URL("../launcher/credentials_darwin.go", import.meta.url), "utf8");
const stopper = await readFile(new URL("../launcher/cmd/stopper/main_darwin.go", import.meta.url), "utf8");
const workflow = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");

assert.match(build, /English Learning Path\.app/, "macOS package must contain a double-clickable app bundle");
assert.match(build, /lipo -create/, "macOS launcher must be universal");
assert.match(build, /codesign --verify --deep --strict/, "macOS app bundle must be integrity checked after ad-hoc signing");
assert.match(whisper, /CMAKE_OSX_ARCHITECTURES=arm64;x86_64/, "Whisper must support Apple Silicon and Intel");
assert.match(picker, /choose folder/, "macOS must use a native folder picker");
assert.match(credentials, /security.*find-generic-password/s, "macOS credential encryption key must come from Keychain");
assert.match(credentials, /cipher\.NewGCM/, "macOS credential file must be authenticated and encrypted");
assert.match(stopper, /pkill.*-x/s, "macOS stopper must match only the launcher process name");
assert.match(workflow, /publish:\s*\n\s+name: Publish verified Windows and macOS packages\s*\n\s+if: github\.ref_type == 'tag'\s*\n\s+needs: \[build, build-macos\]/, "a release must wait for both platform builds");
assert.equal([...workflow.matchAll(/gh release create/g)].length, 1, "only the dual-platform publish job may create a release");
assert.match(workflow, /actions\/download-artifact@v4[\s\S]*EnglishLearnPath-Windows-x64-Full[\s\S]*actions\/download-artifact@v4[\s\S]*EnglishLearnPath-macOS-Universal-Full/, "the publish job must download both verified artifacts");

console.log("macOS platform smoke test passed.");
