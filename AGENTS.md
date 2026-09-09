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
[UI] All writing Task 1 or Task 2 and speaking reports use the same core section order and card shell: original question, score and subscores, overall feedback, answer and annotations, exact corrections, optional improvements, model answer, and reusable language; only media-specific evidence may differ.
[UI] IELTS speaking practice must send the full question and explicit Part to AI; Part 2 runs a one-minute unrecorded preparation countdown followed by a two-minute recorded answer.
[UI] Timed writing may use a distraction-free mode with collapsible global navigation and simultaneous access to prompt, timer, and answer area; speaking practice must remain in its normal recording-and-transcript layout without a focus mode.
[ARCH] Personal language-bank generation is user-triggered, rebuilds from existing and newer saved practice text without audio or images, validates structured JSON, and persists the result locally.
[UI] Focus mode must hide controls that enter focus mode and group its exit action with the writing timer controls using the same button system, without overlapping or duplicating actions.
[UI] Potentially long generated libraries use separate content tabs and a master-detail card layout that expands only the selected item.
[UI] Input and generated-result panels with strongly unequal content heights should stack at full width instead of leaving an empty column beside a long report.
[UI] Writing uses distinct setup, timed-session, and report states; reviewed writing or speaking history opens the report directly with no separate open-report button, while rewriting creates a new attempt from the report action.
[UI] Sidebar collapse controls use only a small arrow at the top-right, with no border, fill, shadow, or rounded container, and reserve enough top spacing that the arrow never overlaps the collapsed brand icon.
[ARCH] Personal language-bank refreshes are append-only: process complete new or changed records in bounded batches, merge summaries hierarchically, and preserve every previously saved card and expression.
[UI] A focused writing session shows only the prompt, answer, timer, pause or continue, and finish controls; hide review, AI, notebook, deletion, and other post-answer actions until focus ends.
[UI] Score overviews must reserve the full remaining width for criteria evidence so long tables never collapse into a narrow column beside empty space.
[ARCH] Prefer a small, stage-based interaction flow with one obvious primary action per state; avoid special modes, duplicate controls, and optional branches unless they materially improve the user's task.
[CODE] IELTS writing word counts include letter-based English words only; standalone numbers and punctuation do not increase the count, while contractions and hyphenated words remain single words.
[UI] Writing and speaking score summaries use a compact version of the legacy review visual language: a restrained serif overall-score card beside a two-column criterion grid, sized so following feedback begins near the first viewport; never a dense evidence table.
[UI] Writing and speaking use the same left-side practice-history pattern with visible filters; all-results mode groups writing by Task 1 or Task 2 and speaking by Part 1, Part 2, Part 3, or free practice.
[UI] Personal writing language is grouped into familiar exam domains plus a separate general-expression category; show only a small daily rotating memory set while preserving every saved expression locally.
[UI] Writing and speaking module routes open a compact overview with today's plan, memory prompts, and history; only the explicit New Practice action opens the setup or recording workspace.
[UI] The home dashboard shows compact writing and speaking completion summaries with optional details; module-specific daily plan instructions belong on the writing and speaking overview pages.
[UI] Review score cards reserve large serif typography for numeric bands only; non-numeric limitations such as unavailable pronunciation scoring use compact status text, and score ranges must stay on one line.
[UI] Personal writing-language entries display a concise Chinese translation beneath the English expression; legacy entries without translations remain intact and are enriched on the next user-triggered language-bank update.
[WORKFLOW] Every writing or speaking UI correction requires an audit of the equivalent state, control, and layout in the other practice module; apply shared fixes to both when the issue is common.
[UI] Review-page sections use one consistent white rounded-card shell matching the original-and-annotations panel; keep only necessary internal emphasis instead of giving each report section a different outer style.
[UI] Question images in review pages use compact contained previews with an explicit magnifier that opens a full-screen lightbox; never let the inline image dominate an entire viewport.
[UI] Review reports are read by ordinary vertical scrolling and do not show a redundant chapter-navigation button row.
[CODE] Review snapshots fall back field by field to the original practice record when legacy snapshots omit the prompt, images, type, or answer; never let one partial snapshot hide a preserved original question.
[ARCH] Personal language-bank updates must merge semantically similar speaking themes into the existing card and append only unique material; title wording differences must never create duplicate topics.
[ARCH] Personal language-bank extraction must process and validate writing and speaking independently; written arguments and academic phrases must never be accepted as speaking-personal material.
[UI] AI-generated review sections must render through stable client-side component structures; do not let model-selected Markdown lists or tables change the same section's UI between reports.
[ARCH] Track AI-processed practice inputs by stable content fingerprints rather than timestamps; language-card deletion must persist to disk and clear only its source records' processed markers so they can be generated again.
[ARCH] Persist every practice, plan, language item, deletion, and AI-processing marker through the bound local-disk API; browser-only caches must never be the source of truth.
[UI] Speaking reusable-topic chips use concise Chinese labels consistently; normalize legacy English topic labels and require future AI output to follow the same language.
[CODE] IELTS review prompts must carry the exact Writing Task or Speaking Part, its applicable format and length requirements, and the relevant official public band-descriptor dimensions; never score every task with one generic rubric.
[ARCH] The local launcher must bind only to a free loopback port selected atomically by the operating system, so an occupied port can never prevent startup or connect a new launch to an older process.
[UI] The personal language-bank page must not display accumulated AI summary prose or source-count metadata as a permanent card; lead directly into the speaking and writing material tabs, reserving status UI for active work or errors.
[UI] Speaking expressions and answer frames use the same bilingual hierarchy as writing language: English on the primary line and its concise Chinese translation below, including normalized legacy entries.
[WORKFLOW] Keep the README screenshot gallery to one or two representative, polished product views; remove obsolete or anomalous screenshots instead of documenting every page.
