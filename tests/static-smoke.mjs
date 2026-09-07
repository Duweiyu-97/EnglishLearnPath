import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../app/index.html", import.meta.url), "utf8");
const script = await readFile(new URL("../app/app.js", import.meta.url), "utf8");

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, "index.html contains duplicate ids");

const selectors = [...script.matchAll(/\$\("#([A-Za-z][\w-]*)"/g)].map(match => match[1]);
const dynamicIds = [...script.matchAll(/id=\\?"([A-Za-z][\w-]*)\\?"/g)].map(match => match[1]);
const availableIds = new Set([...ids, ...dynamicIds]);
const missing = [...new Set(selectors)].filter(id => !availableIds.has(id));
assert.deepEqual(missing, [], `app.js references missing ids: ${missing.join(", ")}`);

for (const page of ["home", "writing", "speaking", "plan", "mistakes", "settings", "guide"]) {
  assert.match(html, new RegExp(`data-page="${page}"`), `missing route page: ${page}`);
}

assert.match(html, /id="writingPromptImageInput"/, "writing prompt image picker is required");
assert.match(script, /promptImages:\s*\[\.\.\.pendingWritingPromptImages\]/, "writing prompt images must be saved with the record");
assert.match(html, /data-mistake-filter="vocabulary"/, "vocabulary notebook filter is required");
assert.match(html, /id="phasePlan"/, "exam-date phase plan container is required");
assert.match(html, /id="heroPrimaryAction"[^>]*>配置学习计划</, "home primary action must be plan-driven rather than writing-only");
assert.doesNotMatch(html, /开始今日写作/, "home must not force writing as the first activity");
assert.match(html, /id="recordButton"[^>]*>开始录音并转写</, "recording must visibly start transcription");
assert.doesNotMatch(html, /id="browserTranscribe"/, "speaking must not expose a separate transcription button");
assert.doesNotMatch(html, /id="saveWriting"|id="saveSpeaking"/, "writing and speaking must autosave without separate save buttons");
assert.doesNotMatch(html + script, /transcriptionEngine|SpeechRecognition|webkitSpeechRecognition|浏览器实时转写/, "browser transcription path must be completely retired");
assert.doesNotMatch(html + script, /punctuateTranscript|id="punctuateSpeaking"/, "browser transcripts must not be auto-formatted");
assert.match(script, /不得据此扣分/, "AI review must not penalize ASR punctuation or capitalization");
assert.match(script, /不要修改或覆盖页面上的原始转写/, "AI review must preserve original transcript");
assert.match(script, /至少 40% 的可用时间安排给复盘/, "AI plans must prioritize review over task volume");
assert.match(script, /只有客观、明确、在当前语境下无合理争议/, "writing review must only mark definite errors");


console.log(`Static smoke test passed: ${ids.length} unique ids, ${new Set(selectors).size} referenced selectors.`);

assert.doesNotMatch(html + script, /虾滑|ZYZ|data-route="(?:listening|reading)"|\/api\/resources/, "retired modules must not be exposed");
