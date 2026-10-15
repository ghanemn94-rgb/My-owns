# Handback T-DG5-BE-N — PDF, DOCX and PPTX, bidirectional layout and bundled fonts (backend-workflow-engineer)

- **Stage / gate:** P5 "Configuration automation and outputs", DG5 (BUILDING). Section: `docs/architecture/p5-work-split.md` §F.6.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG5-T-DG5-BE-N-backend-workflow-engineer-20261015T210640Z-61bf8c6f","session_id":"61bf8c6f-b592-4f4b-9cc9-b9b9435035e8"}`.
- **Assignment:** `docs/delivery/assignments/DG5/T-DG5-BE-N.md` (sha256 `35b97644…f605f4`, verified at start).
- **Base:** worktree `/home/user/wt/dg5-be-n`, branch `dg5/be-n`, `HEAD` `278cd1d` (W12 assignments, D-156). The changes are **uncommitted**, as the assignment asks.
- **Time:** start `2026-10-15T21:06:55Z`; end `2026-10-15T23:10:42Z` (about 124 minutes, past the 2-hour limit: the full integration run alone took 37 minutes under load, §8).
- **No migration** (`0084` not taken). **No new API operation** (none is assigned to BE-N). **No new dependency.** Product gates G1–G6 are business approvals inside the product; nothing here grants, approves or decides one, and no export template contains an engineering-gate string. All test and sample data is synthetic.

## 1. Changed files

