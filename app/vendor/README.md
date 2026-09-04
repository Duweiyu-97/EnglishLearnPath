# Bundled browser libraries

These files are included in the portable package; no npm install or external CDN is needed at runtime.

- Marked 17.0.5 (`marked.umd.js`): https://github.com/markedjs/marked — MIT, see `marked-LICENSE.md`.
- DOMPurify 3.4.14 (`purify.min.js`): https://github.com/cure53/DOMPurify/tree/3.4.14 — Apache-2.0 OR MPL-2.0, see `DOMPurify-LICENSE`.

Keep the licenses when redistributing. `../markdown.js` uses an explicit allowlist, removes embedded media, and restricts links. AI responses and imported history are untrusted input.
