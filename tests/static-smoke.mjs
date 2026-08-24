import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../app/index.html", import.meta.url), "utf8");
const script = await readFile(new URL("../app/app.js", import.meta.url), "utf8");
const listening = JSON.parse(await readFile(new URL("../examples/listening-original-example.json", import.meta.url), "utf8"));
const reading = JSON.parse(await readFile(new URL("../examples/reading-original-example.json", import.meta.url), "utf8"));

const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, "index.html contains duplicate ids");

const selectors = [...script.matchAll(/\$\("#([A-Za-z][\w-]*)"/g)].map(match => match[1]);
const dynamicIds = [...script.matchAll(/id=\\?"([A-Za-z][\w-]*)\\?"/g)].map(match => match[1]);
const availableIds = new Set([...ids, ...dynamicIds]);
const missing = [...new Set(selectors)].filter(id => !availableIds.has(id));
assert.deepEqual(missing, [], `app.js references missing ids: ${missing.join(", ")}`);

for (const page of ["home", "listening", "reading", "writing", "speaking", "settings", "guide"]) {
  assert.match(html, new RegExp(`data-page="${page}"`), `missing route page: ${page}`);
}

assert.ok(Array.isArray(listening.questions) && listening.questions.length > 0, "listening example requires questions");
assert.ok(Array.isArray(reading.paragraphs) && reading.paragraphs.every(item => item.translation && item.summary), "reading example requires translations and summaries");
assert.ok(Array.isArray(reading.questions) && reading.questions.every(item => item.answer && item.explanation), "reading example requires answers and explanations");

console.log(`Static smoke test passed: ${ids.length} unique ids, ${new Set(selectors).size} referenced selectors.`);