| File | Purpose |
|---|---|
| `packages/reporting/src/fonts.ts` (new) | The 10 bundled `.woff` faces (IBM Plex Sans Arabic and IBM Plex Sans; arabic/latin/latin-ext; 400/700), read once per process from the two `@fontsource` packages through their `exports` (`files/*.woff`); the face stack per export language. |
| `packages/reporting/src/layout/bidi.ts` (new) | Pure bidirectional paragraph layout over `bidi-js` (UAX #9): base direction = export language, LTR marking of identifiers/numbers/Latin stretches inside Arabic, a face per character by coverage, line breaking measured on the drawn pieces, visual order per line, mirrored brackets, and pieces handed to fontkit in the order it needs. |
| `packages/reporting/src/layout/values.ts` (new) | What the paged formats print for a value: numbers by the `formatDecimal` rule (mirrored; parity-tested), unit and ISO code; Provisional/Unknown/Stale/n/a labels; the en/ar labels BE-N adds (`export.page`, `export.slide`, `export.continued`, `export.fonts_note.docx/pptx`), merged under the caller's content table. |
| `packages/reporting/src/layout/blocks.ts` (new) | The paged view shared by PDF, DOCX and PPTX: frame block, every section in content order (fields/metrics → label/value table, table with every row and totals, text, list, "No records"), legend. |
| `packages/reporting/src/pdf/index.ts` (new) | The PDF writer over pdfkit: A4 (landscape when a table has more than 7 columns), header block, sections, content-sized table columns, header rows repeated per page, rows split only when taller than a page, footer "Draft — not an issued report"/issue line + "Page n of m", `/Lang`, `/ViewerPreferences /Direction /R2L` in Arabic, embedded font subsets, whole-run shaping (§4.2). |
| `packages/reporting/src/docx.ts` (new) | The DOCX writer over `docx`: `bidirectional` paragraphs, `rightToLeft` runs for Arabic stretches, `visuallyRightToLeft` tables, `w:lang` `ar-SA`/`en-GB`, complex-script and ASCII fonts named, page fields in the footer, "About this file" with the font statement. |
| `packages/reporting/src/pptx.ts` (new) | The PPTX writer over pptxgenjs: title slide with the header block, tables split over slides with the header repeated and "(continued)" titles, `rtlMode`, `lang ar-SA`, right alignment and mirrored columns in Arabic, issue line and "Slide n of m" on every slide, DEFLATE-compressed output. |
| `packages/reporting/src/render.ts` (modified) | The three renderers registered (`pdf`, `docx`, `pptx`); its header comment updated (it said BE-N "adds" them and that a missing format fails). |
| `packages/reporting/src/pdf/read.ts` (new, test support) | A minimal PDF reader for tests (inflate, ToUnicode decoding, glyph ids, positions, embedded `FontFile2`). Used by the unit and integration tests; the renderers do not use it. |
| `packages/reporting/src/ooxml-read.ts` (new, test support) | A minimal DOCX/PPTX part reader for tests (jszip lives in `@mth/reporting`, not in `apps/api`). |
| `packages/reporting/src/layout/layout.test.ts`, `src/pdf/pdf.test.ts`, `src/docx.test.ts`, `src/pptx.test.ts` (new) | Unit tests: 11 + 13 + 4 + 5 = 33. |
| `packages/reporting/THIRD_PARTY_NOTICES.md` (new) | Each library's licence text (pdfkit, fontkit and its shaping chain, bidi-js, docx, pptxgenjs, jszip, decimal.js) and the OFL-1.1 text of both font packages, copied verbatim from the installed packages. |
| `apps/api/test/integration/reporting/exports-paged.test.ts` (new) | End to end against the disposable PostgreSQL: generate → `POST /exports` → the worker's `runExport` → `GET /exports/{id}/download` → read back (4 tests). An opt-in `MTH_SAMPLES_DIR` keeps the downloaded files as samples. |
| `docs/delivery/handbacks/DG5/T-DG5-BE-N-evidence/**` | Logs, the proposed BE-M test patch, the A15 sample files. |

## 2. Behaviour delivered, per requirement row

### REQ-S13-009 — acceptance: "A15;A20: an Arabic PDF renders RTL with readable numbers and identifiers"

§F.6 test text: "an Arabic PDF of a register has RTL base direction, embeds IBM Plex Sans Arabic, and its identifiers (`RAID-014`) and numbers keep their left-to-right order (text extraction of the PDF's content stream and the glyph-run check: the Arabic word's glyph ids differ from the isolated forms, proving `GSUB` joining); an English PDF is LTR".

- **RTL base direction:** the catalog has `/Lang (ar-SA)` and `/ViewerPreferences << /DisplayDocTitle true /Direction /R2L >>`. Text is aligned to the right margin, and tables are mirrored, with the first column on the right. Tests `pdf.test.ts` › "has a right-to-left base direction…" and integration `exports-paged.test.ts` › "Arabic: RTL base direction…" (a real `registers` snapshot through the worker).
- **Embeds IBM Plex Sans Arabic:** every font of an Arabic PDF is an embedded subset `XXXXXX+IBMPlexSansArabic-Regular|Bold` with its TrueType program (`FontFile2`). An English PDF uses `IBMPlexSans-*`, plus IBM Plex Sans Arabic for user-authored Arabic.
- **Identifiers and numbers in LTR order (text extraction):** the content streams are decoded through each font's ToUnicode map and read in page order. The Arabic cell "مخاطرة RAID-014 بقيمة 1,250.50" reads, left to right on the page, `1,250.50 ةميقب RAID-014 ةرطاخم`: the number, then the Arabic words right to left, with the identifier in its own order. The snapshot UUID, `2026-10-15 13:00 (Asia/Riyadh)` and `-200.25 SAR` also keep their order. In the integration test, the real RAID codes (`RAID-001…`) do too.
- **Glyph-run check:** the drawn glyphs of "مخاطرة" are read from the PDF's embedded subset font. Their outlines equal the original font's shaped run, and at least 3 differ from the isolated forms (initial meem, medial khah, final forms), which proves `GSUB` joining in the file.
- **Multi-word Arabic order:** "مسودة — ليس تقريراً صادراً" is drawn word by word right to left. This test was added after the defect in §4.2.
- **English PDF is LTR:** `/Lang (en-GB)`, no `/Direction /R2L`, text starts at the left margin, and the first column is on the left.
- **DOCX/PPTX direction:** DOCX Arabic paragraphs all carry `<w:bidi/>`, tables `<w:bidiVisual/>` and Arabic runs `<w:rtl/>` with `w:lang w:bidi="ar-SA"`. The identifier and number runs stay LTR, and the run sequence is asserted exactly. PPTX Arabic has `rtl="1"`, `lang="ar-SA"`, `algn="r"`, mirrored table columns and `IBM Plex Sans Arabic`.
- **Not verified here:** a visual inspection of the rendered pages. LibreOffice 24.2 is installed but cannot start in this sandbox ("ERROR: no valid pipe path found": it needs `/tmp` or `/var/tmp`, which are read-only), and no other rasterizer is present. The visual check is **BLOCKED** here; it is QA-C's A15/A20 inspection (§F.10 "Completes with: QA-C (bilingual inspection)").

### REQ-S13-005 — acceptance: "A15: an XLSX export of T15 contains exactly the filtered RAID rows; a PPTX gate pack contains the gate's criteria"

- **PPTX gate pack contains each criterion (BE-N's half).** Unit `pptx.test.ts`: a gate-pack-shaped document with 14 criteria yields every criterion key and its English and Arabic labels in the slides' XML, in both languages. Unknown states print "Unknown"/"غير معروف". The criteria table spans more than one slide, with the header repeated. Integration `exports-paged.test.ts` › "every criterion of G2…": a real `gate_pack` snapshot of G2 is exported to PPTX (en and ar) through the API and worker. The criterion keys equal the gate definition's criteria, and every key, `label_en` and `label_ar` of the snapshot is found in the downloaded PPTX.
- The XLSX half is BE-M's (merged). The PDF register export in the integration test also contains exactly the filtered rows: the two risks are present, and the issue outside `type=risk` is absent.
- Every file carries the header block (ADR-0046 §2): product name, output, transformation, subject, period, as-of time, snapshot ID, issue line, methodology version and approval state of the sources. It also carries the legend, and page or slide numbers where the format has pages.

### REQ-S13-008 — acceptance: "A10;A15: a pending benefit value is labelled provisional in the PDF pack"

- §F.6 text: "a pending benefit value prints "مؤقت"/"Provisional" in the PDF pack; a generated (not issued) snapshot carries "Draft — not an issued report"".
- Integration › "prints Provisional (en) and مؤقت (ar) for the pending value": a `benefits` register snapshot whose benefit has a submitted (pending) measurement (`validation: provisional`, `valueBasis: submitted`) is exported to PDF in both languages. The file prints the amount with "Provisional", or "مؤقت" in Arabic, as drawn runs beyond the legend's own.
- Unit: provisional prints under the value; Unknown/Stale print their label and no number, never 0 (the RAID-016 row carries no digit apart from its code).
- "Draft — not an issued report" / "مسودة — ليس تقريراً صادراً" appears on every PDF page (header block and footer), every PPTX slide, and the DOCX header block and footer. An issued snapshot prints "Issued report, version 2" and no Draft line (PDF and DOCX tests).
- **Scope note:** the test exports the `benefits` **register** as a PDF. "The PDF pack" (the executive pack, KBE-D's assembler) goes through the same renderer and the same `cellText` labelling, but no executive-pack PDF is exported in my tests.

### DOCX font embedding (ADR-0046 §3: "Either outcome is recorded in BE-N's handback")

**Outcome: the families are named, not embedded.** ADR-0046 allows embedding only "if BE-N's test proves the embedding opens in LibreOffice 24.2 without a font warning". That proof could not be produced, because LibreOffice cannot start in this sandbox (above). So the DOCX names IBM Plex Sans Arabic (complex script, and ASCII/high-ANSI in Arabic) and IBM Plex Sans (ASCII/high-ANSI in English), and contains no `word/fonts/` part. Its "About this file" section says so in the export language (`export.fonts_note.docx`): "…does not embed them; a viewer without them shows a substitute font." The test `docx.test.ts` › "names the bundled families and embeds none" asserts this. PPTX names the families and embeds nothing (pptxgenjs cannot embed), with the same statement on its "About this file" slide.

## 3. Checks run (exact commands, real exit codes)

Environment: Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), offline, harness ports 24650–24699, PostgreSQL from `tests/qa/support/with-pg.sh`. Four W12 agents ran concurrently (load average 13–21 during the runs). Logs are in `docs/delivery/handbacks/DG5/T-DG5-BE-N-evidence/`.

| # | Command | Exit | Result | Log |
|---|---|---|---|---|
| 0 | `node tools/gates/validate.mjs --historical --stage DG4` (start) | 0 | `PASS gate DG4 (historical)` (the start-time line in my transcript printed `EXIT` after a pipe to `tail`, so it showed tail's status; the validator was re-run with its own exit captured, row 8) | — |
| 1 | `pnpm -r typecheck` | 0 | all packages | `typecheck.log` |
| 2 | `pnpm -r build` | 0 | all packages | `build.log` |
| 3 | `pnpm lint` | 0 | `eslint . --max-warnings=0` | `lint.log` |
| 4 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | "All matched files use Prettier code style!" | `prettier.log` |
| 5 | `pnpm openapi:lint` | 0 | contract unchanged | `openapi-lint.log` |
| 6a | `pnpm test` with `LANG`/`LC_ALL`/`LC_CTYPE` unset | 0 | unit-node **2042/2042** (124 files); unit-web **1429/1429** (74); unit-formula-nocodegen **259 + 2 skipped** (3) | `unit-locale-unset.log` |
| 6b | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` (first run) | **1** | unit-node 2042/2042; unit-web **1 failed**/1429: `RecordForm.alerts.test.tsx` › "(en) › dialog › a 400 whose only field error has pointer """ — **"Test timed out in 20000ms"** at load ≈ 20; formula 259 + 2 skipped | `unit-c-utf8.log` |
| 6c | `LANG=C.UTF-8 LC_ALL=C.UTF-8 npx vitest run --project unit-web apps/web/src/components/RecordForm.alerts.test.tsx` | 0 | 16/16 | `unit-web-recordform-rerun-c-utf8.log` |
| 6d | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` (full re-run) | **not run** | time limit reached; see §8 | — |
| 7 | `QA_PG_PORT=24650 MTH_PORT_POOL=24651-24699 tests/qa/support/with-pg.sh pnpm test:integration` **with the proposed BE-M test patch applied** (§5.1) | 0 | **2439/2439** (253 files) = 2435 (D-156) + 4 (`exports-paged.test.ts`); 2216 s | `integration-with-be-m-patch.log`, `integration-exit.txt` |
| 8 | `node tools/gates/validate.mjs --historical --stage DG4` (end) | 0 | `exit=0` | `validate-historical-DG4-end.log` |
| 9 | `… with-pg.sh npx vitest run --project integration apps/api/test/integration/reporting/exports.test.ts apps/api/test/integration/contract/contract.test.ts` with the BE-M patch | 0 | 93/93 | `be-m-suites-with-patch.log` |
| 10 | the same two files **without** the patch | **1** | 3 failed / 90 passed (expected, §5.1) | `be-m-suites-without-patch.log` |

The 6b failure is in a web component test that this task does not touch (no `apps/web` file changed). It timed out at 20 s under a load of about 20, which is the F-DG4-148 class. The file passed 16/16 on its own in the same locale (6c). A clean full `C.UTF-8` run (6d) was not done within the time limit (§8).

**Unit test deltas:** unit-node 2009 → 2042 (+33: layout 11, PDF 13, DOCX 4, PPTX 5). unit-web and formula are unchanged (D-156 baseline 1429 and 259 + 2).

**Disclosed failures during development** (all in my own new tests or code, fixed before the runs above):
- (a) The first Arabic PDF hung: I ended pdfkit's `ViewerPreferences` reference, and pdfkit ends it again in `doc.end()`.
- (b) Isolating each Latin word with LRI/PDI reversed a multi-word English phrase in an RTL paragraph ("Hub Transformation Mobily"). Replaced by LRM-marked LTR stretches.
- (c) A line could exceed its width by about 1 pt: breaking was measured on logical runs. It is now measured on the drawn pieces.
- (d) A duplicated letter at a line end: a wrong low-surrogate fallback.
- (e) pdfkit's word-split layout drew multi-word Arabic runs with their words in logical order (§4.2).
- (f) A 15-column register split words between characters on portrait A4. Now landscape plus content-sized columns.
- (g) PPTX was stored uncompressed: a 5,000-row deck was 39.4 MiB, now 1.5 MiB.
- (h) Test-reader bugs: multi-line dictionaries, and multi-code-point ToUnicode entries.

The integration test was iterated five times, each run with exit 1, until its assertions matched the files: a risk needs a probability; the benefits table is not section 0; the amount cell wraps; "Provisional" shares a baseline. Its final runs exit 0, 4/4.

**Performance (5,000 rows, the ADR-0045 maximum; load ≈ 13):** PDF ar 20.4 s and en 21.9 s (0.5 MiB); DOCX ar 4.3 s; PPTX ar 4.7 s (1.5 MiB). Each runs inside the asynchronous export job.

## 4. Design notes for reviewers

1. **Fonts and coverage.** Fontsource splits each family by Unicode range. Its Arabic file has no digits, parentheses or Latin, so every character is drawn with the first face of the language's stack that covers it, and neutrals stay in the face of the text before them. Bidi controls and marks are never drawn.
2. **Whole-run shaping (pdfkit).** pdfkit's `EmbeddedFont.layout` splits a string at spaces and concatenates the words in string order unless OpenType features are passed. A multi-word RTL run would then be drawn with its words in logical order. Every draw and measure therefore passes `features: []`, which keeps fontkit's default features (including the Arabic joining forms) and shapes the run as one, so fontkit returns its glyphs in visual order. The test "a multi-word Arabic phrase reads right to left" pins this.
3. **Identifiers.** ADR-0046 §3 says identifiers "are isolated as left-to-right runs". Per-token LRI/PDI isolates are neutrals in UAX #9, which reorders adjacent Latin words in an RTL paragraph (defect (b)). The layout instead marks each maximal non-Arabic stretch, bracket-balanced, with U+200E on both sides. It is one LTR run in its own order (rule W7 keeps `RAID-014`'s hyphen in place), and a Latin-only paragraph keeps its word order. The effect the ADR asks for holds and is tested; the mechanism differs from the ADR's wording, so this is recorded here for the architect's next ADR-0046 touch.
4. **Numbers** print by the shared `formatDecimal` rule: half-up display rounding (2 decimals for money, up to 6 otherwise), Latin digits, and the ISO code after the amount in Arabic. `@mth/shared` exports `formatDecimal` on no subpath, so `layout/values.ts` mirrors it, and a parity test (`layout.test.ts`) compares the two on 24 cases (6 values × en/ar × with/without currency). I made no change to `packages/shared`.
5. **Renderers are pure.** No database, network or clock: the PDF's dates are the snapshot's as-of time, and the font bytes are read from the installed packages.

## 5. For the orchestrator (outside my file ownership)

### 5.1 Proposed patch to BE-M's tests (required for a green integration suite)

Two BE-M test files assumed that PDF has no renderer before BE-N:
- `exports.test.ts` › "a format without a renderer in this release fails at once with export.render_failed";
- `p5-exercises-be-m.ts`, which uses a PDF job to reach `422 export.failed`.

With BE-N's renderers, these fail: 3 failures, row 10. The first is the exercise itself; the second, "covers every operation…", is a consequence, because the exercise aborts before `cancelExport`; the third is the BE-M test.

The patch `docs/delivery/handbacks/DG5/T-DG5-BE-N-evidence/proposed-be-m-tests.patch` (17+/6−) keeps both refusal paths covered by raising a real `RenderError` through the runner's existing `afterSection` test seam, where a renderer raises it. The job still fails at once with `export.render_failed`, is never retried, and its download still gives 422 `export.failed`. With the patch: 93/93 (row 9).

The patch is **not applied** in the handed-back tree. I applied it only for the integration run (row 7) and reversed it with `git apply -R`, because `git checkout` cannot write this worktree's index (read-only git metadata). Please apply it at the merge, as with KBE-A's patch (D-149).

### 5.2 Further items

- **Content label table.** The production worker calls `runExport(…, { store })` without a `labels` table (`apps/worker/src/handlers/reports.ts`), and no `report.*` translation table exists yet. Section titles, column headers and code labels therefore print the deterministic fallback (the key's last segment, e.g. "Label en") in **both** languages, and `RenderResult.missingLabels` lists them. The frame labels are translated: the header block, Draft, the validation labels, the legend, page/slide numbers and "No records". So Arabic exports have the correct direction and fonts, but some English fallback headings. REQ-S13-009's "Exports render in the selected language" is therefore only fully met when the export label table (§F.11 item 10: "the export label table lives in the API's i18n source the worker receives") is supplied. This needs an owner (FE-E/KBE or the orchestrator); the real-pipeline samples in `samples/pipeline/` show the current state.
- **Build exclusions (optional).** `packages/reporting/tsconfig.build.json` (BE-M's) excludes `src/xlsx/read.ts` but not my test readers `src/pdf/read.ts` and `src/ooxml-read.ts`. They compile into `dist` harmlessly (Node built-ins and `jszip` only); adding them to `exclude` keeps test code out of the build.
- **Contract, schema, migrations, dependencies:** none needed. `0084` stays unused. The ADR-0046 §7 packages sufficed: fontkit is used through pdfkit, and no direct dependency was added.
- **Pinned counts:** no route, media type or rate limit changed. Media-type triple delta 0; rate-limit floor delta 0. The integration total gains 4 tests (`exports-paged.test.ts`).
- **Packaging (DG6):** the worker image must ship `node_modules/@fontsource/*/files/*.woff` (the renderers read them at run time) and `THIRD_PARTY_NOTICES.md`.

## 6. Operations routed (pending-list delta)

None. §F.6 assigns no operation ("rendered through BE-M's jobs"). There is no `p5-pending-be-n.ts`, and `apps/api/test/integration/contract/p5-exercises-be-n.ts` is unchanged ("Nothing routed yet"); the contract test stays green with it.

## 7. User-facing texts made untrue by this work (F-DG4-160)

- `packages/reporting/README.md` line 8: "PDF, DOCX and PPTX are added by T-DG5-BE-N (until then a request for them fails with `export.render_failed`)". This is now untrue. The file is BE-M's, so it is listed here for its owner. Suggested text: "PDF, DOCX and PPTX ship with T-DG5-BE-N (layout and fonts: `src/layout/**`, `src/fonts.ts`; notices: `THIRD_PARTY_NOTICES.md`)."
- The `render.ts` header comment (mine to edit) is updated.
- No en/ar UI string, problem text or OpenAPI text calls PDF, DOCX or PPTX planned. Searched `apps/web/src/i18n/**`, `docs/api/openapi.yaml` and `packages/reporting/**`.

## 8. Final runs and what remains

- **Integration** (row 7): exit 0, 2439/2439, with the proposed BE-M patch applied for the run only. The patch was reversed afterwards with `git apply -R`; the handed-back tree does **not** contain it (§5.1). **Without** the patch, the merged tree's integration suite has the 3 BE-M failures of row 10.
- **Unit:** the locale-unset run is green in every Vitest invocation (row 6a). The `C.UTF-8` run had one timeout in an untouched web test that passed on its own (rows 6b, 6c).
- **Static checks** (rows 1–5) and the historical DG4 validator (rows 0, 8) exit 0.

**What remains (stated plainly):**
1. **Acceptance item 2 in `C.UTF-8` is not shown clean in one full run.** Re-run `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` at a lower load (row 6d). Its only failure was the 20 s timeout of `apps/web/src/components/RecordForm.alerts.test.tsx`, which this task does not touch.
2. **Apply** `proposed-be-m-tests.patch` (§5.1) at the merge; without it the integration suite is not green.
3. **Visual inspection** of the Arabic and English PDF, DOCX and PPTX samples is **BLOCKED** here: LibreOffice cannot start in the sandbox and no rasterizer is present. It belongs to QA-C (A15/A20), with the samples in `samples/`.
4. **The export content label table** (§5.2) needs an owner. Until it exists, section and column headings print key-derived English fallbacks in Arabic exports.
5. **DOCX font embedding** is not done: the families are named (§2), as ADR-0046 §3 allows. Embedding would need the LibreOffice proof, which cannot run here.
6. **The executive pack ("the PDF pack")** was not exported in my tests; the `benefits` register PDF was (REQ-S13-008 scope note, §2).
7. **Owner edits:** `packages/reporting/README.md` line 8 (§7), and optionally the `tsconfig.build.json` exclusions (§5.2).
8. **Merge instructions:** no migrations and no ordering constraints. Expect no conflicts in my files. `render.ts` is the only modified existing file (BE-R's later layout wiring lands in `layout/**`).

## 9. Evidence index (`docs/delivery/handbacks/DG5/T-DG5-BE-N-evidence/`)

- `typecheck.log`, `build.log`, `lint.log`, `prettier.log`, `openapi-lint.log`, `static-checks-exit.txt`;
- `unit-locale-unset.log`, `unit-c-utf8.log`, `unit-web-recordform-rerun-c-utf8.log`, `unit-c-utf8-rerun.log`, `unit-exit.txt`;
- `integration-with-be-m-patch.log`, `integration-exit.txt`, `be-m-suites-with-patch.log`, `be-m-suites-without-patch.log`, `proposed-be-m-tests.patch`;
- `validate-historical-DG4-end.log`;
- `samples/`: A15 sample files from synthetic documents (RAID register en/ar as PDF, DOCX and PPTX, plus issued-v2 PDFs; `SHA256SUMS.txt`; the generator `generate-samples.ts.txt`, run from `packages/reporting` with `node --conditions=@mth/source`), and `samples/pipeline/`: files downloaded from the real API → worker pipeline by `exports-paged.test.ts` with `MTH_SAMPLES_DIR` (registers PDF en/ar, gate pack PPTX en/ar and DOCX ar). All data is synthetic.
