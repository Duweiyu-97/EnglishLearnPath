# Agent Instructions

Read this file before working on this project. Preserve unrelated changes and user data.

## Self-Correcting Rules Engine

When the user corrects an implementation or workflow, fix the current issue and add a concise reusable rule below when appropriate. Avoid duplicate rules and do not retain temporary requests as permanent rules.

## Learned Rules

<!-- New reusable rules are appended below this line. Do not edit above this section. -->
[UI] A single recording workflow must produce synchronized audio and transcript with one capture control and one durable save operation; history must restore both outputs.
[UI] Changing a task type must update its dependent default settings; loading a saved record must preserve that record's explicit settings.
[WORKFLOW] Verify the user's running copy and visible page after fixing a local app; changes only present in a development or candidate package do not fix an older running copy. Preserve unsaved work before refreshing.
[CODE] Keep browser speech transcripts verbatim; handle ASR punctuation, capitalization, and uncertain sentence boundaries in AI review instructions rather than automatic local formatting.
[WORKFLOW] Build into a fresh staging directory and never recursively clean the distribution root; users may run extracted packages and store data there.
[UI] Use visible single-selection buttons instead of dropdowns for short notebook category lists, matching the adjacent filter controls and preserving an accessible selected state.
[ARCH] User-requested API credential persistence must use local OS-backed encryption, support explicit removal, and stay outside learning backups and distribution packages.
[UI] Render AI feedback as sanitized Markdown in both live results and saved history, keeping the original text in storage and bundling rendering dependencies for offline use.
[UI] Practice history should lead with the specific question topic, with task type as secondary metadata; reference the user's existing local review layouts before redesigning report displays.
[UI] Review reports belong on a dedicated navigable page, not a modal; show exact model-provided corrections inline in the original text and keep headers in normal flow so they do not obscure content.
[WORKFLOW] When the user supplies an app or thread as a UI reference, reuse its presentation and interaction flow without importing its grading rules, personal data, or prompts unless explicitly requested.
[UI] Inline annotations and their explanation cards must support navigation in both directions, restoring focus and highlighting the exact source passage on return.
[UI] Keep answer editing separate from saved report presentation; hide conversational preambles and avoid repeating corrections already displayed as annotation cards.
[UI] Place compact delete controls inside the top-right of history and notebook cards, reserving title space and overriding generic button height so controls never overlap text or stretch with the header.
[CODE] Match review quotations across typographic hyphen, quote and whitespace variants using offsets into the untouched source; reject ambiguous or lexically different matches rather than inventing a location.
[WORKFLOW] Pin CI runner families to required compiler generations and verify the entire remote build and artifact upload before calling CI fixed; a local build does not validate a moving hosted image.
[UI] When one bundled transcription engine is the supported path, expose one record-stop-transcribe flow and do not retain a competing browser transcription mode.
[UI] A no-limit writing session uses a visible count-up timer instead of an infinity placeholder or a disabled timing action.
[ARCH] Study plans must cap new output volume and prioritize review, reusable-language study, and rewriting as explicit tasks.
[CODE] Inline writing corrections are reserved for definite grammar, spelling, or mechanical errors; stylistic improvements must appear separately and must not mark the source as wrong.
[UI] Keep action groups and media controls visibly separated from adjacent text areas, previews, and helper text at every responsive width.
[WORKFLOW] Writing and speaking practice records autosave after meaningful edits and after transcription; do not require a separate save button before review or navigation.
[ARCH] Writing prompt images must be sent to a vision-capable model as real image inputs; never silently reduce an image-based Task 1 review to text-only guessing.
[WORKFLOW] Windows release packages must include a visible stop-service executable that can end leftover launcher processes before users delete or replace an extracted version.
[CODE] Every AI feature must use a provider-neutral output contract and validate or normalize the response before inserting it into fixed web UI regions.
[UI] Writing and speaking reports lead with the overall score and subscores, then overall feedback, annotated source, exact corrections, optional improvements, model answer, and reusable language.
[UI] IELTS speaking practice must send the full question and explicit Part to AI; Part 2 runs a one-minute unrecorded preparation countdown followed by a two-minute recorded answer.
[UI] Timed writing and speaking need a distraction-free mode with collapsible global navigation and simultaneous access to prompt, timer, and answer area.
[ARCH] Personal language-bank generation is user-triggered, rebuilds from existing and newer saved practice text without audio or images, validates structured JSON, and persists the result locally.
